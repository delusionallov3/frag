import { app, nativeImage, Notification } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import type { AutoRecStatus, ExportJob } from '@shared/types'
import { getSettings, projectSummary } from './store'
import { iconPath } from './tray'

/**
 * Notifications Windows de Frag (fin de game, OBS pas lancé, exports finis).
 * Utiles surtout quand Frag tourne caché dans la zone de notification.
 */

// Sans AppUserModelId, Windows n'affiche pas les notifications (ou les attribue à « electron.app »)
export function setupNotifications(): void {
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'gg.frag.app' : process.execPath)
}

// Une notification libérée par le ramasse-miettes ne réagit plus au clic : on les garde le temps qu'elles vivent
const alive = new Set<Notification>()

export async function notify(title: string, body: string, onClick?: () => void, force = false): Promise<void> {
  if (!Notification.isSupported()) return
  if (!force && !(await getSettings()).notifications) return
  const n = new Notification({ title, body, icon: nativeImage.createFromPath(iconPath()), silent: false })
  alive.add(n)
  const drop = (): void => {
    alive.delete(n)
  }
  n.on('click', () => {
    drop()
    onClick?.()
  })
  n.on('close', drop)
  n.on('failed', drop)
  n.show()
}

/* ------------------------------------------------------------------ OBS pas lancé alors que Valorant l'est */

function obsExe(): string | null {
  const roots = [process.env['ProgramW6432'], process.env['ProgramFiles'], process.env['ProgramFiles(x86)']]
  for (const root of roots) {
    if (!root) continue
    const exe = join(root, 'obs-studio', 'bin', '64bit', 'obs64.exe')
    if (existsSync(exe)) return exe
  }
  return null
}

/** OBS doit être lancé depuis son dossier, sinon il ne trouve pas ses fichiers */
function launchObs(exe: string): void {
  try {
    spawn(exe, ['--minimize-to-tray'], { cwd: dirname(exe), detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* tant pis, l'utilisateur le lancera à la main */
  }
}

let prevGame: AutoRecStatus['game'] = 'closed'
let warnedThisSession = false
let checkTimer: NodeJS.Timeout | null = null

/**
 * Valorant vient de s'ouvrir : si OBS ne répond toujours pas quelques secondes plus tard
 * (le temps que Frag retente la connexion), on prévient. Une seule fois par session Valorant.
 */
export function watchObsMissing(s: AutoRecStatus, getStatus: () => AutoRecStatus, openSettings: () => void): void {
  const opened = prevGame === 'closed' && s.game !== 'closed'
  if (s.game === 'closed') {
    warnedThisSession = false
    if (checkTimer) clearTimeout(checkTimer)
    checkTimer = null
  }
  prevGame = s.game
  if (!opened || warnedThisSession || !s.enabled) return
  if (checkTimer) clearTimeout(checkTimer)
  checkTimer = setTimeout(() => {
    checkTimer = null
    const now = getStatus()
    if (!now.enabled || now.obs === 'ready' || now.game === 'closed' || warnedThisSession) return
    warnedThisSession = true
    if (now.obs === 'auth') {
      void notify(
        'OBS refuse la connexion',
        'Valorant est lancé mais le mot de passe OBS est refusé : Frag ne pourra pas enregistrer. Clique pour ouvrir les réglages.',
        openSettings
      )
      return
    }
    const exe = obsExe()
    void notify(
      'OBS n’est pas lancé',
      exe
        ? 'Valorant est ouvert mais pas OBS : ta game ne sera pas enregistrée. Clique ici pour lancer OBS.'
        : 'Valorant est ouvert mais pas OBS : ta game ne sera pas enregistrée. Lance OBS avant ta game.',
      () => (exe ? launchObs(exe) : openSettings())
    )
  }, 10000)
}

/* ------------------------------------------------------------------ Fin de game : rec liée à son match */

export async function notifyLinked(path: string, open: (path: string) => void): Promise<void> {
  const { match } = await projectSummary(path).catch(() => ({ match: null }))
  if (!match) return
  const result = match.won === null ? '' : match.won ? 'Victoire ' : 'Défaite '
  const parts = [match.map, match.mode, `${result}${match.score}`.trim(), `${match.kills}/${match.deaths}/${match.assists}`]
    .filter(Boolean)
    .join(' · ')
  void notify('Rec liée à ton match', `${parts}${match.agent ? ` en ${match.agent}` : ''}. Clique pour l’ouvrir.`, () =>
    open(path)
  )
}

/* ------------------------------------------------------------------ File d'export terminée */

let batchStart: number | null = null

/** Appelé à chaque changement de la file : notifie quand elle se vide après avoir travaillé */
export function watchExports(jobs: ExportJob[], windowFocused: () => boolean, reveal: (path: string) => void): void {
  const busy = jobs.some((j) => j.status === 'queued' || j.status === 'running')
  if (busy) {
    if (batchStart === null) batchStart = Math.min(...jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.createdAt), Date.now())
    return
  }
  if (batchStart === null) return
  const since = batchStart
  batchStart = null
  // Fenêtre au premier plan : la file d'export à l'écran suffit
  if (windowFocused()) return
  const finished = jobs.filter((j) => (j.finishedAt ?? 0) >= since)
  const done = finished.filter((j) => j.status === 'done')
  const failed = finished.filter((j) => j.status === 'error').length
  if (!done.length && !failed) return
  const montage = done.length === 1 && done[0].kind === 'montage'
  const title = failed && !done.length ? 'Export raté' : montage ? 'Montage exporté' : 'Exports terminés'
  const what = montage ? done[0].clipName : `${done.length} clip${done.length > 1 ? 's' : ''} exporté${done.length > 1 ? 's' : ''}`
  const body = [done.length ? what : null, failed ? `${failed} en erreur` : null].filter(Boolean).join(', ')
  const last = done[done.length - 1]
  void notify(title, last ? `${body}. Clique pour ouvrir le dossier.` : body, () => last && reveal(last.outputPath))
}
