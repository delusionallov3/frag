import { app, nativeImage, Notification } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join } from 'path'
import type { AutoRecStatus, ExportJob } from '@shared/types'
import { tr } from '@shared/i18n'
import { getSettings, projectSummary } from './store'
import { iconPath } from './tray'

/**
 * Frag's Windows notifications (end of game, OBS not running, exports done).
 * Mostly useful while Frag sits hidden in the system tray.
 */

// Without an AppUserModelId, Windows doesn't show notifications (or credits them to "electron.app")
export function setupNotifications(): void {
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'gg.frag.app' : process.execPath)
}

// A garbage-collected notification no longer reacts to clicks: keep them alive while they're shown
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

/* ------------------------------------------------------------------ Valorant running without OBS */

function obsExe(): string | null {
  const roots = [process.env['ProgramW6432'], process.env['ProgramFiles'], process.env['ProgramFiles(x86)']]
  for (const root of roots) {
    if (!root) continue
    const exe = join(root, 'obs-studio', 'bin', '64bit', 'obs64.exe')
    if (existsSync(exe)) return exe
  }
  return null
}

/** OBS has to be started from its own folder, otherwise it can't find its files */
function launchObs(exe: string): void {
  try {
    spawn(exe, ['--minimize-to-tray'], { cwd: dirname(exe), detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* oh well, the user will start it by hand */
  }
}

let prevGame: AutoRecStatus['game'] = 'closed'
let warnedThisSession = false
let checkTimer: NodeJS.Timeout | null = null

/**
 * Valorant just opened: if OBS still doesn't answer a few seconds later
 * (time for Frag to retry the connection), warn the user. Once per Valorant session.
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
        tr('OBS refused the connection', 'OBS refuse la connexion'),
        tr(
          'Valorant is running but OBS rejected the password: Frag can’t record. Click to open Settings.',
          'Valorant est lancé mais le mot de passe OBS est refusé : Frag ne pourra pas enregistrer. Clique pour ouvrir les réglages.'
        ),
        openSettings
      )
      return
    }
    const exe = obsExe()
    void notify(
      tr('OBS isn’t running', 'OBS n’est pas lancé'),
      exe
        ? tr(
            'Valorant is open but OBS isn’t: your game won’t be recorded. Click here to start OBS.',
            'Valorant est ouvert mais pas OBS : ta game ne sera pas enregistrée. Clique ici pour lancer OBS.'
          )
        : tr(
            'Valorant is open but OBS isn’t: your game won’t be recorded. Start OBS before your game.',
            'Valorant est ouvert mais pas OBS : ta game ne sera pas enregistrée. Lance OBS avant ta game.'
          ),
      () => (exe ? launchObs(exe) : openSettings())
    )
  }, 10000)
}

/* ------------------------------------------------------------------ End of game: recording linked to its match */

export async function notifyLinked(path: string, open: (path: string) => void): Promise<void> {
  const { match } = await projectSummary(path).catch(() => ({ match: null }))
  if (!match) return
  const result = match.won === null ? '' : match.won ? tr('Win ', 'Victoire ') : tr('Loss ', 'Défaite ')
  const parts = [match.map, match.mode, `${result}${match.score}`.trim(), `${match.kills}/${match.deaths}/${match.assists}`]
    .filter(Boolean)
    .join(' · ')
  const agent = match.agent ? tr(` as ${match.agent}`, ` en ${match.agent}`) : ''
  void notify(tr('Recording linked to your match', 'Rec liée à ton match'), `${parts}${agent}. ${tr('Click to open it.', 'Clique pour l’ouvrir.')}`, () =>
    open(path)
  )
}

/* ------------------------------------------------------------------ Export queue finished */

let batchStart: number | null = null

/** Called on every queue change: notifies when the queue empties after doing some work */
export function watchExports(jobs: ExportJob[], windowFocused: () => boolean, reveal: (path: string) => void): void {
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running')
  if (active.length) {
    if (batchStart === null) batchStart = Math.min(...active.map((j) => j.createdAt), Date.now())
    return
  }
  if (batchStart === null) return
  const since = batchStart
  batchStart = null
  // Window in front: the export queue on screen is enough
  if (windowFocused()) return
  const finished = jobs.filter((j) => (j.finishedAt ?? 0) >= since)
  const done = finished.filter((j) => j.status === 'done')
  const failed = finished.filter((j) => j.status === 'error').length
  if (!done.length && !failed) return
  const montage = done.length === 1 && done[0].kind === 'montage'
  const title =
    failed && !done.length
      ? tr('Export failed', 'Export raté')
      : montage
        ? tr('Montage exported', 'Montage exporté')
        : tr('Exports done', 'Exports terminés')
  const what = montage
    ? done[0].clipName
    : done.length === 1
      ? tr('1 clip exported', '1 clip exporté')
      : tr(`${done.length} clips exported`, `${done.length} clips exportés`)
  const body = [done.length ? what : null, failed ? tr(`${failed} failed`, `${failed} en erreur`) : null].filter(Boolean).join(', ')
  const last = done[done.length - 1]
  void notify(title, last ? `${body}. ${tr('Click to open the folder.', 'Clique pour ouvrir le dossier.')}` : body, () => last && reveal(last.outputPath))
}
