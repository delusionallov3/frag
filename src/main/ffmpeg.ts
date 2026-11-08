import { spawn, type ChildProcess } from 'child_process'
import { promises as fs, existsSync } from 'fs'
import { join } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'
import type { EncoderInfo, VideoMeta, ThumbStrip, Waveform } from '@shared/types'
import { cacheDir, readJson, writeJson } from './store'

const unpacked = (p: string): string => p.replace('app.asar', 'app.asar.unpacked')

export const FFMPEG = unpacked(ffmpegStatic as unknown as string)
export const FFPROBE = unpacked(ffprobeStatic.path)

/* ------------------------------------------------------------------ */
/* Petit limiteur de concurrence pour ne pas lancer 40 ffmpeg à la fois */

function limiter(max: number) {
  let active = 0
  const queue: (() => void)[] = []
  const next = (): void => {
    if (active >= max) return
    const run = queue.shift()
    if (run) {
      active++
      run()
    }
  }
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      })
      next()
    })
}

const light = limiter(3)
const heavy = limiter(1)

/* ------------------------------------------------------------------ */

interface RunResult {
  code: number | null
  stdout: Buffer
  stderr: string
}

function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { windowsHide: true })
    const out: Buffer[] = []
    let err = ''
    proc.stdout.on('data', (d: Buffer) => out.push(d))
    proc.stderr.on('data', (d: Buffer) => {
      err += d.toString()
      if (err.length > 20000) err = err.slice(-10000)
    })
    proc.on('error', reject)
    proc.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr: err }))
  })
}

function parseRate(rate?: string): number {
  if (!rate) return 0
  const [n, d] = rate.split('/').map(Number)
  if (!d) return n || 0
  return n / d
}

/* ------------------------------------------------------------------ */
/* Infos vidéo */

const metaMemo = new Map<string, VideoMeta>()

export async function probe(videoPath: string): Promise<VideoMeta> {
  const dir = await cacheDir(videoPath)
  const memoKey = dir
  const memo = metaMemo.get(memoKey)
  if (memo) return memo
  const cached = await readJson<VideoMeta>(join(dir, 'meta.json'))
  if (cached) {
    metaMemo.set(memoKey, cached)
    return cached
  }

  const res = await light(() =>
    run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', videoPath])
  )
  if (res.code !== 0) throw new Error(res.stderr.trim() || 'ffprobe a échoué')
  const json = JSON.parse(res.stdout.toString()) as {
    format?: { duration?: string }
    streams?: {
      codec_type: string
      codec_name?: string
      width?: number
      height?: number
      avg_frame_rate?: string
      r_frame_rate?: string
      duration?: string
    }[]
  }
  const streams = json.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video')
  if (!v) throw new Error('Aucune piste vidéo')
  const duration = Number(json.format?.duration ?? v.duration ?? 0)
  if (!duration) throw new Error('Durée inconnue (enregistrement en cours ?)')
  const fps = parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate) || 60
  const meta: VideoMeta = {
    duration,
    width: v.width ?? 0,
    height: v.height ?? 0,
    fps: Math.round(fps * 100) / 100,
    audioTracks: streams.filter((s) => s.codec_type === 'audio').length,
    codec: v.codec_name ?? '?'
  }
  metaMemo.set(memoKey, meta)
  await writeJson(join(dir, 'meta.json'), meta)
  return meta
}

/* ------------------------------------------------------------------ */
/* Miniature de la carte (bibliothèque) */

export async function poster(videoPath: string, duration: number): Promise<string> {
  const dir = await cacheDir(videoPath)
  const out = join(dir, 'poster.jpg')
  if (existsSync(out)) return out
  const at = Math.min(Math.max(duration * 0.35, 1), Math.max(duration - 1, 0))
  const res = await light(() =>
    run(FFMPEG, [
      '-hide_banner', '-v', 'error', '-y',
      '-ss', at.toFixed(2),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', 'scale=480:-2',
      '-q:v', '4',
      out
    ])
  )
  if (res.code !== 0 || !existsSync(out)) throw new Error(res.stderr.trim() || 'Miniature impossible')
  return out
}

/** Une image précise (fond de l'aperçu des cartons du montage) */
export async function frameAt(videoPath: string, t: number): Promise<string> {
  const dir = join(await cacheDir(videoPath), 'frames')
  await fs.mkdir(dir, { recursive: true })
  const out = join(dir, `f_${Math.round(t * 10)}.jpg`)
  if (existsSync(out)) return out
  const res = await light(() =>
    run(FFMPEG, [
      '-hide_banner', '-v', 'error', '-y',
      '-ss', Math.max(0, t).toFixed(2),
      '-i', videoPath,
      '-frames:v', '1',
      '-vf', 'scale=960:-2',
      '-q:v', '4',
      out
    ])
  )
  if (res.code !== 0 || !existsSync(out)) throw new Error(res.stderr.trim() || 'Image impossible')
  return out
}

/* ------------------------------------------------------------------ */
/* Bande de miniatures pour la timeline */

export async function thumbStrip(videoPath: string, duration: number): Promise<ThumbStrip> {
  const dir = join(await cacheDir(videoPath), 'strip')
  const doneFile = join(dir, 'done.json')
  const done = await readJson<ThumbStrip>(doneFile)
  if (done) return done

  await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })

  // ~240 vignettes quel que soit la durée, minimum une toutes les 2 s
  const interval = Math.max(2, Math.round((duration / 240) * 10) / 10)
  const res = await heavy(() =>
    run(FFMPEG, [
      '-hide_banner', '-v', 'error', '-y',
      '-skip_frame', 'nokey',
      '-i', videoPath,
      '-an',
      '-vf', `fps=1/${interval},scale=-2:108`,
      '-q:v', '6',
      join(dir, 't_%05d.jpg')
    ])
  )
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jpg'))
  if (res.code !== 0 && files.length === 0) throw new Error(res.stderr.trim() || 'Vignettes impossibles')
  const strip: ThumbStrip = { dir, interval, count: files.length }
  await writeJson(doneFile, strip)
  return strip
}

/* ------------------------------------------------------------------ */
/* Forme d'onde audio */

const PEAKS_PER_SECOND = 50
const SAMPLE_RATE = 8000

export async function waveform(videoPath: string): Promise<Waveform> {
  const dir = await cacheDir(videoPath)
  const file = join(dir, 'peaks.bin')
  if (existsSync(file)) {
    return { peaks: new Uint8Array(await fs.readFile(file)), perSecond: PEAKS_PER_SECOND }
  }

  const peaks = await heavy(
    () =>
      new Promise<Uint8Array>((resolve, reject) => {
        const proc = spawn(
          FFMPEG,
          [
            '-hide_banner', '-v', 'error',
            '-i', videoPath,
            '-map', '0:a:0',
            '-ac', '1',
            '-ar', String(SAMPLE_RATE),
            '-f', 's16le',
            'pipe:1'
          ],
          { windowsHide: true }
        )
        const bucket = SAMPLE_RATE / PEAKS_PER_SECOND
        const out: number[] = []
        let count = 0
        let max = 0
        let carry: Buffer | null = null
        proc.stdout.on('data', (chunk: Buffer) => {
          let buf = chunk
          if (carry) {
            buf = Buffer.concat([carry, chunk])
            carry = null
          }
          const usable = buf.length - (buf.length % 2)
          for (let i = 0; i < usable; i += 2) {
            const s = Math.abs(buf.readInt16LE(i))
            if (s > max) max = s
            if (++count >= bucket) {
              out.push(max)
              max = 0
              count = 0
            }
          }
          if (usable < buf.length) carry = buf.subarray(usable)
        })
        let err = ''
        proc.stderr.on('data', (d: Buffer) => (err += d.toString()))
        proc.on('error', reject)
        proc.on('close', (code) => {
          if (count > 0) out.push(max)
          if (code !== 0 && out.length === 0) {
            // Pas d'audio : on renvoie une onde vide plutôt qu'une erreur
            if (/matches no streams|does not contain any stream/i.test(err)) return resolve(new Uint8Array())
            return reject(new Error(err.trim() || 'Forme d’onde impossible'))
          }
          // Normalisation douce : on cale le 99,5e centile sur 255
          const sorted = [...out].sort((a, b) => a - b)
          const ref = Math.max(sorted[Math.floor(sorted.length * 0.995)] ?? 1, 1)
          const res = new Uint8Array(out.length)
          for (let i = 0; i < out.length; i++) {
            res[i] = Math.min(255, Math.round(Math.sqrt(out[i] / ref) * 255))
          }
          resolve(res)
        })
      })
  )
  await fs.writeFile(file, peaks)
  return { peaks, perSecond: PEAKS_PER_SECOND }
}

/* ------------------------------------------------------------------ */
/* Détection NVENC */

let encoderInfo: EncoderInfo | null = null

export async function detectEncoders(): Promise<EncoderInfo> {
  if (encoderInfo) return encoderInfo
  try {
    const res = await run(FFMPEG, [
      '-hide_banner', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.2',
      '-c:v', 'h264_nvenc',
      '-f', 'null', '-'
    ])
    encoderInfo = { nvenc: res.code === 0 }
  } catch {
    encoderInfo = { nvenc: false }
  }
  return encoderInfo
}

/* ------------------------------------------------------------------ */
/* Export */

export interface CutArgs {
  input: string
  output: string
  start: number
  end: number
  mode: 'precise' | 'fast'
  quality: 'high' | 'balanced' | 'light'
  audio: 'all' | 'first' | 'mix'
  audioTracks: number
  encoder: 'nvenc' | 'cpu'
}

const CQ = { high: 18, balanced: 23, light: 28 }

export function buildCutArgs(a: CutArgs): string[] {
  const dur = Math.max(0.05, a.end - a.start)
  const args = ['-hide_banner', '-v', 'error', '-y', '-nostats', '-progress', 'pipe:1']
  args.push('-ss', a.start.toFixed(3), '-i', a.input, '-t', dur.toFixed(3))

  const mixing = a.audio === 'mix' && a.audioTracks > 1
  if (mixing) {
    const ins = Array.from({ length: a.audioTracks }, (_, i) => `[0:a:${i}]`).join('')
    args.push(
      '-filter_complex',
      `${ins}amix=inputs=${a.audioTracks}:normalize=0:dropout_transition=0[aout]`,
      '-map', '0:v:0', '-map', '[aout]'
    )
  } else {
    args.push('-map', '0:v:0', '-map', a.audio === 'first' ? '0:a:0?' : '0:a?')
  }

  if (a.mode === 'fast') {
    args.push('-c:v', 'copy')
    if (mixing) args.push('-c:a', 'aac', '-b:a', '192k')
    else args.push('-c:a', 'copy')
    args.push('-avoid_negative_ts', 'make_zero')
  } else {
    const cq = CQ[a.quality]
    if (a.encoder === 'nvenc') {
      args.push(
        '-c:v', 'h264_nvenc',
        '-preset', 'p5',
        '-tune', 'hq',
        '-rc', 'vbr',
        '-cq', String(cq),
        '-b:v', '0',
        '-spatial-aq', '1',
        '-pix_fmt', 'yuv420p'
      )
    } else {
      args.push('-c:v', 'libx264', '-preset', 'faster', '-crf', String(cq), '-pix_fmt', 'yuv420p')
    }
    args.push('-c:a', 'aac', '-b:a', '192k')
  }

  args.push('-map_metadata', '-1', '-movflags', '+faststart', a.output)
  return args
}

export interface RunningCut {
  proc: ChildProcess
  done: Promise<void>
}

export function runCut(args: string[], duration: number, onProgress: (p: number) => void): RunningCut {
  const proc = spawn(FFMPEG, args, { windowsHide: true })
  let err = ''
  let buf = ''
  proc.stdout?.on('data', (d: Buffer) => {
    buf += d.toString()
    const lines = buf.split(/\r?\n/)
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line)
      if (m) onProgress(Math.min(0.99, Number(m[1]) / 1e6 / duration))
    }
  })
  proc.stderr?.on('data', (d: Buffer) => {
    err += d.toString()
    if (err.length > 8000) err = err.slice(-4000)
  })
  const done = new Promise<void>((resolve, reject) => {
    proc.on('error', reject)
    proc.on('close', (code, signal) => {
      if (code === 0) resolve()
      else if (signal) reject(new Error('canceled'))
      else reject(new Error(err.trim().split('\n').slice(-3).join('\n') || `ffmpeg code ${code}`))
    })
  })
  return { proc, done }
}
