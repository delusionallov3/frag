import { tr } from '@shared/i18n'
import { promises as fs, existsSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { randomUUID } from 'crypto'
import type { ExportJob, ExportOptions, Clip, MontageItem, MontageOptions } from '@shared/types'
import { buildCutArgs, detectEncoders, probe, runCut, type RunningCut } from './ffmpeg'
import { getSettings } from './store'
import { planMontage, type MontagePlan } from './montage'

type Listener = (jobs: ExportJob[]) => void

const jobs: ExportJob[] = []
let current: { job: ExportJob; cut: RunningCut } | null = null
const canceled = new Set<string>()
let listener: Listener = () => {}
let lastEmit = 0
let emitTimer: NodeJS.Timeout | null = null

export function onJobsChanged(fn: Listener): void {
  listener = fn
}

function emit(force = false): void {
  const now = Date.now()
  if (force || now - lastEmit > 120) {
    lastEmit = now
    if (emitTimer) clearTimeout(emitTimer)
    emitTimer = null
    listener(jobs.map((j) => ({ ...j })))
  } else if (!emitTimer) {
    emitTimer = setTimeout(() => emit(true), 120)
  }
}

export function listJobs(): ExportJob[] {
  return jobs.map((j) => ({ ...j }))
}

function sanitize(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'clip'
  )
}

async function outputFolderFor(videoPath: string): Promise<string> {
  const s = await getSettings()
  const folder = s.outputFolder || join(s.recsFolder || dirname(videoPath), 'Clips')
  await fs.mkdir(folder, { recursive: true })
  return folder
}

function uniquePath(folder: string, base: string, taken: Set<string>): string {
  let candidate = join(folder, `${base}.mp4`)
  let i = 2
  while (existsSync(candidate) || taken.has(candidate.toLowerCase())) {
    candidate = join(folder, `${base} (${i++}).mp4`)
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

export async function enqueue(videoPath: string, clips: Clip[], options: ExportOptions): Promise<ExportJob[]> {
  const folder = await outputFolderFor(videoPath)
  const recBase = basename(videoPath, extname(videoPath))
  const taken = new Set(jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.outputPath.toLowerCase()))
  const created = clips.map<ExportJob>((clip) => ({
    id: randomUUID(),
    videoPath,
    clipName: clip.name,
    start: clip.start,
    end: clip.end,
    options,
    outputPath: uniquePath(folder, sanitize(`${recBase} - ${clip.name}`), taken),
    status: 'queued',
    progress: 0,
    createdAt: Date.now()
  }))
  jobs.push(...created)
  emit(true)
  void pump()
  return created
}

const montages = new Map<string, MontagePlan>()

export async function enqueueMontage(items: MontageItem[], opts: MontageOptions): Promise<ExportJob> {
  if (!items.length) throw new Error(tr('No clips', 'Aucun clip'))
  const settings = await getSettings()
  const folder = await outputFolderFor(items[0].videoPath)
  const stamp = new Date().toLocaleString('sv-SE').slice(0, 16).replace(' ', ' ').replace(':', '-')
  const taken = new Set(jobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.outputPath.toLowerCase()))
  const outputPath = uniquePath(folder, sanitize(opts.name.trim() || `Montage ${stamp}`), taken)
  const plan = await planMontage(items, opts, settings.quality, settings.audio, outputPath)
  const job: ExportJob = {
    id: randomUUID(),
    kind: 'montage',
    videoPath: items[0].videoPath,
    clipName: opts.name || 'Montage',
    start: 0,
    end: plan.duration,
    options: { mode: 'precise', quality: settings.quality, audio: settings.audio },
    outputPath,
    status: 'queued',
    progress: 0,
    createdAt: Date.now()
  }
  montages.set(job.id, plan)
  jobs.push(job)
  emit(true)
  void pump()
  return job
}

export function cancel(id: string): void {
  const job = jobs.find((j) => j.id === id)
  if (!job) return
  if (job.status === 'queued') {
    job.status = 'canceled'
    emit(true)
  } else if (job.status === 'running' && current?.job.id === id) {
    canceled.add(id)
    current.cut.proc.kill()
  }
}

export function clearFinished(): void {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].status !== 'queued' && jobs[i].status !== 'running') jobs.splice(i, 1)
  }
  emit(true)
}

export function retry(id: string): void {
  const job = jobs.find((j) => j.id === id)
  if (!job || (job.status !== 'error' && job.status !== 'canceled')) return
  job.status = 'queued'
  job.progress = 0
  job.error = undefined
  emit(true)
  void pump()
}

async function pump(): Promise<void> {
  if (current) return
  const job = jobs.find((j) => j.status === 'queued')
  if (!job) return

  job.status = 'running'
  job.progress = 0
  emit(true)

  try {
    const meta = await probe(job.videoPath)
    const settings = await getSettings()
    const { nvenc } = await detectEncoders()
    const wantNvenc = settings.encoder === 'nvenc' || (settings.encoder === 'auto' && nvenc)
    const encoder: 'nvenc' | 'cpu' = wantNvenc ? 'nvenc' : 'cpu'
    const duration = job.end - job.start

    const plan = job.kind === 'montage' ? montages.get(job.id) : undefined
    if (job.kind === 'montage' && !plan) throw new Error(tr('Montage not found, start it again', 'Montage introuvable, relance-le'))

    const attempt = async (enc: 'nvenc' | 'cpu'): Promise<void> => {
      job.encoder = job.options.mode === 'fast' ? 'copy' : enc
      const args = plan ? plan.build(enc) : buildCutArgs({
        input: job.videoPath,
        output: job.outputPath,
        start: job.start,
        end: job.end,
        mode: job.options.mode,
        quality: job.options.quality,
        audio: job.options.audio,
        audioTracks: meta.audioTracks,
        encoder: enc
      })
      const cut = runCut(args, duration, (p) => {
        job.progress = p
        emit()
      })
      current = { job, cut }
      await cut.done
    }

    try {
      await attempt(encoder)
    } catch (e) {
      // NVENC unavailable (driver, sessions full…): fall back to the CPU automatically
      if (canceled.has(job.id) || job.options.mode === 'fast' || encoder === 'cpu' || settings.encoder === 'nvenc') throw e
      await attempt('cpu')
    }

    job.status = 'done'
    job.progress = 1
    job.finishedAt = Date.now()
    if (plan) {
      await plan.cleanup()
      montages.delete(job.id)
    }
  } catch (e) {
    if (canceled.has(job.id)) {
      job.status = 'canceled'
      await fs.rm(job.outputPath, { force: true }).catch(() => {})
    } else {
      job.status = 'error'
      job.error = e instanceof Error ? e.message : String(e)
      await fs.rm(job.outputPath, { force: true }).catch(() => {})
    }
  } finally {
    canceled.delete(job.id)
    current = null
    emit(true)
    void pump()
  }
}
