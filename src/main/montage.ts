import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { CardLayer, MontageItem, MontageOptions } from '@shared/types'
import { probe, type CutArgs } from './ffmpeg'

const CQ = { high: 18, balanced: 23, light: 28 } as const

/** Durées des animations des cartons (s) */
const ENTER = 0.45
const FADE_OUT = 0.35

/**
 * Expressions ffmpeg (entre apostrophes : les virgules ne coupent pas le filtre).
 * e = reste de l'entrée, de 1 (début) à 0 (en place), en « ease-out » cubique.
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
  build: (encoder: 'nvenc' | 'cpu') => string[]
  cleanup: () => Promise<void>
}

export async function planMontage(
  items: MontageItem[],
  opts: MontageOptions,
  quality: CutArgs['quality'],
  audio: CutArgs['audio'],
  output: string
): Promise<MontagePlan> {
  if (items.length < 1) throw new Error('Aucun clip dans le montage')
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
  /** index ffmpeg de la prochaine entrée (les images des cartons s'intercalent entre les vidéos) */
  const nextInput = (): number => inputs.filter((x) => x === '-i').length

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const d = durs[i]
    const src = nextInput()
    inputs.push('-ss', it.start.toFixed(3), '-t', d.toFixed(3), '-i', it.videoPath)

    // le temps repart de 0 AVANT fps=, sinon xfade perd la fréquence d'images
    const v = `[${src}:v:0]settb=AVTB,setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p`
    parts.push(`${v}[b${i}_0]`)

    // Cartons titres : chaque calque est une image en boucle, incrustée avec son animation
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
