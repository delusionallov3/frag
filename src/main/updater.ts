import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types'

/**
 * Mises à jour via les releases GitHub (electron-updater lit latest.yml dans la dernière release).
 * La nouvelle version se télécharge en arrière-plan puis s'installe quand on quitte Frag,
 * ou tout de suite si on clique « Redémarrer pour mettre à jour ».
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
    // Une mise à jour déjà téléchargée reste installable même si une vérification suivante échoue
    if (status.state === 'ready') return
    set({ state: 'error', error: e instanceof Error ? e.message : String(e), checkedAt: Date.now() })
  })

  // Premier contrôle un peu après le lancement, pour ne pas ralentir le démarrage
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

/** Quitte Frag et lance l'installeur de la nouvelle version (sans fenêtre), puis relance Frag */
export function installUpdate(): void {
  if (status.state !== 'ready') return
  autoUpdater.quitAndInstall(true, true)
}
