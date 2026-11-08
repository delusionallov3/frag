import { tr } from '@shared/i18n'
import { promises as fs } from 'fs'
import { basename } from 'path'
import type {
  KeyTest,
  MatchCandidate,
  MatchData,
  MatchKill,
  MatchRound,
  RateInfo,
  Region,
  RecTimes,
  RiotAccount
} from '@shared/types'
import { allProjects, getHenrikKey, getRecMeta, getSettings, projectKey } from './store'
import { probe } from './ffmpeg'

const BASE = process.env['FRAG_HENRIK_BASE'] || 'https://api.henrikdev.xyz'
const REGIONS: Region[] = ['eu', 'na', 'ap', 'kr', 'latam', 'br']

/* ------------------------------------------------------------------ Rate limiter
 * 60 s sliding window set to the quota picked in Settings,
 * + honors the X-RateLimit-* headers sent by HenrikDev (if the server says 0 left, wait). */

const sent: number[] = []
let detectedLimit: number | null = null
let serverRemaining: number | null = null
let serverResetAt: number | null = null
let waitingUntil: number | null = null
let chain: Promise<unknown> = Promise.resolve()

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function prune(now: number): void {
  while (sent.length && now - sent[0] >= 60000) sent.shift()
}

async function waitForSlot(): Promise<void> {
  const { rateLimit } = await getSettings()
  const limit = Math.max(1, Math.floor(rateLimit))
  for (;;) {
    const now = Date.now()
    prune(now)
    let waitMs = 0
    if (sent.length >= limit) waitMs = sent[0] + 60000 - now + 50
    if (serverRemaining === 0 && serverResetAt && serverResetAt > now) waitMs = Math.max(waitMs, serverResetAt - now + 50)
    if (waitMs <= 0) break
    waitingUntil = now + waitMs
    await sleep(Math.min(waitMs, 5000))
  }
  waitingUntil = null
  sent.push(Date.now())
}

function readRateHeaders(res: Response): void {
  const lim = Number(res.headers.get('x-ratelimit-limit'))
  const rem = res.headers.get('x-ratelimit-remaining')
  const reset = Number(res.headers.get('x-ratelimit-reset') ?? res.headers.get('retry-after'))
  if (lim > 0) detectedLimit = lim
  if (rem !== null && rem !== '') serverRemaining = Number(rem)
  if (reset > 0) serverResetAt = Date.now() + reset * 1000
}

export function rateInfo(limit: number): RateInfo {
  prune(Date.now())
  return {
    limit,
    usedLastMinute: sent.length,
    detectedLimit,
    remaining: serverRemaining,
    waitingUntil
  }
}

/* ------------------------------------------------------------------ API calls */

async function rawFetch(path: string, key: string): Promise<Response> {
  try {
    return await fetch(BASE + path, {
      headers: { Authorization: key, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new Error(tr('HenrikDev isn’t answering (over 20 s). Try again in a moment.', 'HenrikDev ne répond pas (plus de 20 s). Réessaie dans un instant.'))
    }
    throw new Error(tr('Can’t reach HenrikDev. Check your connection.', 'Impossible de joindre HenrikDev. Vérifie ta connexion.'))
  }
}

async function errorFrom(res: Response, notFound: string): Promise<Error> {
  let detail = ''
  try {
    const body = (await res.json()) as { errors?: { message?: string }[] }
    detail = body.errors?.[0]?.message ?? ''
  } catch {
    /* empty body */
  }
  if (res.status === 401 || res.status === 403) return new Error(tr('HenrikDev key rejected. Check it in Settings.', 'Clé HenrikDev refusée. Vérifie-la dans les réglages.'))
  if (res.status === 404) return new Error(notFound)
  if (res.status === 429) return new Error(tr('HenrikDev quota reached, try again in a minute.', 'Quota HenrikDev atteint, réessaie dans une minute.'))
  return new Error(tr(`HenrikDev answered ${res.status}${detail ? `: ${detail}` : ''}`, `HenrikDev a répondu ${res.status}${detail ? ` : ${detail}` : ''}`))
}

/** Sequential call (one at a time), rate limited, with one retry after a 429 */
function call<T>(path: string, notFound = tr('Not found on HenrikDev.', 'Introuvable sur HenrikDev.')): Promise<T> {
  const run = async (): Promise<T> => {
    const key = await getHenrikKey()
    if (!key) throw new Error(tr('Add your HenrikDev key to fetch your matches.', 'Ajoute ta clé HenrikDev pour récupérer tes matchs.'))
    for (let attempt = 0; attempt < 2; attempt++) {
      await waitForSlot()
      const res = await rawFetch(path, key)
      readRateHeaders(res)
      if (res.ok) return (await res.json()) as T
      if (res.status === 429 && attempt === 0) {
        const wait = Math.min(60, Number(res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset')) || 10)
        serverRemaining = 0
        serverResetAt = Date.now() + wait * 1000
        continue
      }
      throw await errorFrom(res, notFound)
    }
    throw new Error(tr('HenrikDev quota reached, try again in a minute.', 'Quota HenrikDev atteint, réessaie dans une minute.'))
  }
  const p = chain.then(run, run)
  chain = p.catch(() => {})
  return p
}

/** Tests a key (without saving it) on a light endpoint, and reads the returned quota */
export async function testKey(key: string): Promise<KeyTest> {
  const k = key.trim()
  if (!k) return { ok: false, error: tr('Empty key.', 'Clé vide.'), limit: null, remaining: null, resetIn: null }
  await waitForSlot()
  let res: Response
  try {
    res = await rawFetch('/valorant/v1/status/eu', k)
  } catch (e) {
    return { ok: false, error: (e as Error).message, limit: null, remaining: null, resetIn: null }
  }
  const limit = Number(res.headers.get('x-ratelimit-limit')) || null
  const remaining = res.headers.get('x-ratelimit-remaining')
  const reset = Number(res.headers.get('x-ratelimit-reset')) || null
  if (res.ok || res.status === 429) {
    readRateHeaders(res)
    return { ok: true, limit, remaining: remaining === null ? null : Number(remaining), resetIn: reset }
  }
  const err = await errorFrom(res, tr('Test endpoint not found.', 'Endpoint de test introuvable.'))
  return {
    ok: false,
    error: res.status === 401 || res.status === 403 ? tr('HenrikDev rejects this key (invalid or revoked).', 'Cette clé est refusée par HenrikDev (invalide ou révoquée).') : err.message,
    limit: null,
    remaining: null,
    resetIn: null
  }
}

/** Checks a Riot ID really exists and fetches its PUUID, region, level */
export async function verifyAccount(riotId: string): Promise<RiotAccount> {
  const { name, tag } = parseRiotId(riotId)
  const res = await call<{
    data: { puuid: string; region: string; account_level: number; name: string; tag: string; card: string }
  }>(
    `/valorant/v2/account/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`,
    tr(
      `The account “${name}#${tag}” doesn’t exist (or never played Valorant).`,
      `Le compte « ${name}#${tag} » n’existe pas (ou n’a jamais joué à Valorant).`
    )
  )
  const d = res.data
  const region = (REGIONS.includes(d.region as Region) ? d.region : 'eu') as Region
  return {
    riotId: `${d.name}#${d.tag}`,
    puuid: d.puuid,
    region,
    level: d.account_level ?? null,
    card: d.card || null,
    verified: true
  }
}

/* ------------------------------------------------------------------ v4 → MatchData normalization */

interface RawPlayerRef {
  puuid: string
  team?: string
}

interface RawMatch {
  metadata: {
    match_id: string
    map: { id?: string | null; name?: string | null } | null
    started_at: string
    game_length_in_ms: number
    queue?: { id?: string | null; mode_type?: string | null; name?: string | null } | null
    region?: string | null
  }
  players: {
    puuid: string
    name: string
    tag: string
    team_id: string
    agent: { id?: string | null; name?: string | null } | null
    stats: {
      score: number
      kills: number
      deaths: number
      assists: number
      headshots?: number
      bodyshots?: number
      legshots?: number
      damage?: { dealt?: number } | null
    }
    tier?: { id?: number | null; name?: string | null } | null
  }[]
  teams: { team_id: string; won: boolean; rounds: { won: number; lost: number } }[]
  rounds: {
    id: number
    result: string
    ceremony: string
    winning_team: string
    plant?: { round_time_in_ms: number; site: string; player?: RawPlayerRef | null } | null
    defuse?: { round_time_in_ms: number; player?: RawPlayerRef | null } | null
  }[]
  kills: {
    time_in_round_in_ms: number
    time_in_match_in_ms: number
    round: number
    killer: RawPlayerRef
    victim: RawPlayerRef
    assistants?: RawPlayerRef[] | null
    weapon?: { id?: string | null; name?: string | null } | null
  }[]
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function normalizeMatch(raw: RawMatch): MatchData {
  const roundsRaw = [...(raw.rounds ?? [])].sort((a, b) => a.id - b.id)
  // Round ids can be 0- or 1-based depending on the version: align on the smallest
  const base = roundsRaw.length ? roundsRaw[0].id : 0
  const teamOf = new Map(raw.players.map((p) => [p.puuid, p.team_id]))

  const kills: MatchKill[] = (raw.kills ?? [])
    .map((k) => ({
      round: k.round - base,
      tMatch: k.time_in_match_in_ms / 1000,
      tRound: k.time_in_round_in_ms / 1000,
      killer: k.killer?.puuid ?? '',
      victim: k.victim?.puuid ?? '',
      killerTeam: k.killer?.team ?? teamOf.get(k.killer?.puuid ?? '') ?? '',
      victimTeam: k.victim?.team ?? teamOf.get(k.victim?.puuid ?? '') ?? '',
      weapon: k.weapon?.name ?? null,
      weaponId: k.weapon?.id ?? null,
      assistants: (k.assistants ?? []).map((a) => a.puuid)
    }))
    .sort((a, b) => a.tMatch - b.tMatch)

  const rounds: MatchRound[] = roundsRaw.map((r, index) => {
    const starts = kills.filter((k) => k.round === index).map((k) => k.tMatch - k.tRound)
    return {
      index,
      winningTeam: r.winning_team,
      result: r.result,
      ceremony: r.ceremony,
      start: median(starts),
      plant: r.plant
        ? { tRound: r.plant.round_time_in_ms / 1000, site: r.plant.site, player: r.plant.player?.puuid ?? '' }
        : null,
      defuse: r.defuse ? { tRound: r.defuse.round_time_in_ms / 1000, player: r.defuse.player?.puuid ?? '' } : null
    }
  })

  // Round without kills (rare): estimate its start between its neighbours
  for (let i = 0; i < rounds.length; i++) {
    if (rounds[i].start !== null) continue
    const prev = rounds.slice(0, i).reverse().find((r) => r.start !== null)
    const next = rounds.slice(i + 1).find((r) => r.start !== null)
    if (prev && next) {
      const steps = next.index - prev.index
      rounds[i].start = prev.start! + ((next.start! - prev.start!) * (i - prev.index)) / steps
    }
  }

  const q = raw.metadata.queue
  return {
    id: raw.metadata.match_id,
    map: raw.metadata.map?.name ?? tr('Unknown map', 'Map inconnue'),
    mapId: raw.metadata.map?.id ?? null,
    mode: q?.name ?? q?.mode_type ?? q?.id ?? 'Game',
    region: raw.metadata.region ?? '',
    startedAt: Date.parse(raw.metadata.started_at),
    length: (raw.metadata.game_length_in_ms ?? 0) / 1000,
    players: raw.players.map((p) => ({
      puuid: p.puuid,
      name: p.name,
      tag: p.tag,
      team: p.team_id,
      agent: p.agent?.name ?? '?',
      agentId: p.agent?.id ?? null,
      tier: typeof p.tier?.id === 'number' ? p.tier.id : null,
      kills: p.stats?.kills ?? 0,
      deaths: p.stats?.deaths ?? 0,
      assists: p.stats?.assists ?? 0,
      score: p.stats?.score ?? 0,
      damage: p.stats?.damage?.dealt ?? null,
      headshots: p.stats?.headshots ?? null,
      bodyshots: p.stats?.bodyshots ?? null,
      legshots: p.stats?.legshots ?? null,
      rank: p.tier?.name ?? null
    })),
    teams: raw.teams.map((t) => ({
      id: t.team_id,
      won: t.won,
      roundsWon: t.rounds?.won ?? 0,
      roundsLost: t.rounds?.lost ?? 0
    })),
    rounds,
    kills
  }
}

function parseRiotId(riotId: string): { name: string; tag: string } {
  const i = riotId.lastIndexOf('#')
  if (i <= 0 || i === riotId.length - 1) throw new Error(tr('Invalid Riot ID, expected format: Name#TAG', 'Riot ID invalide, format attendu : Pseudo#TAG'))
  return { name: riotId.slice(0, i).trim(), tag: riotId.slice(i + 1).trim() }
}

// Match history cached 2 min per account: opening several recordings in a row costs a single request
const listCache = new Map<string, { at: number; data: MatchData[] }>()

export async function recentMatches(region: Region, riotId: string, size = 10, force = false): Promise<MatchData[]> {
  const { name, tag } = parseRiotId(riotId)
  const cacheKey = `${region}|${riotId.toLowerCase()}`
  const hit = listCache.get(cacheKey)
  if (!force && hit && Date.now() - hit.at < 120000) return hit.data
  const res = await call<{ data: RawMatch[] }>(
    `/valorant/v4/matches/${region}/pc/${encodeURIComponent(name)}/${encodeURIComponent(tag)}?size=${size}`,
    tr(
      `Account “${name}#${tag}” not found in region ${region.toUpperCase()}.`,
      `Compte « ${name}#${tag} » introuvable dans la région ${region.toUpperCase()}.`
    )
  )
  const data = (res.data ?? []).map(normalizeMatch)
  listCache.set(cacheKey, { at: Date.now(), data })
  return data
}

export async function matchById(region: Region, id: string): Promise<MatchData> {
  const res = await call<{ data: RawMatch }>(
    `/valorant/v4/match/${region}/${encodeURIComponent(id.trim())}`,
    tr('Match not found: check the ID and the region.', 'Match introuvable : vérifie l’ID et la région.')
  )
  return normalizeMatch(res.data)
}

/* ------------------------------------------------------------------ Recording time */

const OBS_NAME = /(\d{4})-(\d{2})-(\d{2})[ _T](\d{2})[-_.h](\d{2})[-_.m](\d{2})/

export async function recTimes(videoPath: string): Promise<RecTimes> {
  const { duration } = await probe(videoPath)
  // Recording started while Frag was driving OBS: we know the exact time
  const meta = await getRecMeta(videoPath)
  if (meta) return { start: meta.start, end: meta.start + duration * 1000, source: 'obs', rounds: meta.rounds }
  const m = OBS_NAME.exec(basename(videoPath))
  if (m) {
    const start = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
    if (!isNaN(start)) return { start, end: start + duration * 1000, source: 'filename' }
  }
  const st = await fs.stat(videoPath)
  if (st.birthtimeMs > 0 && st.birthtimeMs < st.mtimeMs - duration * 500) {
    return { start: st.birthtimeMs, end: st.birthtimeMs + duration * 1000, source: 'birthtime' }
  }
  return { start: st.mtimeMs - duration * 1000, end: st.mtimeMs, source: 'mtime' }
}

/** Ranks recent matches by how much they overlap the recording */
export async function candidatesFor(
  videoPath: string,
  region: Region,
  riotId: string,
  force = false
): Promise<MatchCandidate[]> {
  const [matches, times, projects] = await Promise.all([
    recentMatches(region, riotId, 10, force),
    recTimes(videoPath),
    allProjects()
  ])
  const self = projectKey(videoPath)
  const linked = new Map<string, string[]>()
  for (const p of projects) {
    if (!p.match || projectKey(p.videoPath) === self) continue
    linked.set(p.match.match.id, [...(linked.get(p.match.match.id) ?? []), p.videoPath])
  }
  return matches
    .map((match) => {
      const mStart = match.startedAt
      const mEnd = mStart + match.length * 1000
      const inter = Math.max(0, Math.min(times.end, mEnd) - Math.max(times.start, mStart))
      const denom = Math.max(1, Math.min(times.end - times.start, mEnd - mStart))
      return {
        match,
        overlap: Math.min(1, inter / denom),
        coverage: Math.min(1, inter / Math.max(1, mEnd - mStart)),
        recSeconds: (times.end - times.start) / 1000,
        linkedElsewhere: linked.get(match.id) ?? []
      }
    })
    .sort((a, b) => b.overlap - a.overlap || b.match.startedAt - a.match.startedAt)
}
