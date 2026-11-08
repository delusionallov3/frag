import { tr } from '@shared/i18n'
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CardLayer, MontageItem, MontageOptions, MotionOptions } from '@shared/types'
import { probe, type CutArgs } from './ffmpeg'
import { openMotionRenderer, type SceneJob } from './motion'
import { DEFAULT_MOTION, MOTION_TIMES } from '@shared/motion'

const CQ = { high: 18, balanced: 23, light: 28 } as const

/** Title card animation durations (s) */
const ENTER = 0.45
const FADE_OUT = 0.35

/**
 * ffmpeg expressions (inside quotes, so commas don't split the filter).
 * e = how much of the entrance is left, from 1 (start) to 0 (in place), cubic ease-out.
 */
function layerMotion(l: CardLayer, X: number, Y: number, w: number, h: number, H: number): { x: string; y: string } {
  const e = `pow(1-clip((t-${l.delay.toFixed(3)})/${ENTER},0,1),3)`
  switch (l.anim) {
    case 'slide':
      return { x: `${X}-${X + w}*${e}`, y: String(Y) }
    case 'rise':
      return { x: String(X), y: `${Y}+${Math.round(H / 27)}*${e}` }
    case 'barTop':
      return { x: '0', y: `-${h}*${e}` }
    case 'barBottom':
      return { x: '0', y: `${H - h}+${h}*${e}` }
    default:
      return { x: String(X), y: String(Y) }
  }
}

export interface MontagePlan {
  duration: number
  /** heavy work done when the job starts (the Broadcast motion layer), progress 0..1 */
  prepare?: (onProgress: (p: number) => void) => Promise<void>
  build: (encoder: 'nvenc' | 'cpu') => string[]
  cleanup: () => Promise<void>
}

const encoderArgs = (encoder: 'nvenc' | 'cpu', quality: CutArgs['quality']): string[] => {
  const cq = CQ[quality]
  return encoder === 'nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', String(cq), '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', 'faster', '-crf', String(cq)]
}

export async function planMontage(
  items: MontageItem[],
  opts: MontageOptions,
  quality: CutArgs['quality'],
  audio: CutArgs['audio'],
  output: string
): Promise<MontagePlan> {
  if (items.length < 1) throw new Error(tr('No clips in the montage', 'Aucun clip dans le montage'))
  if (opts.style === 'motion') return planMotion(items, opts, quality, audio, output)
  const metas = await Promise.all(items.map((it) => probe(it.videoPath)))
  const W = metas[0].width - (metas[0].width % 2) || 1920
  const H = metas[0].height - (metas[0].height % 2) || 1080
  const FPS = Math.min(240, Math.round(metas[0].fps) || 60)
  const durs = items.map((it) => Math.max(0.2, it.end - it.start))
  const T = items.length > 1 ? Math.min(opts.transition, ...durs.map((d) => d / 2 - 0.05)) : 0
  const total = durs.reduce((a, b) => a + b, 0) - Math.max(0, T) * (items.length - 1)

  const tmp = join(tmpdir(), `frag-montage-${Date.now()}`)
  await fs.mkdir(tmp, { recursive: true })

  const inputs: string[] = []
  const parts: string[] = []
  /** ffmpeg index of the next input (card images sit between the videos) */
  const nextInput = (): number => inputs.filter((x) => x === '-i').length

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const d = durs[i]
    const src = nextInput()
    inputs.push('-ss', it.start.toFixed(3), '-t', d.toFixed(3), '-i', it.videoPath)

    // reset time to 0 BEFORE fps=, otherwise xfade loses the frame rate
    const v = `[${src}:v:0]settb=AVTB,setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`
    parts.push(`${v}[b${i}_0]`)

    // Title cards: each layer is a looped image, overlaid with its animation
    let base = `b${i}_0`
    for (let k = 0; k < it.layers.length; k++) {
      const l = it.layers[k]
      const until = Math.max(0.3, Math.min(l.until < 0 ? d : l.until, d) - 0.05)
      if (l.delay >= until - 0.1) continue
      const w = Math.max(2, Math.round(l.anim === 'barTop' || l.anim === 'barBottom' ? W : (l.w * H) / 1080))
      const h = Math.max(2, Math.round((l.h * H) / 1080))
      const X = l.center ? Math.round((W - w) / 2) : Math.round((l.x * H) / 1080)
      const Y = Math.round((l.y * H) / 1080)
      const fadeIn = l.anim === 'fade' ? 0.3 : 0.12
      const fades = `fade=t=in:st=${l.delay.toFixed(3)}:d=${fadeIn}:alpha=1,fade=t=out:st=${Math.max(l.delay, until - FADE_OUT).toFixed(3)}:d=${FADE_OUT}:alpha=1`
      const lab = `c${i}_${k}`
      if (l.png) {
        const file = join(tmp, `c${i}_${k}.png`)
        await fs.writeFile(file, l.png)
        const idx = nextInput()
        inputs.push('-loop', '1', '-framerate', String(FPS), '-t', d.toFixed(3), '-i', file)
        parts.push(`[${idx}:v]format=rgba,scale=${w}:${h}:flags=lanczos,${fades}[${lab}]`)
      } else {
        parts.push(`color=c=black:s=${w}x${h}:r=${FPS}:d=${d.toFixed(3)},format=rgba,${fades}[${lab}]`)
      }
      const m = layerMotion(l, X, Y, w, h, H)
      const next = `b${i}_${k + 1}`
      parts.push(
        `[${base}][${lab}]overlay=x='${m.x}':y='${m.y}':eval=frame:enable='between(t,${l.delay.toFixed(3)},${until.toFixed(3)})'[${next}]`
      )
      base = next
    }
    parts.push(`[${base}]format=yuv420p[v${i}]`)

    const tracks = metas[i].audioTracks
    if (!tracks) {
      parts.push(`anullsrc=r=48000:cl=stereo:d=${d.toFixed(3)}[a${i}]`)
    } else if (audio === 'mix' && tracks > 1) {
      const ins = Array.from({ length: tracks }, (_, k) => `[${src}:a:${k}]`).join('')
      parts.push(`${ins}amix=inputs=${tracks}:normalize=0,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`)
    } else {
      parts.push(`[${src}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`)
    }
  }

  if (items.length === 1) {
    parts.push('[v0]null[vout]', '[a0]anull[aout]')
  } else if (T <= 0) {
    const chain = items.map((_, i) => `[v${i}][a${i}]`).join('')
    parts.push(`${chain}concat=n=${items.length}:v=1:a=1[vout][aout]`)
  } else {
    let offset = 0
    let vPrev = 'v0'
    let aPrev = 'a0'
    for (let i = 1; i < items.length; i++) {
      offset += durs[i - 1] - T
      const vOut = i === items.length - 1 ? 'vout' : `vx${i}`
      const aOut = i === items.length - 1 ? 'aout' : `ax${i}`
      parts.push(`[${vPrev}][v${i}]xfade=transition=fade:duration=${T.toFixed(3)}:offset=${offset.toFixed(3)}[${vOut}]`)
      parts.push(`[${aPrev}][a${i}]acrossfade=d=${T.toFixed(3)}[${aOut}]`)
      vPrev = vOut
      aPrev = aOut
    }
  }

  const build = (encoder: 'nvenc' | 'cpu'): string[] => {
    const cq = CQ[quality]
    const enc =
      encoder === 'nvenc'
        ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', String(cq), '-b:v', '0']
        : ['-c:v', 'libx264', '-preset', 'faster', '-crf', String(cq)]
    return [
      '-hide_banner', '-v', 'error', '-y', '-nostats', '-progress', 'pipe:1',
      ...inputs,
      '-filter_complex', parts.join(';'),
      '-map', '[vout]', '-map', '[aout]',
      ...enc,
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      output
    ]
  }

  return { duration: total, build, cleanup: () => fs.rm(tmp, { recursive: true, force: true }) }
}

/* ------------------------------------------------------------------ Motion style (clean, broadcast, kinetic) */

/** Motion timings (s) */
const INTRO = MOTION_TIMES.intro
const LOBBY = MOTION_TIMES.lobby
const WIPE = MOTION_TIMES.wipe
/** where the wipe fully covers the frame: the cut sits here */
const WIPE_CUT = 0.45
/** zoom added on each kill, then it settles */
const PUNCH = { off: 0, soft: 0.035, strong: 0.07 } as const

/** Audio of one clip, normalised to 48 kHz stereo, with short fades so hard cuts don't click */
function clipAudio(src: number, tracks: number, audio: CutArgs['audio'], d: number, label: string): string {
  const fades = `afade=t=in:d=0.04,afade=t=out:st=${Math.max(0, d - 0.06).toFixed(3)}:d=0.06`
  if (!tracks) return `anullsrc=r=48000:cl=stereo:d=${d.toFixed(3)}[${label}]`
  if (audio === 'mix' && tracks > 1) {
    const ins = Array.from({ length: tracks }, (_, k) => `[${src}:a:${k}]`).join('')
    return `${ins}amix=inputs=${tracks}:normalize=0,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,${fades}[${label}]`
  }
  return `[${src}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS,${fades}[${label}]`
}

/** Slow motion on the last kill of an ace or a clutch: this window around it plays at half speed */
const SLOW_BEFORE = 0.7
const SLOW_AFTER = 0.5
const SLOW = 2

/** where a clip slows down (clip time), or null */
function slowWindow(item: MontageItem, dur: number): { a: number; b: number } | null {
  const m = item.motion
  if (!m || !m.kills.length || !(m.label === 'ACE' || m.clutch)) return null
  const last = Math.max(...m.kills)
  const a = Math.max(0, last - SLOW_BEFORE)
  const b = Math.min(dur, last + SLOW_AFTER)
  return b - a >= 0.3 ? { a, b } : null
}

type Seg =
  | { kind: 'intro' | 'lobby'; dur: number; file: string }
  | { kind: 'clip'; dur: number; src: number; item: MontageItem; i: number; slow: { a: number; b: number } | null }

/**
 * Optional match intro and scoreboard, then the highlights with hard cuts hidden under a wipe that names
 * the next round, a lower third and score per clip, and a zoom on every kill. Everything is optional
 * (MotionOptions). The motion layer is drawn when the job starts (prepare); the ffmpeg graph composes it.
 */
async function planMotion(
  items: MontageItem[],
  opts: MontageOptions,
  quality: CutArgs['quality'],
  audio: CutArgs['audio'],
  output: string
): Promise<MontagePlan> {
  const mo: MotionOptions = { ...DEFAULT_MOTION, ...opts.motion }
  const metas = await Promise.all(items.map((it) => probe(it.videoPath)))
  const W = metas[0].width - (metas[0].width % 2) || 1920
  const H = metas[0].height - (metas[0].height % 2) || 1080
  const FPS = Math.min(240, Math.round(metas[0].fps) || 60)
  const lang = opts.intro?.lang ?? (tr('en', 'fr') as 'en' | 'fr')
  const intro = opts.intro ?? null

  const tmp = join(tmpdir(), `frag-montage-${Date.now()}`)
  await fs.mkdir(tmp, { recursive: true })

  // the timeline: [intro] [scoreboard] clips [scoreboard]
  const segs: Seg[] = []
  if (intro && mo.intro) segs.push({ kind: 'intro', dur: INTRO, file: join(tmp, 'intro.mov') })
  if (intro && mo.lobby === 'intro' && intro.players.length) segs.push({ kind: 'lobby', dur: LOBBY, file: join(tmp, 'lobby.mov') })
  items.forEach((item, i) => {
    const src = Math.max(0.6, item.end - item.start)
    const slow = mo.slowmo ? slowWindow(item, src) : null
    // the slowed window lasts SLOW times longer; kill times after it move on
    const at = (t: number): number => (!slow || t <= slow.a ? t : t < slow.b ? slow.a + (t - slow.a) * SLOW : t + (slow.b - slow.a) * (SLOW - 1))
    const shown = item.motion ? { ...item.motion, kills: item.motion.kills.map(at) } : null
    segs.push({ kind: 'clip', dur: at(src), src, item: { ...item, motion: shown }, i, slow })
  })
  if (intro && mo.lobby === 'outro' && intro.players.length) segs.push({ kind: 'lobby', dur: LOBBY, file: join(tmp, 'lobby.mov') })
  const total = segs.reduce((a, s) => a + s.dur, 0)

  // what the motion layer has to draw
  const scenes: SceneJob[] = []
  for (const s of segs) {
    if (s.kind === 'intro') scenes.push({ scene: 'intro', opts: mo, intro, duration: INTRO, out: s.file, lang })
    if (s.kind === 'lobby') scenes.push({ scene: 'lobby', opts: mo, intro, duration: LOBBY, out: s.file, lang })
  }
  const lowers = new Map<number, string>()
  if (mo.lowerThirds || mo.scoreBug) {
    for (const s of segs) {
      if (s.kind !== 'clip' || !s.item.motion || s.dur < 1.6) continue
      const file = join(tmp, `lower${s.i}.mov`)
      lowers.set(s.i, file)
      scenes.push({ scene: 'lower', opts: mo, highlight: s.item.motion, duration: s.dur, out: file, lang })
    }
  }
  // one wipe per cut, naming the highlight that comes next
  const wipes: { at: number; file: string }[] = []
  let acc = 0
  for (let j = 0; j < segs.length - 1; j++) {
    acc += segs[j].dur
    const next = segs[j + 1]
    const file = join(tmp, `wipe${j}.mov`)
    wipes.push({ at: acc, file })
    scenes.push({ scene: 'wipe', opts: mo, highlight: next.kind === 'clip' ? (next.item.motion ?? null) : null, duration: WIPE, out: file, lang })
  }

  const prepare = async (onProgress: (p: number) => void): Promise<void> => {
    const frames = scenes.reduce((a, s) => a + Math.round(s.duration * 30), 0) || 1
    let done = 0
    const r = await openMotionRenderer(W, H)
    try {
      for (const sc of scenes) {
        const before = done
        await r.render(sc, (n) => {
          done = before + n
          onProgress(done / frames)
        })
      }
    } finally {
      r.close()
    }
  }

  const build = (encoder: 'nvenc' | 'cpu'): string[] => {
    const inputs: string[] = []
    const parts: string[] = []
    const nextInput = (): number => inputs.filter((x) => x === '-i').length
    const norm = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}`
    const chain: string[] = []

    segs.forEach((s, j) => {
      if (s.kind !== 'clip') {
        const k = nextInput()
        inputs.push('-i', s.file)
        parts.push(`[${k}:v]settb=AVTB,setpts=PTS-STARTPTS,${norm},format=yuv420p,trim=duration=${s.dur}[sv${j}]`)
        parts.push(`anullsrc=r=48000:cl=stereo:d=${s.dur}[sa${j}]`)
        chain.push(`[sv${j}][sa${j}]`)
        return
      }
      const { item, i, dur, slow } = s
      const src = nextInput()
      inputs.push('-ss', item.start.toFixed(3), '-t', s.src.toFixed(3), '-i', item.videoPath)
      const kills = PUNCH[mo.punch] ? (item.motion?.kills ?? []).filter((k) => k >= 0 && k < dur) : []
      const z = kills.map((k) => `${PUNCH[mo.punch]}*exp(-(it-${k.toFixed(3)})*7)*gte(it\\,${k.toFixed(3)})`).join('+')
      const punch = z ? `,zoompan=z='1+${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS}` : ''
      if (slow) {
        // normal, half speed (frames held: no blending), normal
        const { a, b } = slow
        parts.push(`[${src}:v:0]settb=AVTB,setpts=PTS-STARTPTS,${norm},split=3[s${j}a][s${j}b][s${j}c]`)
        parts.push(`[s${j}a]trim=0:${a.toFixed(3)},setpts=PTS-STARTPTS[s${j}a1]`)
        parts.push(`[s${j}b]trim=${a.toFixed(3)}:${b.toFixed(3)},setpts=(PTS-STARTPTS)*${SLOW},fps=${FPS}[s${j}b1]`)
        parts.push(`[s${j}c]trim=${b.toFixed(3)},setpts=PTS-STARTPTS[s${j}c1]`)
        parts.push(`[s${j}a1][s${j}b1][s${j}c1]concat=n=3:v=1:a=0,settb=AVTB,setpts=PTS-STARTPTS${punch},format=yuv420p[c${j}]`)
      } else {
        parts.push(`[${src}:v:0]settb=AVTB,setpts=PTS-STARTPTS,${norm}${punch},format=yuv420p[c${j}]`)
      }
      let v = `c${j}`
      const lo = lowers.get(i)
      if (lo) {
        const k = nextInput()
        inputs.push('-i', lo)
        parts.push(`[${k}:v]setpts=PTS-STARTPTS,format=argb[lo${j}]`)
        parts.push(`[${v}][lo${j}]overlay=0:0:eof_action=pass:repeatlast=0:format=auto,format=yuv420p[cl${j}]`)
        v = `cl${j}`
      }
      if (slow) {
        // the slowed part of the sound drops an octave, like a film's slow motion
        const { a, b } = slow
        parts.push(clipAudio(src, metas[i].audioTracks, audio, s.src, `sr${j}`))
        parts.push(`[sr${j}]asplit=3[r${j}a][r${j}b][r${j}c]`)
        parts.push(`[r${j}a]atrim=0:${a.toFixed(3)},asetpts=PTS-STARTPTS[r${j}a1]`)
        parts.push(`[r${j}b]atrim=${a.toFixed(3)}:${b.toFixed(3)},asetpts=PTS-STARTPTS,asetrate=${48000 / SLOW},aresample=48000[r${j}b1]`)
        parts.push(`[r${j}c]atrim=${b.toFixed(3)},asetpts=PTS-STARTPTS[r${j}c1]`)
        parts.push(`[r${j}a1][r${j}b1][r${j}c1]concat=n=3:v=0:a=1[sa${j}]`)
      } else {
        parts.push(clipAudio(src, metas[i].audioTracks, audio, dur, `sa${j}`))
      }
      chain.push(`[${v}][sa${j}]`)
    })

    const music = mo.music && existsSync(mo.music) ? mo.music : null
    parts.push(`${chain.join('')}concat=n=${chain.length}:v=1:a=1[vcat][${music ? 'agame' : 'aout'}]`)
    if (music) {
      // the track loops under the whole montage, fades in and out, and ducks when the game is loud
      const k = nextInput()
      inputs.push('-stream_loop', '-1', '-i', music)
      const vol = Math.max(0, Math.min(1, mo.musicVolume)).toFixed(2)
      parts.push(`[${k}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=${vol},afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, total - 2.5).toFixed(3)}:d=2.5[mus]`)
      parts.push(`[agame]asplit=2[ag1][ag2]`)
      parts.push(`[mus][ag2]sidechaincompress=threshold=0.04:ratio=8:attack=15:release=350[musd]`)
      parts.push(`[ag1][musd]amix=inputs=2:duration=first:normalize=0[aout]`)
    }
    let v = 'vcat'
    wipes.forEach((w, j) => {
      const k = nextInput()
      inputs.push('-i', w.file)
      const start = Math.max(0, w.at - WIPE_CUT)
      parts.push(`[${k}:v]setpts=PTS-STARTPTS+${start.toFixed(3)}/TB,format=argb[wp${j}]`)
      parts.push(`[${v}][wp${j}]overlay=0:0:eof_action=pass:repeatlast=0:format=auto[vw${j}]`)
      v = `vw${j}`
    })
    parts.push(`[${v}]format=yuv420p[vout]`)

    return [
      '-hide_banner', '-v', 'error', '-y', '-nostats', '-progress', 'pipe:1',
      ...inputs,
      '-filter_complex', parts.join(';'),
      '-map', '[vout]', '-map', '[aout]',
      ...encoderArgs(encoder, quality),
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      output
    ]
  }

  return { duration: total, prepare, build, cleanup: () => fs.rm(tmp, { recursive: true, force: true }) }
}
