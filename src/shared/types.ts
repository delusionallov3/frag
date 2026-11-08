import type { Lang } from './i18n'

export type ExportMode = 'precise' | 'fast'
export type ExportQuality = 'high' | 'balanced' | 'light'
export type AudioMode = 'all' | 'first' | 'mix'
export type EncoderPref = 'auto' | 'nvenc' | 'cpu'

export type Region = 'eu' | 'na' | 'ap' | 'kr' | 'latam' | 'br'

export interface RiotAccount {
  /** Name#TAG as returned by Riot (correct casing) */
  riotId: string
  puuid: string | null
  region: Region
  level: number | null
  /** player card id (for the avatar) */
  card: string | null
  verified: boolean
}

export interface KeyTest {
  ok: boolean
  error?: string
  /** requests allowed in the shortest window (X-RateLimit-Limit header) */
  limit: number | null
  remaining: number | null
  resetIn: number | null
}

export interface RateInfo {
  limit: number
  usedLastMinute: number
  detectedLimit: number | null
  remaining: number | null
  waitingUntil: number | null
}

export interface Settings {
  recsFolder: string | null
  outputFolder: string | null
  exportMode: ExportMode
  quality: ExportQuality
  audio: AudioMode
  encoder: EncoderPref
  volume: number
  /** Riot accounts verified through HenrikDev, the first one is the default */
  accounts: RiotAccount[]
  /** Default region (used when an account hasn't been verified yet) */
  region: Region
  /** Max HenrikDev requests per minute (depends on the key type) */
  rateLimit: number
  /** Seconds added before the first kill / after the last one for auto clips */
  preRoll: number
  postRoll: number
  /** True when a HenrikDev key is saved (the key itself stays on the system side, encrypted) */
  hasHenrikKey: boolean
  /** Below this length (minutes) a recording is "short": never linked automatically */
  minLinkMinutes: number
  /** Hide short recordings in the library */
  hideShortRecs: boolean
  /** OBS control */
  obs: ObsSettings
  /** True when an OBS password is saved (encrypted) */
  hasObsPassword: boolean
  /** The close button hides Frag in the system tray instead of quitting */
  closeToTray: boolean
  /** Start Frag (hidden) when signing in to Windows */
  launchAtLogin: boolean
  /** Windows notifications (end of game, OBS not running, exports done) */
  notifications: boolean
  /** The "Frag is still running" hint was already shown */
  trayHintShown: boolean
  /** Interface language */
  language: Lang
  /** Keyboard layout used for shortcuts that depend on symbol keys */
  keyboardLayout: KeyboardLayout
  /** Last version whose "What's new" was seen (null on a fresh install) */
  lastSeenVersion: string | null
}

export type KeyboardLayout = 'qwerty' | 'azerty'

export interface ObsSettings {
  /** Start / stop recording automatically based on Valorant */
  enabled: boolean
  host: string
  port: number
  /** when to start: agent select or game loading */
  startOn: 'pregame' | 'ingame'
  /** seconds to wait after the game ends before stopping */
  stopDelay: number
  /** link the recording to its match once the game is over */
  autoLink: boolean
  /** rename the recording when the game ends (map · mode · score) */
  renameRecs: boolean
}

export type ObsConn = 'off' | 'connecting' | 'ready' | 'auth' | 'error'
export type GameState = 'closed' | 'menus' | 'pregame' | 'ingame'

export interface AutoRecStatus {
  enabled: boolean
  obs: ObsConn
  obsError: string | null
  obsVersion: string | null
  recording: boolean
  /** the current recording was started by Frag */
  ownRecording: boolean
  recStartedAt: number | null
  game: GameState
  /** readable message for the last action ("Recording started", "Recording stopped"…) */
  last: string | null
  /** planned stop (epoch ms) after the game ends */
  stopAt: number | null
}

export interface ObsTest {
  ok: boolean
  error?: string
  version?: string
  recordDirectory?: string | null
}

export interface MatchSummary {
  map: string
  mapId: string | null
  agent: string
  agentId: string | null
  won: boolean | null
  score: string
  mode: string
  kills: number
  deaths: number
  assists: number
  tier: number | null
  rank: string | null
  synced: boolean
}

export interface VideoEntry {
  path: string
  name: string
  size: number
  mtime: number
  clipCount: number
  match: MatchSummary | null
  /** length in seconds (null if unreadable, e.g. while still recording) */
  duration: number | null
}

/* ------------------------------------------------------------------ Match (HenrikDev) */

export interface MatchPlayer {
  puuid: string
  name: string
  tag: string
  team: string
  agent: string
  agentId?: string | null
  /** competitive rank number (0-27) */
  tier?: number | null
  kills: number
  deaths: number
  assists: number
  score: number
  rank: string | null
  /** damage dealt over the match */
  damage?: number | null
  headshots?: number | null
  bodyshots?: number | null
  legshots?: number | null
}

export interface MatchKill {
  /** 0-based round index */
  round: number
  /** seconds since the match started */
  tMatch: number
  /** seconds since the round started (barriers) */
  tRound: number
  killer: string
  victim: string
  killerTeam: string
  victimTeam: string
  weapon: string | null
  weaponId?: string | null
  assistants: string[]
}

export interface MatchRound {
  /** index 0-based */
  index: number
  winningTeam: string
  result: string
  ceremony: string
  /** match time (s) when the round starts (barriers), null if unknown */
  start: number | null
  plant: { tRound: number; site: string; player: string } | null
  defuse: { tRound: number; player: string } | null
}

export interface MatchTeam {
  id: string
  won: boolean
  roundsWon: number
  roundsLost: number
}

export interface MatchData {
  id: string
  map: string
  mapId?: string | null
  mode: string
  region: string
  /** epoch ms */
  startedAt: number
  /** seconds */
  length: number
  players: MatchPlayer[]
  teams: MatchTeam[]
  rounds: MatchRound[]
  kills: MatchKill[]
}

export interface SyncAnchor {
  id: string
  /** match time (s) */
  matchTime: number
  /** video time (s) */
  videoTime: number
  label: string
}

export interface MatchLink {
  match: MatchData
  /** tracked player */
  puuid: string
  /** estimated auto offset (match time - video time), from the recording's time */
  autoOffset: number | null
  anchors: SyncAnchor[]
}

export interface RecTimes {
  /** recording start, epoch ms */
  start: number
  end: number
  source: 'obs' | 'birthtime' | 'filename' | 'mtime'
  /** round ends noted during the game (auto-record) */
  rounds?: RecRound[]
}

export interface AutoSyncResult {
  /** offset found (match time - video time) */
  offset: number
  /** 0..1 */
  confidence: number
  /** kills used for the computation */
  kills: number
  score: number
}

export interface MatchCandidate {
  match: MatchData
  /** overlap between the recording and the match, 0..1 (relative to the shorter of the two) */
  overlap: number
  /** share of the match covered by the recording, 0..1 */
  coverage: number
  /** recording length in seconds */
  recSeconds: number
  /** other recordings already linked to this match (paths) */
  linkedElsewhere: string[]
}

export interface VideoMeta {
  duration: number
  width: number
  height: number
  fps: number
  audioTracks: number
  codec: string
}

export interface CardInfo {
  meta: VideoMeta | null
  poster: string | null
  error?: string
}

export interface Clip {
  id: string
  name: string
  start: number
  end: number
}

export interface Marker {
  id: string
  time: number
  /** optional text (e.g. "End of round 7 · 4-3", added during the game) */
  label?: string
}

/** Round end seen while recording (score read from the Riot client) */
export interface RecRound {
  /** 0-based index of the round that just ended */
  round: number
  /** time in the recording (s) */
  t: number
  ally: number
  enemy: number
  allyWon: boolean
}

export interface ReviewNote {
  tags: string[]
  note: string
}

export interface Project {
  videoPath: string
  clips: Clip[]
  markers: Marker[]
  match?: MatchLink | null
  /** Review mode notes, per moment (stable key) */
  review?: Record<string, ReviewNote>
  updatedAt: number
}

/** A linked match, as seen by the Stats page */
export interface StatsEntry {
  videoPath: string
  link: MatchLink
  review: Record<string, ReviewNote>
  clips: Clip[]
}

export interface ThumbStrip {
  dir: string
  interval: number
  count: number
}

export interface Waveform {
  peaks: Uint8Array
  perSecond: number
}

export interface ExportOptions {
  mode: ExportMode
  quality: ExportQuality
  audio: AudioMode
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export type CardStyle = 'none' | 'classic' | 'bar' | 'slab' | 'cinema' | 'count' | 'hud'

/** How a title card layer enters the screen */
export type CardAnim = 'fade' | 'slide' | 'rise' | 'barTop' | 'barBottom'

/**
 * A piece of a title card, drawn by the UI (1920×1080 canvas)
 * then overlaid and animated by ffmpeg at the start of the clip.
 */
export interface CardLayer {
  /** transparent PNG; missing for the letterbox bars (barTop / barBottom) */
  png?: Uint8Array
  x: number
  y: number
  w: number
  h: number
  /** horizontally centered in the frame (x ignored) */
  center?: boolean
  anim: CardAnim
  /** appears at (s from the clip start) */
  delay: number
  /** disappears at (s from the clip start), -1 = until the end of the clip */
  until: number
}

export interface MontageItem {
  videoPath: string
  start: number
  end: number
  /** title card already drawn (empty = none) */
  layers: CardLayer[]
  /** Broadcast style: what this highlight is (drawn as a lower third, kills drive the punch-ins) */
  motion?: MotionHighlight | null
}

/** One highlight in a Broadcast montage */
export interface MotionHighlight {
  /** "3K", "ACE", "1K"… */
  label: string
  /** 1-based round number */
  round: number
  /** my team's score after the round, "5–2" */
  score: string
  /** "Clutch 1v2" or null */
  clutch: string | null
  weapon: string | null
  /** valorant-api image URL (killfeed silhouette) */
  weaponIcon: string | null
  /** my kills, seconds from the clip start */
  kills: number[]
}

/** The match intro of a Broadcast montage */
export interface MotionIntro {
  map: string
  mode: string
  /** epoch ms */
  date: number
  us: number
  them: number
  agent: string
  /** "Diamond 2" */
  tier: string | null
  kda: string
  acs: number | null
  adr: number | null
  /** headshot % */
  hs: number | null
  /** valorant-api image URLs */
  splash: string | null
  portrait: string | null
  rankIcon: string | null
  /** interface language for the few words on screen */
  lang: 'en' | 'fr'
}

export interface MontageOptions {
  /** crossfade length between two clips, 0 = hard cut (classic style) */
  transition: number
  name: string
  /** classic: fades and title cards; broadcast: match intro, red wipes, lower thirds, punch-ins on kills */
  style?: 'classic' | 'broadcast'
  intro?: MotionIntro | null
}

export interface ExportJob {
  id: string
  kind?: 'clip' | 'montage'
  videoPath: string
  clipName: string
  start: number
  end: number
  options: ExportOptions
  outputPath: string
  status: JobStatus
  progress: number
  encoder?: 'nvenc' | 'cpu' | 'copy'
  error?: string
  createdAt: number
  finishedAt?: number
}

export interface EncoderInfo {
  nvenc: boolean
}

/* ------------------------------------------------------------------ Valorant assets (valorant-api.com) */

export interface AgentAsset {
  uuid: string
  name: string
  role: string | null
  icon: string | null
  killfeed: string | null
  portrait: string | null
  colors: string[]
}

export interface MapAsset {
  uuid: string
  name: string
  /** in-game path (/Game/Maps/Ascent/Ascent), to recognise the map reported by the Riot client */
  path?: string | null
  splash: string | null
  listView: string | null
}

export interface WeaponAsset {
  uuid: string
  name: string
  killfeed: string | null
  icon: string | null
}

export interface TierAsset {
  tier: number
  name: string
  icon: string | null
  color: string | null
}

export interface ValAssets {
  agents: AgentAsset[]
  maps: MapAsset[]
  weapons: WeaponAsset[]
  tiers: TierAsset[]
  /** spike icon (the "Spike" gear when available, else the Spike Rush mode icon) */
  spike?: string | null
  fetchedAt: number
}

/* ------------------------------------------------------------------ Updates (GitHub releases) */

export interface UpdateStatus {
  /** installed version */
  current: string
  /**
   * dev: no updates in development builds
   * idle: not checked yet · checking: checking · none: already up to date
   * downloading: new version downloading · ready: downloaded, installs on restart
   */
  state: 'dev' | 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'
  /** version found on GitHub */
  version: string | null
  /** 0 to 1 while downloading */
  progress: number
  error: string | null
  checkedAt: number | null
}
