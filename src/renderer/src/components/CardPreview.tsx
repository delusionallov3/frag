import { tr } from '@shared/i18n'
import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { CardLayer, CardStyle } from '@shared/types'
import { renderCard, type CardText } from '../lib/cards'
import { mediaUrl } from '../lib/format'

/** Same values as src/main/montage.ts, so the preview matches the export */
const ENTER = 0.45
const FADE_OUT = 0.35
/** length of a sample clip in the preview, for layers that stay until the end */
const PREVIEW_CLIP = 4.5
const easeOutCubic = 'cubic-bezier(0.33, 1, 0.68, 1)'

interface Shown {
  layer: CardLayer
  url: string | null
}

export default function CardPreview({
  videoPath,
  at,
  style,
  accent,
  text
}: {
  videoPath: string | null
  at: number | null
  style: CardStyle
  accent: string
  text: CardText
}): JSX.Element {
  const frameRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [bg, setBg] = useState<string | null>(null)
  const [layers, setLayers] = useState<Shown[]>([])
  const [run, setRun] = useState(0)

  // Game frame at the start of the clip, as the background
  useEffect(() => {
    setBg(null)
    if (!videoPath || at === null) return
    let alive = true
    window.frag.frame(videoPath, at + 0.5).then((r) => alive && r.ok && setBg(mediaUrl(r.data)))
    return () => {
      alive = false
    }
  }, [videoPath, at])

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Draw the card (small debounce: don't redraw on every keystroke)
  const key = `${style}|${accent}|${text.title}|${text.sub}|${text.index}|${text.total}`
  useEffect(() => {
    let alive = true
    let urls: string[] = []
    const id = setTimeout(async () => {
      const ls = await renderCard(style, text, accent).catch(() => [])
      if (!alive) return
      const shown = ls.map((l) => ({
        layer: l,
        url: l.png ? URL.createObjectURL(new Blob([l.png as Uint8Array<ArrayBuffer>], { type: 'image/png' })) : null
      }))
      urls = shown.flatMap((s) => (s.url ? [s.url] : []))
      setLayers(shown)
      setRun((r) => r + 1)
    }, 180)
    return () => {
      alive = false
      clearTimeout(id)
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // Animations: looped with the same timing as ffmpeg
  useEffect(() => {
    const el = frameRef.current
    if (!el || !width) return
    const s = width / 1920
    const nodes = Array.from(el.querySelectorAll<HTMLElement>('[data-layer]'))
    const cycle = PREVIEW_CLIP + 0.8
    const anims = nodes.map((node, i) => {
      const l = layers[i]?.layer
      if (!l) return null
      const until = l.until < 0 ? PREVIEW_CLIP : Math.min(l.until, PREVIEW_CLIP)
      const fadeIn = l.anim === 'fade' ? 0.3 : 0.12
      const o = (t: number): number => Math.min(1, Math.max(0, t / cycle))
      node.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 0, offset: o(l.delay) },
          { opacity: 1, offset: o(l.delay + fadeIn) },
          { opacity: 1, offset: o(until - FADE_OUT) },
          { opacity: 0, offset: o(until) },
          { opacity: 0, offset: 1 }
        ],
        { duration: cycle * 1000, iterations: Infinity }
      )
      const from =
        l.anim === 'slide'
          ? `translateX(${-(l.x + l.w) * s}px)`
          : l.anim === 'rise'
            ? `translateY(${40 * s}px)`
            : l.anim === 'barTop'
              ? 'translateY(-100%)'
              : l.anim === 'barBottom'
                ? 'translateY(100%)'
                : 'none'
      if (from === 'none') return null
      return node.animate(
        [
          { transform: from, offset: 0 },
          { transform: from, offset: o(l.delay), easing: easeOutCubic },
          { transform: 'none', offset: o(l.delay + ENTER) },
          { transform: 'none', offset: 1 }
        ],
        { duration: cycle * 1000, iterations: Infinity }
      )
    })
    return () => {
      nodes.forEach((n) => n.getAnimations().forEach((a) => a.cancel()))
      void anims
    }
  }, [layers, width, run])

  const s = width / 1920
  return (
    <div className="cp">
      <div className="cp-frame" ref={frameRef} style={bg ? { backgroundImage: `url("${bg}")` } : undefined}>
        {layers.map(({ layer: l, url }, i) => {
          const pos = {
            left: l.center ? (width - l.w * s) / 2 : l.anim === 'barTop' || l.anim === 'barBottom' ? 0 : l.x * s,
            top: l.y * s,
            width: l.anim === 'barTop' || l.anim === 'barBottom' ? '100%' : l.w * s,
            height: l.h * s
          }
          return url ? (
            <img key={`${run}-${i}`} data-layer src={url} alt="" draggable={false} style={pos} />
          ) : (
            <div key={`${run}-${i}`} data-layer className="cp-bar" style={pos} />
          )
        })}
        {style === 'none' && <span className="cp-none">Sans carton</span>}
      </div>
      <button className="icon-btn cp-replay" onClick={() => setRun((r) => r + 1)} title={tr('Replay', 'Rejouer')}>
        <RotateCcw />
      </button>
    </div>
  )
}
