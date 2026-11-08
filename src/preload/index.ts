import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AutoRecStatus,
  AutoSyncResult,
  CardInfo,
  Clip,
  EncoderInfo,
  ExportJob,
  ExportOptions,
  KeyTest,
  MatchCandidate,
  MatchData,
  MontageItem,
  MontageOptions,
  ObsTest,
  Project,
  RateInfo,
  RecTimes,
  Region,
  RiotAccount,
  Settings,
  StatsEntry,
  ThumbStrip,
  ValAssets,
  VideoEntry,
  VideoMeta,
  Waveform
} from '@shared/types'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

const on = <T>(channel: string, fn: (payload: T) => void): (() => void) => {
  const handler = (_e: unknown, payload: T): void => fn(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  platform: process.platform,
  getSettings: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:set', patch),
  pickFolder: (title: string): Promise<string | null> => ipcRenderer.invoke('dialog:folder', title),
  pickVideo: (): Promise<string | null> => ipcRenderer.invoke('dialog:video'),

  listVideos: (): Promise<VideoEntry[]> => ipcRenderer.invoke('library:list'),
  onLibraryChanged: (fn: () => void) => on('library:changed', fn),
  trashVideo: (path: string): Promise<Result<void>> => ipcRenderer.invoke('library:trash', path),

  card: (path: string): Promise<CardInfo> => ipcRenderer.invoke('video:card', path),
  probe: (path: string): Promise<VideoMeta> => ipcRenderer.invoke('video:probe', path),
  frame: (path: string, t: number): Promise<Result<string>> => ipcRenderer.invoke('video:frame', path, t),
  thumbs: (path: string): Promise<ThumbStrip> => ipcRenderer.invoke('video:thumbs', path),
  waveform: (path: string): Promise<Waveform> => ipcRenderer.invoke('video:waveform', path),

  getProject: (path: string): Promise<Project> => ipcRenderer.invoke('project:get', path),
  saveProject: (project: Project): Promise<void> => ipcRenderer.invoke('project:save', project),

  exportClips: (videoPath: string, clips: Clip[], options: ExportOptions): Promise<ExportJob[]> =>
    ipcRenderer.invoke('export:enqueue', videoPath, clips, options),
  exportMontage: (items: MontageItem[], opts: MontageOptions): Promise<Result<ExportJob>> =>
    ipcRenderer.invoke('export:montage', items, opts),
  listJobs: (): Promise<ExportJob[]> => ipcRenderer.invoke('export:list'),
  cancelJob: (id: string): Promise<void> => ipcRenderer.invoke('export:cancel', id),
  retryJob: (id: string): Promise<void> => ipcRenderer.invoke('export:retry', id),
  clearJobs: (): Promise<void> => ipcRenderer.invoke('export:clear'),
  encoders: (): Promise<EncoderInfo> => ipcRenderer.invoke('export:encoders'),
  outputFolder: (): Promise<string | null> => ipcRenderer.invoke('export:outputFolder'),
  onJobs: (fn: (jobs: ExportJob[]) => void) => on('export:jobs', fn),

  setHenrikKey: (
    key: string | null
  ): Promise<{ ok: boolean; error?: string; settings: Settings; test: KeyTest | null }> =>
    ipcRenderer.invoke('henrik:setKey', key),
  testStoredKey: (): Promise<KeyTest> => ipcRenderer.invoke('henrik:testStoredKey'),
  rateInfo: (): Promise<RateInfo> => ipcRenderer.invoke('henrik:rate'),
  verifyAccount: (riotId: string): Promise<Result<RiotAccount>> => ipcRenderer.invoke('henrik:verifyAccount', riotId),
  matchCandidates: (path: string, region: Region, riotId: string, force = false): Promise<Result<MatchCandidate[]>> =>
    ipcRenderer.invoke('henrik:candidates', path, region, riotId, force),
  matchById: (region: Region, id: string): Promise<Result<MatchData>> => ipcRenderer.invoke('henrik:match', region, id),
  recTimes: (path: string): Promise<Result<RecTimes>> => ipcRenderer.invoke('video:recTimes', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  assets: (): Promise<ValAssets | null> => ipcRenderer.invoke('assets:get'),
  statsEntries: (): Promise<StatsEntry[]> => ipcRenderer.invoke('stats:entries'),
  autoSync: (path: string, match: MatchData, guess: number | null): Promise<Result<AutoSyncResult>> =>
    ipcRenderer.invoke('match:autosync', path, match, guess),
  onAutoSyncProgress: (fn: (p: { path: string; progress: number }) => void) => on('autosync:progress', fn),
  allProjects: (): Promise<Project[]> => ipcRenderer.invoke('projects:all'),
  refreshAssets: (): Promise<{ assets: ValAssets | null; error: string | null }> => ipcRenderer.invoke('assets:refresh'),

  showItem: (path: string): Promise<void> => ipcRenderer.invoke('shell:showItem', path),
  openFolder: (path: string): Promise<string> => ipcRenderer.invoke('shell:openFolder', path),

  obsTest: (host: string, port: number, password: string | null): Promise<ObsTest> =>
    ipcRenderer.invoke('obs:test', host, port, password),
  setObsPassword: (password: string | null): Promise<Settings> => ipcRenderer.invoke('obs:setPassword', password),
  autoRecStatus: (): Promise<AutoRecStatus> => ipcRenderer.invoke('autorec:status'),
  onAutoRecStatus: (fn: (s: AutoRecStatus) => void) => on('autorec:status', fn),
  onProjectLinked: (fn: (path: string) => void) => on('project:linked', fn),
  /** Clic sur une notification : ouvrir une rec / les réglages */
  onOpenVideo: (fn: (path: string) => void) => on('ui:openVideo', fn),
  onOpenSettings: (fn: () => void) => on('ui:openSettings', fn),

  pathForFile: (file: File): string => webUtils.getPathForFile(file)
}

export type FragApi = typeof api

contextBridge.exposeInMainWorld('frag', api)
