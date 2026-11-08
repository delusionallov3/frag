export type ExportMode = 'precise' | 'fast'
export type ExportQuality = 'high' | 'balanced' | 'light'
export type AudioMode = 'all' | 'first' | 'mix'
export type EncoderPref = 'auto' | 'nvenc' | 'cpu'

export type Region = 'eu' | 'na' | 'ap' | 'kr' | 'latam' | 'br'

export interface RiotAccount {
  /** Pseudo#TAG tel que renvoyé par Riot (bonne casse) */
  riotId: string
  puuid: string | null
  region: Region
  level: number | null
  /** id de la carte de joueur (pour l'avatar) */
  card: string | null
  verified: boolean
}

export interface KeyTest {
  ok: boolean
  error?: string
  /** requêtes autorisées sur la fenêtre la plus courte (en-tête X-RateLimit-Limit) */
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
  /** Comptes Riot vérifiés via HenrikDev, le premier est celui par défaut */
  accounts: RiotAccount[]
  /** Région par défaut (utilisée si un compte n'a pas encore été vérifié) */
  region: Region
  /** Nombre max de requêtes HenrikDev par minute (dépend du type de clé) */
  rateLimit: number
  /** Secondes ajoutées avant le premier kill / après le dernier pour les clips auto */
  preRoll: number
  postRoll: number
  /** Vrai si une clé HenrikDev est enregistrée (la clé elle-même reste côté système, chiffrée) */
  hasHenrikKey: boolean
  /** En dessous de cette durée (minutes), une rec est « courte » : jamais liée toute seule */
  minLinkMinutes: number
  /** Masquer les recs courtes dans la bibliothèque */
  hideShortRecs: boolean
  /** Pilotage d'OBS */
  obs: ObsSettings
  /** Vrai si un mot de passe OBS est enregistré (chiffré) */
  hasObsPassword: boolean
  /** La croix cache Frag dans la zone de notification au lieu de quitter */
  closeToTray: boolean
  /** Lancer Frag (caché) à l'ouverture de session Windows */
  launchAtLogin: boolean
  /** Notifications Windows (fin de game, OBS pas lancé, exports finis) */
  notifications: boolean
  /** La bulle « Frag tourne toujours » a déjà été montrée */
  trayHintShown: boolean
}

export interface ObsSettings {
  /** Démarrer / arrêter l'enregistrement tout seul selon Valorant */
  enabled: boolean
  host: string
  port: number
  /** quand démarrer : sélection d'agent ou chargement de la game */
  startOn: 'pregame' | 'ingame'
  /** secondes d'attente après la fin de la game avant d'arrêter */
  stopDelay: number
  /** lier tout seul la rec à son match une fois la game finie */
  autoLink: boolean
  /** renommer la rec à la fin de la game (map · mode · score) */
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
  /** l'enregistrement en cours a été lancé par Frag */
  ownRecording: boolean
  recStartedAt: number | null
  game: GameState
  /** message lisible pour la dernière action (« Rec lancée », « Rec arrêtée »…) */
  last: string | null
  /** arrêt prévu (epoch ms) après la fin de la game */
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
  /** durée en secondes (null si illisible, par exemple pendant l'enregistrement) */
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
  /** numéro de rang compétitif (0-27) */
  tier?: number | null
  kills: number
  deaths: number
  assists: number
  score: number
  rank: string | null
  /** dégâts infligés sur le match */
  damage?: number | null
  headshots?: number | null
  bodyshots?: number | null
  legshots?: number | null
}

export interface MatchKill {
  /** index de round 0-based */
  round: number
  /** secondes depuis le début du match */
  tMatch: number
  /** secondes depuis le début du round (barrières) */
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
  /** temps de match (s) où le round démarre (barrières), null si inconnu */
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
  /** secondes */
  length: number
  players: MatchPlayer[]
  teams: MatchTeam[]
  rounds: MatchRound[]
  kills: MatchKill[]
}

export interface SyncAnchor {
  id: string
  /** temps de match (s) */
  matchTime: number
  /** temps vidéo (s) */
  videoTime: number
  label: string
}

export interface MatchLink {
  match: MatchData
  /** joueur suivi */
  puuid: string
  /** décalage auto estimé (temps de match - temps vidéo), à partir de l'heure de la rec */
  autoOffset: number | null
  anchors: SyncAnchor[]
}

export interface RecTimes {
  /** epoch ms du début de l'enregistrement */
  start: number
  end: number
  source: 'obs' | 'birthtime' | 'filename' | 'mtime'
  /** fins de round notées pendant la game (enregistrement auto) */
  rounds?: RecRound[]
}

export interface AutoSyncResult {
  /** décalage trouvé (temps de match - temps vidéo) */
  offset: number
  /** 0..1 */
  confidence: number
  /** kills utilisés pour le calcul */
  kills: number
  score: number
}

export interface MatchCandidate {
  match: MatchData
  /** recouvrement entre la rec et le match, 0..1 (rapporté au plus court des deux) */
  overlap: number
  /** part du match filmée par la rec, 0..1 */
  coverage: number
  /** durée de la rec en secondes */
  recSeconds: number
  /** autres recs déjà liées à ce match (chemins) */
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
  /** texte facultatif (ex. « Fin du round 7 · 4-3 », posé pendant la game) */
  label?: string
}

/** Fin de round vue pendant l'enregistrement (score lu sur le client Riot) */
export interface RecRound {
  /** index 0-based du round qui vient de se terminer */
  round: number
  /** temps dans la rec (s) */
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
  /** notes du mode Revoir, par passage (clé stable) */
  review?: Record<string, ReviewNote>
  updatedAt: number
}

/** Un match lié, tel que vu par la page Stats */
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

/** Comment un calque de carton entre à l'écran */
export type CardAnim = 'fade' | 'slide' | 'rise' | 'barTop' | 'barBottom'

/**
 * Un morceau de carton titre, dessiné par l'interface (repère 1920×1080)
 * puis incrusté et animé par ffmpeg au début du clip.
 */
export interface CardLayer {
  /** image PNG transparente ; absente pour les bandes noires (barTop / barBottom) */
  png?: Uint8Array
  x: number
  y: number
  w: number
  h: number
  /** centré horizontalement dans l'image (x ignoré) */
  center?: boolean
  anim: CardAnim
  /** apparition (s depuis le début du clip) */
  delay: number
  /** disparition (s depuis le début du clip), -1 = jusqu'à la fin du clip */
  until: number
}

export interface MontageItem {
  videoPath: string
  start: number
  end: number
  /** carton titre déjà dessiné (vide = aucun) */
  layers: CardLayer[]
}

export interface MontageOptions {
  /** durée du fondu entre deux clips, 0 = coupe sèche */
  transition: number
  name: string
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

/* ------------------------------------------------------------------ Assets Valorant (valorant-api.com) */

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
  /** chemin interne du jeu (/Game/Maps/Ascent/Ascent), pour reconnaître la map vue par le client Riot */
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
  /** icône du spike (équipement « Spike » si dispo, sinon icône du mode Spike Rush) */
  spike?: string | null
  fetchedAt: number
}
