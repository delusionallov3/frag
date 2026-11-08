import { promises as fs, existsSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import type { AutoRecStatus, GameState, MatchData, ObsTest, RecRound, RiotAccount } from '@shared/types'
import { autoLinkVerdict } from '@shared/link'
import { scoreSync } from '@shared/scoreSync'
import { ObsClient, ObsError } from './obs'
import { gameInfo, type GameInfo } from './riot'
import { candidatesFor, recTimes } from './henrik'
import { getAssets } from './valapi'
import { getObsPassword, getProject, getSettings, saveProject, setRecMeta } from './store'

/**
 * Pilotage d'OBS selon l'état de Valorant :
 * game qui commence → OBS enregistre ; retour aux menus → OBS s'arrête quelques secondes après ;
 * puis Frag lie la rec à son match dès que HenrikDev le connaît.
 */

const TICK = 1000

const client = new ObsClient()
let status: AutoRecStatus = {
  enabled: false,
  obs: 'off',
  obsError: null,
  obsVersion: null,
  recording: false,
  ownRecording: false,
  recStartedAt: null,
  game: 'closed',
  last: null,
  stopAt: null
}

let notify: (s: AutoRecStatus) => void = () => {}
let onLinked: (path: string) => void = () => {}
let onFiles: () => void = () => {}

/* Pendant l'enregistrement : fins de round (score du client Riot) et infos de la game */
let recRounds: RecRound[] = []
let lastScore: { ally: number; enemy: number } | null = null
let lastGame: GameInfo | null = null
const NO_ROUNDS = new Set(['deathmatch', 'ggteam', 'hurm', 'snowball'])
let timer: NodeJS.Timeout | null = null
let ticking = false
let connecting = false
let nextConnect = 0
let stopTimer: NodeJS.Timeout | null = null
/** une game a commencé pendant qu'OBS n'était pas joignable : on lance dès qu'il répond */
let pendingStart = false
/** nombre de relevés consécutifs hors game (évite d'arrêter sur un raté du client Riot) */
let outOfGame = 0

function set(patch: Partial<AutoRecStatus>): void {
  status = { ...status, ...patch }
  notify(status)
}

export function autoRecStatus(): AutoRecStatus {
  return status
}

const inGame = (g: GameState, startOn: 'pregame' | 'ingame'): boolean =>
  g === 'ingame' || (startOn === 'pregame' && g === 'pregame')

/* ------------------------------------------------------------------ OBS */

client.on('event', (type: string, data: Record<string, unknown>) => {
  if (type !== 'RecordStateChanged') return
  const state = String(data.outputState ?? '')
  if (state === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
    recRounds = []
    lastScore = null
    lastGame = null
    set({ recording: true, recStartedAt: Date.now() })
  } else if (state === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
    const path = typeof data.outputPath === 'string' ? data.outputPath : null
    const start = status.recStartedAt
    const own = status.ownRecording
    const rounds = recRounds
    const game = lastGame
    recRounds = []
    lastScore = null
    lastGame = null
    set({ recording: false, ownRecording: false, recStartedAt: null, stopAt: null })
    if (path && start) void finished(path, start, own, rounds, game)
  }
})

client.on('close', (err: ObsError) => {
  set({ obs: 'error', obsError: err.message, recording: false })
  nextConnect = Date.now() + 3000
})

async function connect(): Promise<void> {
  const s = await getSettings()
  connecting = true
  if (status.obs !== 'ready') set({ obs: 'connecting' })
  try {
    await client.connect(s.obs.host, s.obs.port, await getObsPassword())
    const rec = await client.request<{ outputActive: boolean; outputDuration?: number }>('GetRecordStatus')
    set({
      obs: 'ready',
      obsError: null,
      obsVersion: client.version,
      recording: rec.outputActive,
      ownRecording: rec.outputActive && status.ownRecording,
      recStartedAt: rec.outputActive ? Date.now() - (rec.outputDuration ?? 0) : null
    })
  } catch (e) {
    const err = e instanceof ObsError ? e : new ObsError(String(e))
    set({ obs: err.kind === 'auth' ? 'auth' : 'error', obsError: err.message })
    // mot de passe faux : inutile d'insister toutes les 2 s
    nextConnect = Date.now() + (err.kind === 'auth' ? 30000 : 5000)
  } finally {
    connecting = false
  }
}

async function startRecording(): Promise<void> {
  pendingStart = false
  if (!client.ready) {
    pendingStart = true
    set({ last: 'Game lancée, mais OBS n’est pas joignable' })
    return
  }
  try {
    const rec = await client.request<{ outputActive: boolean }>('GetRecordStatus')
    if (rec.outputActive) {
      // déjà en train d'enregistrer (lancé à la main) : on n'y touche pas
      set({ last: 'OBS enregistrait déjà, Frag n’y touche pas' })
      return
    }
    set({ ownRecording: true })
    await client.request('StartRecord')
    set({ last: 'Rec lancée' })
  } catch (e) {
    set({ ownRecording: false, last: `Impossible de lancer la rec : ${e instanceof Error ? e.message : e}` })
  }
}

async function stopRecording(): Promise<void> {
  stopTimer = null
  set({ stopAt: null })
  if (!status.ownRecording || !client.ready) return
  try {
    await client.request('StopRecord')
    set({ last: 'Rec arrêtée' })
  } catch (e) {
    set({ last: `Impossible d’arrêter la rec : ${e instanceof Error ? e.message : e}` })
  }
}

function cancelStop(): void {
  if (stopTimer) clearTimeout(stopTimer)
  stopTimer = null
  if (status.stopAt) set({ stopAt: null })
}

/* ------------------------------------------------------------------ Boucle */

async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const s = await getSettings()
    if (!s.obs.enabled) {
      if (status.enabled) {
        cancelStop()
        client.close()
        pendingStart = false
        set({ enabled: false, obs: 'off', obsError: null, game: 'closed', stopAt: null })
      }
      return
    }
    if (!status.enabled) set({ enabled: true })

    if (!client.ready && !connecting && Date.now() >= nextConnect) await connect()
    if (client.ready && pendingStart && inGame(status.game, s.obs.startOn)) await startRecording()

    const info = await gameInfo()
    const { state } = info
    if (state === 'ingame' && status.recording) trackScore(info)
    const was = inGame(status.game, s.obs.startOn)
    const now = inGame(state, s.obs.startOn)

    if (now) {
      outOfGame = 0
      cancelStop()
      if (state !== status.game) set({ game: state })
      if (!was) await startRecording()
    } else if (was) {
      outOfGame++
      // trois relevés de suite hors game avant de conclure que la game est finie
      if (outOfGame < 3) return
      outOfGame = 0
      pendingStart = false
      set({ game: state })
      if (status.ownRecording && !stopTimer) {
        const delay = Math.max(0, s.obs.stopDelay) * 1000
        set({ stopAt: Date.now() + delay, last: 'Game finie' })
        stopTimer = setTimeout(() => void stopRecording(), delay)
      }
    } else if (state !== status.game) {
      set({ game: state })
    }
  } catch (e) {
    set({ last: e instanceof Error ? e.message : String(e) })
  } finally {
    ticking = false
  }
}

/** Le score bouge d'un round : on note l'instant dans la rec */
function trackScore(info: GameInfo): void {
  lastGame = info
  if (!info.score || !status.recStartedAt) return
  if (info.queue && NO_ROUNDS.has(info.queue)) return
  if (info.scoreType && info.scoreType !== 'Rounds') return
  const prev = lastScore
  lastScore = info.score
  if (!prev) return
  const total = info.score.ally + info.score.enemy
  if (total !== prev.ally + prev.enemy + 1) return
  recRounds.push({
    round: total - 1,
    // relevé toutes les secondes : on vise le milieu de l'intervalle
    t: Math.max(0, (Date.now() - status.recStartedAt) / 1000 - 0.5),
    ally: info.score.ally,
    enemy: info.score.enemy,
    allyWon: info.score.ally > prev.ally
  })
}

export function startAutoRec(
  onStatus: (s: AutoRecStatus) => void,
  onRecLinked: (path: string) => void,
  onRecFiles: () => void
): void {
  notify = onStatus
  onLinked = onRecLinked
  onFiles = onRecFiles
  if (timer) return
  timer = setInterval(() => void tick(), TICK)
  void tick()
}

/** Réglages OBS modifiés : on se reconnecte avec les nouveaux paramètres */
export function resetObs(): void {
  client.close()
  nextConnect = 0
  set({ obs: 'off', obsError: null })
  void tick()
}

/** Test d'une connexion (réglages), sans toucher à la connexion en cours */
export async function testObs(host: string, port: number, password: string | null): Promise<ObsTest> {
  const probe = new ObsClient()
  try {
    await probe.connect(host, port, password)
    const v = await probe.request<{ obsVersion?: string }>('GetVersion')
    const dir = await probe
      .request<{ recordDirectory?: string }>('GetRecordDirectory')
      .then((r) => r.recordDirectory ?? null)
      .catch(() => null)
    return { ok: true, version: v.obsVersion ?? probe.version ?? undefined, recordDirectory: dir }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    probe.close()
  }
}

/* ------------------------------------------------------------------ Après la game : liaison au match */

const LINK_DELAYS = (process.env.FRAG_AUTOLINK_DELAYS ?? '60,180,420,900').split(',').map((n) => Number(n) * 1000)

const QUEUES: Record<string, string> = {
  competitive: 'Competitive',
  unrated: 'Unrated',
  swiftplay: 'Swiftplay',
  spikerush: 'Spike Rush',
  deathmatch: 'Deathmatch',
  ggteam: 'Escalation',
  hurm: 'Team Deathmatch',
  premier: 'Premier',
  newmap: 'New Map',
  onefa: 'Replication',
  snowball: 'Snowball Fight'
}

/** Noms de code des maps (fin du chemin interne) si valorant-api.com n'est pas joignable */
const MAP_CODES: Record<string, string> = {
  ascent: 'Ascent',
  duality: 'Bind',
  bonsai: 'Split',
  triad: 'Haven',
  port: 'Icebox',
  foxtrot: 'Breeze',
  canyon: 'Fracture',
  pitt: 'Pearl',
  jam: 'Lotus',
  juliett: 'Sunset',
  infinity: 'Abyss',
  rook: 'Corrode'
}

async function mapName(path: string | null): Promise<string | null> {
  if (!path) return null
  const assets = await getAssets().catch(() => null)
  const hit = assets?.maps.find((m) => m.path && m.path.toLowerCase() === path.toLowerCase())
  if (hit) return hit.name
  const code = path.split('/').pop()?.toLowerCase() ?? ''
  return MAP_CODES[code] ?? null
}

const OBS_STAMP = /\d{4}-\d{2}-\d{2}[ _T]\d{2}[-_.h]\d{2}[-_.m]\d{2}/

function stampOf(path: string, start: number): string {
  const found = OBS_STAMP.exec(basename(path))
  if (found) return found[0]
  const d = new Date(start)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/** « 2026-11-07 16-47-31 · Ascent · Swiftplay · 5-3.mp4 » ; garde l'ancien nom si impossible */
async function renameAfterGame(path: string, start: number, game: GameInfo, rounds: RecRound[]): Promise<string> {
  const map = await mapName(game.map)
  if (!map) return path
  const last = rounds[rounds.length - 1]
  const parts = [stampOf(path, start), map]
  if (game.queue) parts.push(QUEUES[game.queue] ?? game.queue)
  if (last) parts.push(`${last.ally}-${last.enemy}`)
  const base = parts.join(' · ').replace(/[<>:"/\\|?*]/g, '')
  const ext = extname(path)
  let target = join(dirname(path), base + ext)
  for (let i = 2; existsSync(target) && target !== path; i++) target = join(dirname(path), `${base} (${i})${ext}`)
  if (target === path) return path
  // OBS peut garder le fichier quelques instants : on réessaie pendant ~20 s
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fs.rename(path, target)
      return target
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') return path
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  return path
}

async function finished(path: string, start: number, own: boolean, rounds: RecRound[], game: GameInfo | null): Promise<void> {
  const s = await getSettings()
  const final = own && s.obs.renameRecs && game ? await renameAfterGame(path, start, game, rounds) : path
  await setRecMeta({ path: final, start, end: Date.now(), by: own ? 'frag' : 'obs', rounds }).catch(() => {})
  // Un marqueur à chaque fin de round, posé pendant la game
  if (rounds.length) {
    const project = await getProject(final)
    const markers = [
      ...project.markers,
      ...rounds.map((r) => ({ id: `round-${r.round}`, time: r.t, label: `Fin du round ${r.round + 1} · ${r.ally}-${r.enemy}` }))
    ]
    await saveProject({ ...project, markers }).catch(() => {})
  }
  onFiles()
  path = final
  if (!s.obs.autoLink) return
  // HenrikDev met quelques minutes à connaître le match : plusieurs essais espacés
  let i = 0
  const attempt = async (): Promise<void> => {
    const done = await tryLink(path).catch(() => false)
    if (!done && ++i < LINK_DELAYS.length) setTimeout(() => void attempt(), LINK_DELAYS[i] - LINK_DELAYS[i - 1])
  }
  setTimeout(() => void attempt(), LINK_DELAYS[0])
}

const findMe = (match: MatchData, account: RiotAccount): MatchData['players'][number] | undefined =>
  match.players.find((p) => account.puuid && p.puuid === account.puuid) ??
  match.players.find((p) => `${p.name}#${p.tag}`.toLowerCase() === account.riotId.toLowerCase())

/** true quand il n'y a plus rien à faire (lié, ou impossible) */
async function tryLink(path: string): Promise<boolean> {
  const s = await getSettings()
  const project = await getProject(path)
  if (project.match) return true
  if (!s.hasHenrikKey || !s.accounts.length) return true
  for (const account of s.accounts) {
    const cands = await candidatesFor(path, account.region, account.riotId, true)
    const best = cands[0]
    const me = best ? findMe(best.match, account) : undefined
    if (!best || !me || !autoLinkVerdict(best, s.minLinkMinutes).ok) continue
    const times = await recTimes(path)
    // Calage direct grâce aux fins de round notées pendant la game
    const sync = scoreSync(best.match, me.puuid, times.rounds)
    const anchors = sync
      ? [{ id: `score-${Date.now()}`, matchTime: sync.matchTime, videoTime: sync.videoTime, label: 'score des rounds' }]
      : []
    await saveProject({
      ...(await getProject(path)),
      match: { match: best.match, puuid: me.puuid, autoOffset: (times.start - best.match.startedAt) / 1000, anchors }
    })
    set({ last: `Rec liée à ta game sur ${best.match.map}${sync ? ', calée sur le score' : ''}` })
    onLinked(path)
    return true
  }
  return false
}
