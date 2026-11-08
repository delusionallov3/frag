import { app, safeStorage } from 'electron'
import { createHash } from 'crypto'
import { promises as fs, mkdirSync, existsSync } from 'fs'
import { join, normalize } from 'path'
import type { MatchSummary, Project, RecRound, Settings, StatsEntry } from '@shared/types'
import { setLang } from '@shared/i18n'

const DEFAULT_SETTINGS: Settings = {
  recsFolder: null,
  outputFolder: null,
  exportMode: 'precise',
  quality: 'high',
  audio: 'all',
  encoder: 'auto',
  volume: 0.8,
  accounts: [],
  region: 'eu',
  rateLimit: 30,
  preRoll: 4,
  postRoll: 2,
  hasHenrikKey: false,
  minLinkMinutes: 5,
  hideShortRecs: false,
  obs: { enabled: false, host: '127.0.0.1', port: 4455, startOn: 'ingame', stopDelay: 8, autoLink: true, renameRecs: true, markKey: 'F9' },
  hasObsPassword: false,
  closeToTray: true,
  launchAtLogin: false,
  notifications: true,
  language: 'en',
  keyboardLayout: 'qwerty',
  lastSeenVersion: null,
  trayHintShown: false
}

export const paths = {
  get root(): string {
    return app.getPath('userData')
  },
  get settings(): string {
    return join(this.root, 'settings.json')
  },
  get projects(): string {
    return join(this.root, 'projects')
  },
  get cache(): string {
    return join(this.root, 'cache')
  }
}

export function ensureDirs(): void {
  mkdirSync(paths.projects, { recursive: true })
  mkdirSync(paths.cache, { recursive: true })
}

export function hash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16)
}

/** Project key: based on the path only, so clips survive if the file is touched. */
export function projectKey(videoPath: string): string {
  // normalize: "C:/x" and "C:\x" give the same key on Windows
  return hash(normalize(videoPath).toLowerCase())
}

/** Cache key: path + size + date, so it regenerates when the file changes. */
export async function cacheDir(videoPath: string): Promise<string> {
  const st = await fs.stat(videoPath)
  const dir = join(paths.cache, hash(`${videoPath.toLowerCase()}|${st.size}|${Math.floor(st.mtimeMs)}`))
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

/**
 * Safe JSON write:
 * - one write at a time per file (otherwise two quick saves step on each other)
 * - unique temp file, then rename
 * - on Windows the rename sometimes fails for a few ms (antivirus, indexing): retry,
 *   and as a last resort write straight into the file
 */
const writeQueues = new Map<string, Promise<void>>()
let tmpCounter = 0

async function writeJsonNow(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${++tmpCounter}.tmp`
  await fs.writeFile(tmp, text, 'utf8')
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, file)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt < 8 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)))
        continue
      }
      // Last resort: direct write
      await fs.writeFile(file, text, 'utf8')
      await fs.rm(tmp, { force: true }).catch(() => {})
      return
    }
  }
}

function writeJson(file: string, data: unknown): Promise<void> {
  const text = JSON.stringify(data, null, 2)
  const prev = writeQueues.get(file) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(() => writeJsonNow(file, text))
  writeQueues.set(file, next)
  void next.finally(() => {
    if (writeQueues.get(file) === next) writeQueues.delete(file)
  }).catch(() => {})
  return next
}

let settingsCache: Settings | null = null

export async function getSettings(): Promise<Settings> {
  if (!settingsCache) {
    const saved = await readJson<Partial<Settings> & { riotIds?: string[] }>(paths.settings)
    const { riotIds, ...rest } = saved ?? {}
    settingsCache = { ...DEFAULT_SETTINGS, ...rest, obs: { ...DEFAULT_SETTINGS.obs, ...(rest.obs ?? {}) } }
    // Old version: plain list of Riot IDs → accounts to verify
    if (riotIds?.length && !rest.accounts) {
      settingsCache.accounts = riotIds.map((riotId) => ({
        riotId,
        puuid: null,
        region: settingsCache!.region,
        level: null,
        card: null,
        verified: false
      }))
    }
  }
  setLang(settingsCache.language)
  return { ...settingsCache, hasHenrikKey: existsSync(keyFile()), hasObsPassword: existsSync(obsFile()) }
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const { hasHenrikKey: _ignored, hasObsPassword: _ignored2, ...rest } = patch
  void _ignored
  void _ignored2
  const cur = await getSettings()
  const next = { ...cur, ...rest, obs: { ...cur.obs, ...(rest.obs ?? {}) } }
  settingsCache = next
  const { hasHenrikKey: _h, hasObsPassword: _o, ...toSave } = next
  void _h
  void _o
  await writeJson(paths.settings, toSave)
  return getSettings()
}

/* ------------------------------------------------------------------ HenrikDev key (encrypted by Windows) */

const keyFile = (): string => join(paths.root, 'henrik.key')
const obsFile = (): string => join(paths.root, 'obs.key')

async function setSecret(file: string, value: string | null): Promise<void> {
  if (!value) {
    await fs.rm(file, { force: true })
    return
  }
  const data = safeStorage.isEncryptionAvailable()
    ? Buffer.concat([Buffer.from('ENC1'), safeStorage.encryptString(value)])
    : Buffer.from(`RAW1${value}`)
  await fs.writeFile(file, data)
}

async function getSecret(file: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(file)
    const tag = buf.subarray(0, 4).toString()
    if (tag === 'ENC1') return safeStorage.decryptString(buf.subarray(4))
    if (tag === 'RAW1') return buf.subarray(4).toString()
    return null
  } catch {
    return null
  }
}

export const setHenrikKey = (key: string | null): Promise<void> => setSecret(keyFile(), key)
export const getHenrikKey = (): Promise<string | null> => getSecret(keyFile())
export const setObsPassword = (pw: string | null): Promise<void> => setSecret(obsFile(), pw)
export const getObsPassword = (): Promise<string | null> => getSecret(obsFile())

export async function getProject(videoPath: string): Promise<Project> {
  const saved = await readJson<Project>(join(paths.projects, `${projectKey(videoPath)}.json`))
  return saved ?? { videoPath, clips: [], markers: [], updatedAt: 0 }
}

export async function saveProject(project: Project): Promise<void> {
  await writeJson(join(paths.projects, `${projectKey(project.videoPath)}.json`), {
    ...project,
    updatedAt: Date.now()
  })
}

/** All projects (Stats page and montage) */
export async function allProjects(): Promise<Project[]> {
  let files: string[] = []
  try {
    files = (await fs.readdir(paths.projects)).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const out: Project[] = []
  for (const f of files) {
    const p = await readJson<Project>(join(paths.projects, f))
    if (p) out.push(p)
  }
  return out
}

/**
 * One entry per match: when several recordings are linked to the same match (a test rec + the real one),
 * keep the most useful one (synced, with notes or clips, then the longest)
 */
export async function statsEntries(durationOf: (path: string) => Promise<number>): Promise<StatsEntry[]> {
  const entries = (await allProjects())
    .filter((p) => p.match && p.match.puuid)
    .map((p) => ({ videoPath: p.videoPath, link: p.match!, review: p.review ?? {}, clips: p.clips }))
  const byMatch = new Map<string, StatsEntry[]>()
  for (const e of entries) byMatch.set(e.link.match.id, [...(byMatch.get(e.link.match.id) ?? []), e])
  const out: StatsEntry[] = []
  for (const group of byMatch.values()) {
    if (group.length === 1) {
      out.push(group[0])
      continue
    }
    const scored = await Promise.all(
      group.map(async (e) => ({
        e,
        score:
          (e.link.anchors?.length ? 1e6 : 0) +
          (Object.keys(e.review).length + e.clips.length) * 1e4 +
          (await durationOf(e.videoPath).catch(() => 0))
      }))
    )
    scored.sort((a, b) => b.score - a.score)
    out.push(scored[0].e)
  }
  return out.sort((a, b) => a.link.match.startedAt - b.link.match.startedAt)
}

/* ------------------------------------------------------------------ Recording info (OBS driven by Frag) */

export interface RecMeta {
  path: string
  /** exact start in epoch ms (OBS event) */
  start: number
  end: number | null
  /** started by Frag, or detected during a game */
  by: 'frag' | 'obs'
  /** round ends seen during the game */
  rounds?: RecRound[]
}

const recMetaFile = (): string => join(paths.root, 'recmeta.json')
let recMetaCache: Record<string, RecMeta> | null = null

async function loadRecMeta(): Promise<Record<string, RecMeta>> {
  if (!recMetaCache) recMetaCache = (await readJson<Record<string, RecMeta>>(recMetaFile())) ?? {}
  return recMetaCache
}

export async function getRecMeta(videoPath: string): Promise<RecMeta | null> {
  return (await loadRecMeta())[projectKey(videoPath)] ?? null
}

export async function setRecMeta(meta: RecMeta): Promise<void> {
  const all = await loadRecMeta()
  all[projectKey(meta.path)] = meta
  await writeJson(recMetaFile(), all)
}

export async function deleteProject(videoPath: string): Promise<void> {
  await fs.rm(join(paths.projects, `${projectKey(videoPath)}.json`), { force: true })
}

export async function projectSummary(videoPath: string): Promise<{ clipCount: number; match: MatchSummary | null }> {
  const saved = await readJson<Project>(join(paths.projects, `${projectKey(videoPath)}.json`))
  if (!saved) return { clipCount: 0, match: null }
  let match: MatchSummary | null = null
  const link = saved.match
  if (link) {
    const me = link.match.players.find((p) => p.puuid === link.puuid)
    const mine = link.match.teams.find((t) => t.id === me?.team)
    match = {
      map: link.match.map,
      mapId: link.match.mapId ?? null,
      agent: me?.agent ?? '',
      agentId: me?.agentId ?? null,
      won: mine ? mine.won : null,
      score: mine ? `${mine.roundsWon}–${mine.roundsLost}` : '',
      mode: link.match.mode,
      kills: me?.kills ?? 0,
      deaths: me?.deaths ?? 0,
      assists: me?.assists ?? 0,
      tier: me?.tier ?? null,
      rank: me?.rank ?? null,
      synced: (link.anchors?.length ?? 0) > 0
    }
  }
  return { clipCount: saved.clips.length, match }
}

export { readJson, writeJson }
