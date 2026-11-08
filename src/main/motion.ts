/**
 * Renders the Broadcast motion layer (src/renderer/motion.html) to video files, one frame at a time.
 *
 * An offscreen, transparent window draws the scene; for each frame we pose it (render(t)), wait for the
 * paint, capture the BGRA bitmap and pipe it to ffmpeg, which writes a QuickTime Animation (.mov) that
 * keeps the alpha channel. The montage then overlays these files on the clips (montage.ts).
 * Deterministic: the scene never reads a clock, so the same montage always gives the same frames.
 */
import { BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import { FFMPEG } from './ffmpeg'
import type { MotionHighlight, MotionIntro, MotionOptions } from '@shared/types'

export type MotionScene = 'intro' | 'lobby' | 'wipe' | 'lower'

export interface SceneJob {
  scene: MotionScene
  opts: MotionOptions
  intro?: MotionIntro | null
  highlight?: MotionHighlight | null
  /** seconds */
  duration: number
  out: string
  lang: 'en' | 'fr'
}

/** Overlays are drawn at 30 fps; ffmpeg holds each frame over the clip's own frame rate */
export const MOTION_FPS = 30

export interface MotionRenderer {
  render: (job: SceneJob, onFrame?: (done: number, total: number) => void) => Promise<void>
  close: () => void
}

export async function openMotionRenderer(width: number, height: number): Promise<MotionRenderer> {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    enableLargerThanScreen: true,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true, contextIsolation: true }
  })
  win.setContentSize(width, height)
  win.webContents.setFrameRate(60)
  if (process.env['ELECTRON_RENDERER_URL']) await win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/motion.html`)
  else await win.loadFile(join(__dirname, '../renderer/motion.html'))

  let killed: (() => void) | null = null

  const render = async (job: SceneJob, onFrame?: (done: number, total: number) => void): Promise<void> => {
    await win.webContents.executeJavaScript(
      `window.setup(${JSON.stringify({ scene: job.scene, width, height, opts: job.opts, intro: job.intro, highlight: job.highlight, duration: job.duration, lang: job.lang })})`
    )
    const total = Math.max(1, Math.round(job.duration * MOTION_FPS))
    const ff = spawn(
      FFMPEG,
      [
        '-hide_banner', '-v', 'error', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${width}x${height}`, '-r', String(MOTION_FPS), '-i', 'pipe:0',
        '-c:v', 'qtrle', '-pix_fmt', 'argb',
        job.out
      ],
      { windowsHide: true }
    )
    let err = ''
    ff.stderr.on('data', (d) => (err += d.toString()))
    const finished = new Promise<void>((resolve, reject) => {
      ff.on('error', reject)
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `ffmpeg ${code}`))))
    })
    killed = () => ff.kill()
    try {
      for (let i = 0; i < total; i++) {
        const t = i / MOTION_FPS
        await win.webContents.executeJavaScript(`window.render(${t.toFixed(4)}); new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`)
        const img = await win.webContents.capturePage()
        let bmp = img.toBitmap()
        const size = img.getSize()
        if (size.width !== width || size.height !== height) bmp = img.resize({ width, height }).toBitmap()
        if (!ff.stdin.write(bmp)) await new Promise<void>((r) => ff.stdin.once('drain', () => r()))
        onFrame?.(i + 1, total)
      }
    } finally {
      ff.stdin.end()
      killed = null
    }
    await finished
  }

  return {
    render,
    close: () => {
      killed?.()
      if (!win.isDestroyed()) win.destroy()
    }
  }
}
