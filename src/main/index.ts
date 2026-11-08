import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { createReadStream, promises as fs } from 'fs'
import { extname, join } from 'path'
import { Readable } from 'stream'
import type { Clip, ExportOptions, MatchData, MontageItem, MontageOptions, Project, Region, Settings } from '@shared/types'
import {
  allProjects,
  deleteProject,
  ensureDirs,
  getHenrikKey,
  getObsPassword,
  getProject,
  getSettings,
  saveProject,
  setHenrikKey,
  setObsPassword,
  setSettings,
  statsEntries
} from './store'
import { autoRecStatus, resetObs, startAutoRec, testObs } from './autorec'
import { createTray, destroyTray, setTrayUpdate, updateTrayStatus } from './tray'
import { checkForUpdates, installUpdate, startUpdater, updateStatus } from './updater'
import { notify, notifyLinked, setupNotifications, watchExports, watchObsMissing } from './notify'
import { assetsError, cachedImage, getAssets } from './valapi'
import { autoSync } from './autosync'
import { candidatesFor, matchById, rateInfo, recTimes, testKey, verifyAccount } from './henrik'
import { detectEncoders, frameAt, poster, probe, thumbStrip, waveform } from './ffmpeg'
import { listVideos, watchFolder } from './library'
import { cancel, clearFinished, enqueue, enqueueMontage, listJobs, onJobsChanged, retry } from './exporter'

const SCHEME = 'frag-media'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png'
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

let win: BrowserWindow | null = null
/** Vrai quand on quitte pour de bon (menu « Quitter », arrêt de Windows…) : la croix ne fait alors plus que cacher */
let isQuitting = false
/** Copie synchrone du réglage, lue dans l'événement « close » (qui ne peut pas attendre) */
let closeToTray = true
let trayHintShown = false
/** Lancé par Windows au démarrage de session : on reste caché dans la zone de notification */
const startHidden = process.argv.includes('--hidden')

// Une seule instance : relancer Frag réaffiche la fenêtre existante
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function showWindow(): void {
  if (!win || win.isDestroyed()) {
    createWindow(true)
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Depuis une notification : affiche Frag et ouvre la rec dans l'éditeur */
function openRecInFrag(path: string): void {
  showWindow()
  send('ui:openVideo', path)
}

function openSettingsInFrag(): void {
  showWindow()
  send('ui:openSettings')
}

async function clipsFolder(): Promise<string | null> {
  const s = await getSettings()
  return s.outputFolder || (s.recsFolder ? join(s.recsFolder, 'Clips') : null)
}

/** Dossier choisi dans les réglages, sinon on ouvre les réglages pour le choisir */
async function openFolderOrSettings(dir: string | null): Promise<void> {
  if (!dir) return openSettingsInFrag()
  await fs.mkdir(dir, { recursive: true }).catch(() => {})
  await shell.openPath(dir)
}

/** Une rec en cours ou des exports en attente seraient coupés : on demande avant de redémarrer */
async function restartToUpdate(): Promise<void> {
  if (updateStatus().state !== 'ready') return
  const exporting = listJobs().some((j) => j.status === 'queued' || j.status === 'running')
  const recording = autoRecStatus().recording
  if (exporting || recording) {
    const what = recording ? 'Une rec est en cours : Frag ne pourra pas la lier à son match.' : 'Des exports sont en cours et seront annulés.'
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Mise à jour de Frag',
      message: 'Redémarrer maintenant ?',
      detail: `${what} Sinon, la mise à jour s’installera quand tu quitteras Frag.`,
      buttons: ['Redémarrer', 'Plus tard'],
      defaultId: 1,
      cancelId: 1
    })
    if (response !== 0) return
  }
  isQuitting = true
  installUpdate()
}

function quitForReal(): void {
  isQuitting = true
  app.quit()
}

/** Démarrage avec Windows (seulement pour l'app installée : en dev ça enregistrerait electron.exe) */
function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged || process.platform !== 'win32') return
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--hidden'] })
}

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

/** Sert les fichiers locaux (vidéos + vignettes) avec support des Range pour pouvoir naviguer dans la vidéo. */
function registerMediaProtocol(): void {
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url)
    // Images Valorant : téléchargées une fois puis servies depuis le cache disque
    if (url.host === 'asset') {
      const img = await cachedImage(url.searchParams.get('u') ?? '')
      if (!img) return new Response('not found', { status: 404 })
      const data = await fs.readFile(img.file)
      return new Response(data, { status: 200, headers: { 'Content-Type': img.type, 'Cache-Control': 'max-age=31536000' } })
    }
    const p = url.searchParams.get('p')
    if (!p) return new Response('bad request', { status: 400 })
    const type = MIME[extname(p).toLowerCase()]
    if (!type) return new Response('forbidden', { status: 403 })

    let size: number
    try {
      size = (await fs.stat(p)).size
    } catch {
      return new Response('not found', { status: 404 })
    }

    const range = req.headers.get('range')
    const headers: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': type.startsWith('image') ? 'max-age=31536000' : 'no-cache'
    }

    const body = (start: number, end: number): ReadableStream =>
      Readable.toWeb(createReadStream(p, { start, end })) as unknown as ReadableStream

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      let start = 0
      let end = size - 1
      if (m) {
        if (m[1]) {
          start = Number(m[1])
          if (m[2]) end = Math.min(Number(m[2]), size - 1)
        } else if (m[2]) {
          start = Math.max(0, size - Number(m[2]))
        }
      }
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      return new Response(body(start, end), {
        status: 206,
        headers: {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1)
        }
      })
    }
    return new Response(size ? body(0, size - 1) : null, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(size) }
    })
  })
}

async function rewatch(): Promise<void> {
  const s = await getSettings()
  await watchFolder(s.recsFolder, () => send('library:changed'))
}

function registerIpc(): void {
  // HenrikDev : les erreurs remontent sous forme { error } pour garder un message lisible côté interface
  const safe =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (_e: unknown, ...a: A): Promise<{ ok: true; data: R } | { ok: false; error: string }> => {
      try {
        return { ok: true, data: await fn(...a) }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', async (_e, patch: Partial<Settings>) => {
    const next = await setSettings(patch)
    if ('closeToTray' in patch) closeToTray = next.closeToTray
    if ('launchAtLogin' in patch) applyLoginItem(next.launchAtLogin)
    if ('recsFolder' in patch) await rewatch()
    if (patch.obs && ('host' in patch.obs || 'port' in patch.obs)) resetObs()
    return next
  })

  // OBS : test de connexion (mot de passe tapé, ou celui enregistré), mot de passe chiffré, état en direct
  ipcMain.handle('obs:test', async (_e, host: string, port: number, password: string | null) =>
    testObs(host, port, password ?? (await getObsPassword()))
  )
  ipcMain.handle('obs:setPassword', async (_e, password: string | null) => {
    await setObsPassword(password?.trim() || null)
    resetObs()
    return getSettings()
  })
  ipcMain.handle('autorec:status', () => autoRecStatus())
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => restartToUpdate())

  ipcMain.handle('dialog:folder', async (_e, title: string) => {
    const res = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] })
    return res.canceled ? null : res.filePaths[0]
  })
  ipcMain.handle('dialog:video', async () => {
    const res = await dialog.showOpenDialog(win!, {
      title: 'Ouvrir une vidéo',
      properties: ['openFile'],
      filters: [{ name: 'Vidéos', extensions: ['mp4', 'mkv', 'mov', 'm4v', 'webm'] }]
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle('library:list', async () => {
    const s = await getSettings()
    return s.recsFolder ? listVideos(s.recsFolder) : []
  })

  // Corbeille Windows (récupérable) + oubli des clips / du match de cette rec
  ipcMain.handle(
    'library:trash',
    safe(async (path: string) => {
      const s = await getSettings()
      const VIDEO = /\.(mp4|mkv|mov|m4v|webm)$/i
      if (!VIDEO.test(path)) throw new Error('Ce fichier n’est pas une vidéo')
      if (s.recsFolder && !path.toLowerCase().startsWith(s.recsFolder.toLowerCase())) {
        throw new Error('Seules les recs du dossier surveillé peuvent être supprimées ici')
      }
      await shell.trashItem(path)
      await deleteProject(path)
      send('library:changed')
    })
  )

  ipcMain.handle('video:card', async (_e, path: string) => {
    try {
      const meta = await probe(path)
      let posterPath: string | null = null
      try {
        posterPath = await poster(path, meta.duration)
      } catch {
        /* pas grave */
      }
      return { meta, poster: posterPath }
    } catch (e) {
      return { meta: null, poster: null, error: e instanceof Error ? e.message : String(e) }
    }
  })
  ipcMain.handle('video:probe', (_e, path: string) => probe(path))
  ipcMain.handle('video:frame', safe((path: string, t: number) => frameAt(path, t)))
  ipcMain.handle('video:thumbs', async (_e, path: string) => thumbStrip(path, (await probe(path)).duration))
  ipcMain.handle('video:waveform', (_e, path: string) => waveform(path))

  ipcMain.handle('project:get', (_e, path: string) => getProject(path))
  ipcMain.handle('project:save', (_e, project: Project) => saveProject(project))

  ipcMain.handle('export:enqueue', (_e, videoPath: string, clips: Clip[], options: ExportOptions) =>
    enqueue(videoPath, clips, options)
  )
  ipcMain.handle('export:list', () => listJobs())
  ipcMain.handle('export:cancel', (_e, id: string) => cancel(id))
  ipcMain.handle('export:retry', (_e, id: string) => retry(id))
  ipcMain.handle('export:clear', () => clearFinished())
  ipcMain.handle('export:encoders', () => detectEncoders())
  ipcMain.handle('export:outputFolder', () => clipsFolder())

  // La clé n'est enregistrée que si HenrikDev l'accepte ; le quota détecté est appliqué au limiteur
  ipcMain.handle('henrik:setKey', async (_e, key: string | null) => {
    if (!key?.trim()) {
      await setHenrikKey(null)
      return { ok: true, settings: await getSettings(), test: null }
    }
    const test = await testKey(key)
    if (!test.ok) return { ok: false, error: test.error, settings: await getSettings(), test }
    await setHenrikKey(key.trim())
    const settings = test.limit ? await setSettings({ rateLimit: test.limit }) : await getSettings()
    return { ok: true, settings, test }
  })
  ipcMain.handle('henrik:testStoredKey', async () => {
    const key = await getHenrikKey()
    if (!key) return { ok: false, error: 'Aucune clé enregistrée.', limit: null, remaining: null, resetIn: null }
    return testKey(key)
  })
  ipcMain.handle('henrik:rate', async () => rateInfo((await getSettings()).rateLimit))
  ipcMain.handle('henrik:verifyAccount', safe((riotId: string) => verifyAccount(riotId)))
  ipcMain.handle(
    'henrik:candidates',
    safe((path: string, region: Region, riotId: string, force?: boolean) => candidatesFor(path, region, riotId, !!force))
  )
  ipcMain.handle('henrik:match', safe((region: Region, id: string) => matchById(region, id)))
  ipcMain.handle('video:recTimes', safe((path: string) => recTimes(path)))
  ipcMain.handle('assets:get', () => getAssets())
  ipcMain.handle(
    'match:autosync',
    safe((path: string, match: MatchData, guess: number | null) =>
      autoSync(path, match, guess, (p) => send('autosync:progress', { path, progress: p }))
    )
  )
  ipcMain.handle('export:montage', safe((items: MontageItem[], opts: MontageOptions) => enqueueMontage(items, opts)))
  ipcMain.handle('stats:entries', () => statsEntries(async (p) => (await probe(p)).duration))
  ipcMain.handle('projects:all', () => allProjects())
  ipcMain.handle('assets:refresh', async () => {
    const assets = await getAssets(true)
    return { assets, error: assetsError() }
  })
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle('shell:showItem', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:openFolder', async (_e, path: string) => {
    await fs.mkdir(path, { recursive: true }).catch(() => {})
    return shell.openPath(path)
  })

  onJobsChanged((jobs) => {
    send('export:jobs', jobs)
    watchExports(
      jobs,
      () => !!win && !win.isDestroyed() && win.isVisible() && win.isFocused(),
      (p) => shell.showItemInFolder(p)
    )
  })
}

function createWindow(show = true): void {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1060,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0b0d',
    title: 'Frag',
    // En dev, l'icône de la barre des tâches ; une fois installée, Windows prend celle du .exe
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0b0d', symbolColor: '#a1a1aa', height: 44 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.once('ready-to-show', () => {
    if (show) win?.show()
  })
  // La croix cache Frag dans la zone de notification (l'enregistrement auto continue)
  win.on('close', (e) => {
    if (isQuitting || !closeToTray) return
    e.preventDefault()
    win?.hide()
    if (!trayHintShown) {
      trayHintShown = true
      void notify(
        'Frag tourne toujours',
        'L’enregistrement auto continue en arrière-plan. Clic droit sur l’icône près de l’horloge pour quitter.',
        showWindow,
        true
      )
      void setSettings({ trayHintShown: true })
    }
  })
  win.on('closed', () => {
    win = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.on('second-instance', () => showWindow())
app.on('before-quit', () => {
  isQuitting = true
})
app.on('will-quit', () => destroyTray())

app.whenReady().then(async () => {
  if (!gotLock) return
  ensureDirs()
  setupNotifications()
  const settings = await getSettings()
  closeToTray = settings.closeToTray
  trayHintShown = settings.trayHintShown
  applyLoginItem(settings.launchAtLogin)
  registerMediaProtocol()
  registerIpc()
  createTray(
    {
      show: showWindow,
      quit: quitForReal,
      openRecs: () => void getSettings().then((s) => openFolderOrSettings(s.recsFolder)),
      openClips: () => void clipsFolder().then(openFolderOrSettings),
      installUpdate: () => void restartToUpdate()
    },
    autoRecStatus()
  )
  createWindow(!startHidden)
  await rewatch()
  startAutoRec(
    (status) => {
      send('autorec:status', status)
      updateTrayStatus(status)
      watchObsMissing(status, autoRecStatus, openSettingsInFrag)
    },
    (path) => {
      send('library:changed')
      send('project:linked', path)
      void notifyLinked(path, openRecInFrag)
    },
    () => send('library:changed')
  )
  startUpdater(
    (s) => send('update:status', s),
    (version) => {
      setTrayUpdate(version)
      void notify(
        `Frag ${version} est prêt`,
        'La mise à jour s’installera quand tu quitteras Frag. Clique pour redémarrer maintenant.',
        () => void restartToUpdate()
      )
    }
  )
  void detectEncoders()
  void getAssets()
})

// Avec la zone de notification la fenêtre est cachée, pas fermée : on n'arrive ici que si le réglage est coupé
app.on('window-all-closed', () => {
  if (isQuitting || !closeToTray) app.quit()
})
