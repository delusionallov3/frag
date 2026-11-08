import { tr } from '@shared/i18n'
import { spawn } from 'child_process'
import type { AutoSyncResult, MatchData } from '@shared/types'
import { FFMPEG, probe } from './ffmpeg'

/**
 * Auto sync: watch the killfeed area (top right).
 * Every new kill line makes bright text appear at once:
 * measure these "appearances" frame by frame, then look for the offset
 * where the match's kills (all players) land right on them.
 */

const FPS = 8
const W = 96
const H = 48
const SEARCH = 75 // seconds on each side of the estimate

interface Window {
  start: number
  end: number
}

/** Killfeed appearance signal, sampled at FPS frames/s over a window */
function killfeedSignal(path: string, win: Window): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-v', 'error',
      '-hwaccel', 'auto',
      '-ss', win.start.toFixed(2),
      '-t', (win.end - win.start).toFixed(2),
      '-i', path,
      '-an',
      // killfeed area: ~30% wide, ~26% tall, top-right corner
      '-vf', `fps=${FPS},crop=iw*0.30:ih*0.26:iw*0.69:ih*0.06,scale=${W}:${H},format=gray`,
      '-f', 'rawvideo', 'pipe:1'
    ]
    const proc = spawn(FFMPEG, args, { windowsHide: true })
    const frame = W * H
    let buf = Buffer.alloc(0)
    let prev: Buffer | null = null
    const out: number[] = []
    proc.stdout.on('data', (d: Buffer) => {
      buf = Buffer.concat([buf, d])
      while (buf.length >= frame) {
        const cur = buf.subarray(0, frame)
        buf = buf.subarray(frame)
        let s = 0
        if (prev) {
          for (let i = 0; i < frame; i++) {
            const diff = cur[i] - prev[i]
            if (diff > 24) s += diff
          }
        }
        out.push(s / frame)
        prev = Buffer.from(cur)
      }
    })
    let err = ''
    proc.stderr.on('data', (d: Buffer) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0 && out.length === 0) reject(new Error(err.trim() || tr('Video analysis failed', 'Analyse vidéo impossible')))
      else resolve(Float32Array.from(out))
    })
  })
}

/** Normalizes a signal: 0 for the usual noise, ~1+ for a clear peak */
function normalize(sig: Float32Array): Float32Array {
  const sorted = Array.from(sig).sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 1
  const scale = Math.max(p95 - med, 1e-3)
  return sig.map((v) => Math.max(0, Math.min(4, (v - med) / scale)))
}

export async function autoSync(
  videoPath: string,
  match: MatchData,
  guessOffset: number | null,
  onProgress?: (p: number) => void
): Promise<AutoSyncResult> {
  const { duration } = await probe(videoPath)
  const kills = match.kills.map((k) => k.tMatch).sort((a, b) => a - b)
  if (kills.length < 4) throw new Error(tr('Not enough kills in this match to sync automatically', 'Pas assez de kills dans ce match pour caler automatiquement'))

  // Windows to analyse: around the rounds with the most kills, otherwise the whole video
  let windows: Window[]
  if (guessOffset !== null) {
    const byRound = new Map<number, number[]>()
    for (const k of match.kills) byRound.set(k.round, [...(byRound.get(k.round) ?? []), k.tMatch])
    const candidates = [...byRound.values()]
      .map((ts) => ({ a: Math.min(...ts) - guessOffset, b: Math.max(...ts) - guessOffset, n: ts.length }))
      .filter((r) => r.b > 0 && r.a < duration)
      .sort((x, y) => y.n - x.n)
      .slice(0, 4)
    windows = candidates
      .map((r) => ({ start: Math.max(0, r.a - SEARCH - 2), end: Math.min(duration, r.b + SEARCH + 6) }))
      .sort((x, y) => x.start - y.start)
    // merge overlapping windows
    const merged: Window[] = []
    for (const w of windows) {
      const last = merged[merged.length - 1]
      if (last && w.start <= last.end) last.end = Math.max(last.end, w.end)
      else merged.push({ ...w })
    }
    windows = merged
  } else {
    windows = [{ start: 0, end: duration }]
  }
  if (!windows.length) windows = [{ start: 0, end: duration }]

  // Signal stitched together, with each sample's video time
  const times: number[] = []
  const values: number[] = []
  const totalLen = windows.reduce((n, w) => n + (w.end - w.start), 0)
  let done = 0
  for (const w of windows) {
    const sig = normalize(await killfeedSignal(videoPath, w))
    sig.forEach((v, i) => {
      times.push(w.start + i / FPS)
      values.push(v)
    })
    done += w.end - w.start
    onProgress?.(Math.min(0.95, done / totalLen))
  }

  const at = (t: number): number => {
    // signal max between t - 0.2 s and t + 0.3 s
    let best = 0
    let lo = 0
    let hi = times.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (times[mid] < t - 0.2) lo = mid + 1
      else hi = mid
    }
    for (let i = lo; i < times.length && times[i] <= t + 0.3; i++) if (values[i] > best) best = values[i]
    return best
  }
  const covered = (t: number): boolean => windows.some((w) => t >= w.start + 0.5 && t <= w.end - 1)

  // Sweep the possible offsets
  const center = guessOffset ?? 0
  const range = guessOffset !== null ? SEARCH : Math.max(duration, match.length)
  const step = 1 / FPS
  const scores: { offset: number; score: number; n: number; hits: number }[] = []
  for (let d = -range; d <= range; d += step) {
    const offset = center + d
    let s = 0
    let n = 0
    let hits = 0
    for (const tm of kills) {
      const tv = tm - offset
      if (!covered(tv)) continue
      const v = at(tv)
      s += Math.min(v, 2)
      if (v >= 1) hits++
      n++
    }
    // total score (not an average): an offset covering only 4 kills can't win by luck
    if (n >= 4) scores.push({ offset, score: s, n, hits })
  }
  if (!scores.length) throw new Error(tr('The video doesn’t cover enough kills to sync automatically', 'La vidéo ne recouvre pas assez de kills pour caler automatiquement'))

  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]
  // The peak is a small plateau (tolerance window): take its center
  const plateau = scores.filter((x) => Math.abs(x.offset - top.offset) <= 0.6 && x.score >= top.score * 0.97)
  const best = { ...top, offset: plateau.reduce((n, x) => n + x.offset, 0) / plateau.length }
  // Runner-up: the best offset more than 1 s away (grouped kills create near-duplicates at ±2 s)
  const rival = scores.find((s) => Math.abs(s.offset - best.offset) > 1)
  // Confidence: share of kills landing on a peak, and a clear lead over the runner-up
  const hitRate = best.hits / best.n
  const gap = (best.hits - (rival?.hits ?? 0)) / best.n
  const confidence = Math.max(0, Math.min(1, hitRate * Math.min(1, gap / 0.25)))
  onProgress?.(1)
  return { offset: best.offset, confidence, kills: best.hits, score: best.score }
}
