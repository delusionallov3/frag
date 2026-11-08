import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { AutoRecStatus } from '@shared/types'

let tray: Tray | null = null
let lastLabel = ''
export interface TrayHandlers {
  show: () => void
  quit: () => void
  openRecs: () => void
  openClips: () => void
  installUpdate: () => void
}

let handlers: TrayHandlers | null = null
let recording = false
/** version téléchargée, prête à installer */
let updateReady: string | null = null
let idleIcon: Electron.NativeImage | null = null
let recIcon: Electron.NativeImage | null = null

/** Icône : dans resources/ une fois installée (extraResources), sinon dans build/ en dev */
export function iconPath(): string {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const packaged = join(process.resourcesPath, file)
  if (app.isPackaged && existsSync(packaged)) return packaged
  return join(__dirname, '../../build', file)
}

/** Icône d'origine + point rouge en bas à droite, dessiné pixel par pixel (pas de fichier en plus à livrer) */
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
      // bord sombre pour que le point ressorte sur l'icône, puis rouge vif
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
  if (!s || !s.enabled) return 'Enregistrement auto : désactivé'
  if (s.recording) return s.ownRecording ? '● Rec en cours' : '● OBS enregistre'
  if (s.obs === 'auth') return 'Enregistrement auto : mot de passe OBS refusé'
  if (s.obs !== 'ready') return 'Enregistrement auto : OBS non connecté'
  if (s.stopAt) return 'Enregistrement auto : arrêt de la rec imminent'
  return 'Enregistrement auto : en attente d’une game'
}

function rebuild(label: string): void {
  if (!tray || !handlers) return
  const h = handlers
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Ouvrir Frag', click: () => h.show() },
      ...(updateReady
        ? ([{ label: `Redémarrer pour installer la ${updateReady}`, click: () => h.installUpdate() }] as const)
        : []),
      { type: 'separator' },
      { label, enabled: false },
      { type: 'separator' },
      { label: 'Ouvrir le dossier des recs', click: () => h.openRecs() },
      { label: 'Ouvrir le dossier des clips', click: () => h.openClips() },
      { type: 'separator' },
      { label: 'Quitter', click: () => h.quit() }
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
  lastLabel = recLabel(status)
  rebuild(lastLabel)
}

/** À appeler à chaque changement d'état de l'enregistrement auto : ne reconstruit le menu que si le texte change */
export function updateTrayStatus(status: AutoRecStatus): void {
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
