import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AutoRecStatus } from '@shared/types'
import { tr } from '@shared/i18n'

let tray: Tray | null = null
let lastLabel = ''
let lastStatus: AutoRecStatus | null = null

export interface TrayHandlers {
  show: () => void
  quit: () => void
  openRecs: () => void
  openClips: () => void
  installUpdate: () => void
}

let handlers: TrayHandlers | null = null
let recording = false
/** downloaded version, ready to install */
let updateReady: string | null = null
let idleIcon: Electron.NativeImage | null = null
let recIcon: Electron.NativeImage | null = null

/** Icon: in resources/ once installed (extraResources), in build/ in dev */
export function iconPath(): string {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const packaged = join(process.resourcesPath, file)
  if (app.isPackaged && existsSync(packaged)) return packaged
  return join(__dirname, '../../build', file)
}

/** Original icon + a red dot bottom right, drawn pixel by pixel (no extra file to ship) */
function withRedDot(base: Electron.NativeImage, size: number): Electron.NativeImage {
  const img = base.resize({ width: size, height: size, quality: 'best' })
  const buf = Buffer.from(img.toBitmap()) // BGRA
  const r = size * 0.24
  const cx = size - r - size * 0.02
  const cy = size - r - size * 0.02
  const ring = Math.max(1, size / 16)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d > r + ring) continue
      const i = (y * size + x) * 4
      // dark ring so the dot stands out on the icon, then bright red
      const [b, g, rr] = d > r ? [13, 11, 11] : [68, 68, 239]
      const a = Math.min(1, r + ring + 0.5 - d)
      buf[i] = Math.round(b * a + buf[i] * (1 - a))
      buf[i + 1] = Math.round(g * a + buf[i + 1] * (1 - a))
      buf[i + 2] = Math.round(rr * a + buf[i + 2] * (1 - a))
      buf[i + 3] = Math.max(buf[i + 3], Math.round(255 * a))
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

function buildRecIcon(): Electron.NativeImage {
  const png = nativeImage.createFromPath(join(iconPath(), '..', 'icon.png'))
  if (png.isEmpty()) return idleIcon ?? nativeImage.createEmpty()
  const out = nativeImage.createEmpty()
  for (const [scale, size] of [
    [1, 16],
    [1.5, 24],
    [2, 32]
  ]) {
    out.addRepresentation({ scaleFactor: scale, width: size, height: size, buffer: withRedDot(png, size).toPNG() })
  }
  return out
}

function recLabel(s: AutoRecStatus | null): string {
  const auto = tr('Auto-record', 'Enregistrement auto')
  if (!s || !s.enabled) return `${auto}: ${tr('off', 'désactivé')}`
  if (s.recording) return s.ownRecording ? `● ${tr('Recording', 'Rec en cours')}` : `● ${tr('OBS is recording', 'OBS enregistre')}`
  if (s.obs === 'auth') return `${auto}: ${tr('OBS password rejected', 'mot de passe OBS refusé')}`
  if (s.obs !== 'ready') return `${auto}: ${tr('OBS not connected', 'OBS non connecté')}`
  if (s.stopAt) return `${auto}: ${tr('stopping soon', 'arrêt de la rec imminent')}`
  return `${auto}: ${tr('waiting for a game', 'en attente d’une game')}`
}

function rebuild(label: string): void {
  if (!tray || !handlers) return
  const h = handlers
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: tr('Open Frag', 'Ouvrir Frag'), click: () => h.show() },
      ...(updateReady
        ? ([
            {
              label: tr(`Restart to install ${updateReady}`, `Redémarrer pour installer la ${updateReady}`),
              click: () => h.installUpdate()
            }
          ] as const)
        : []),
      { type: 'separator' },
      { label, enabled: false },
      { type: 'separator' },
      { label: tr('Open recordings folder', 'Ouvrir le dossier des recs'), click: () => h.openRecs() },
      { label: tr('Open clips folder', 'Ouvrir le dossier des clips'), click: () => h.openClips() },
      { type: 'separator' },
      { label: tr('Quit', 'Quitter'), click: () => h.quit() }
    ])
  )
  tray.setToolTip(label.startsWith('●') ? `Frag · ${label.slice(2)}` : 'Frag')
}

export function createTray(opts: TrayHandlers, status: AutoRecStatus | null): void {
  if (tray) return
  handlers = opts
  const img = nativeImage.createFromPath(iconPath())
  idleIcon = img.isEmpty() ? nativeImage.createEmpty() : img
  tray = new Tray(idleIcon)
  tray.on('click', () => opts.show())
  tray.on('double-click', () => opts.show())
  lastStatus = status
  lastLabel = recLabel(status)
  rebuild(lastLabel)
}

/** Language changed: rebuild the menu */
export function refreshTray(): void {
  lastLabel = recLabel(lastStatus)
  rebuild(lastLabel)
}

/** Call on every auto-record state change: only rebuilds the menu when its text changes */
export function updateTrayStatus(status: AutoRecStatus): void {
  lastStatus = status
  if (tray && status.recording !== recording) {
    recording = status.recording
    if (recording && !recIcon) recIcon = buildRecIcon()
    tray.setImage(recording && recIcon ? recIcon : idleIcon!)
  }
  const label = recLabel(status)
  if (label === lastLabel) return
  lastLabel = label
  rebuild(label)
}

export function setTrayUpdate(version: string | null): void {
  updateReady = version
  rebuild(lastLabel)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
