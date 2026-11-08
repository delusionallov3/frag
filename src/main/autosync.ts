import { spawn } from 'child_process'
import type { AutoSyncResult, MatchData } from '@shared/types'
import { FFMPEG, probe } from './ffmpeg'

/**
 * Calage automatique : on regarde la zone du killfeed (en haut à droite).
 * Chaque nouvelle ligne de kill y fait apparaître du texte clair d'un coup :
 * on mesure ces « apparitions » image par image, puis on cherche le décalage
 * pour lequel les kills du match (tous les joueurs) tombent pile dessus.
 */

const FPS = 8
const W = 96
const H = 48
const SEARCH = 75 // secondes de part et d'autre de l'estimation

interface Window {
  start: number
  end: number
}

/** Signal d'apparition dans le killfeed, échantillonné à FPS images/s sur une fenêtre */
function killfeedSignal(path: string, win: Window): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-v', 'error',
      '-hwaccel', 'auto',
      '-ss', win.start.toFixed(2),
      '-t', (win.end - win.start).toFixed(2),
      '-i', path,
      '-an',
      // zone du killfeed : ~30 % de large, ~26 % de haut, coin supérieur droit
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
      if (code !== 0 && out.length === 0) reject(new Error(err.trim() || 'Analyse vidéo impossible'))
      else resolve(Float32Array.from(out))
    })
  })
}

/** Normalise un signal : 0 pour le bruit habituel, ~1+ pour un pic net */
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
  if (kills.length < 4) throw new Error('Pas assez de kills dans ce match pour caler automatiquement')

  // Fenêtres à analyser : autour des rounds les plus chargés en kills, sinon toute la vidéo
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
    // fusion des fenêtres qui se chevauchent
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

  // Signal mis bout à bout, avec le temps vidéo de chaque échantillon
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
    // max du signal entre t - 0,2 s et t + 0,3 s
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

  // Balayage des décalages possibles
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
    // score total (pas une moyenne) : un décalage qui ne couvre que 4 kills ne peut pas gagner par chance
    if (n >= 4) scores.push({ offset, score: s, n, hits })
  }
  if (!scores.length) throw new Error('La vidéo ne recouvre pas assez de kills pour caler automatiquement')

  scores.sort((a, b) => b.score - a.score)
  const top = scores[0]
  // Le pic est un petit plateau (fenêtre de tolérance) : on prend son centre
  const plateau = scores.filter((x) => Math.abs(x.offset - top.offset) <= 0.6 && x.score >= top.score * 0.97)
  const best = { ...top, offset: plateau.reduce((n, x) => n + x.offset, 0) / plateau.length }
  // Concurrent : le meilleur décalage à plus d'1 s (les kills groupés créent des quasi-doublons à ±2 s)
  const rival = scores.find((s) => Math.abs(s.offset - best.offset) > 1)
  // Confiance : part des kills qui tombent sur un pic, et avance nette sur le concurrent
  const hitRate = best.hits / best.n
  const gap = (best.hits - (rival?.hits ?? 0)) / best.n
  const confidence = Math.max(0, Math.min(1, hitRate * Math.min(1, gap / 0.25)))
  onProgress?.(1)
  return { offset: best.offset, confidence, kills: best.hits, score: best.score }
}
