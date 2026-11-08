import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

/**
 * Updates from GitHub releases (electron-updater reads latest.yml from the latest release).
 * The new version downloads in the background, then installs when Frag quits,
 * or right away from "Restart to update".
 */

const CHECK_EVERY = 4 * 60 * 60 * 1000

let status: UpdateStatus = {
  current: app.getVersion(),
  state: app.isPackaged ? 'idle' : 'dev',
  version: null,
  progress: 0,
  error: null,
  checkedAt: null
}

let listener: (s: UpdateStatus) => void = () => {}
let onReady: (version: string) => void = () => {}
let timer: NodeJS.Timeout | null = null

function set(patch: Partial<UpdateStatus>): void {
  status = { ...status, ...patch }
  listener(status)
}

export function updateStatus(): UpdateStatus {
  return status
}

export function startUpdater(onStatus: (s: UpdateStatus) => void, onUpdateReady: (version: string) => void): void {
  listener = onStatus
  onReady = onUpdateReady
  if (!app.isPackaged || timer) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => {
    if (status.state !== 'ready') set({ state: 'checking', error: null })
  })
  autoUpdater.on('update-not-available', () => set({ state: 'none', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (info) =>
    set({ state: 'downloading', version: info.version, progress: 0, checkedAt: Date.now() })
  )
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: p.percent / 100 }))
  autoUpdater.on('update-downloaded', (info) => {
    const already = status.state === 'ready' && status.version === info.version
    set({ state: 'ready', version: info.version, progress: 1 })
    if (!already) onReady(info.version)
  })
  autoUpdater.on('error', (e) => {
    // A downloaded update stays installable even if a later check fails
    if (status.state === 'ready') return
    set({ state: 'error', error: e instanceof Error ? e.message : String(e), checkedAt: Date.now() })
  })

  // First check a little after launch, so startup isn't slowed down
  setTimeout(() => void checkForUpdates(), 15000)
  timer = setInterval(() => void checkForUpdates(), CHECK_EVERY)
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged || status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') {
    return status
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ state: 'error', error: e instanceof Error ? e.message : String(e), checkedAt: Date.now() })
  }
  return status
}

/** Quit Frag, run the new version's installer silently, then relaunch Frag */
export function installUpdate(): void {
  if (status.state !== 'ready') return
  autoUpdater.quitAndInstall(true, true)
}
