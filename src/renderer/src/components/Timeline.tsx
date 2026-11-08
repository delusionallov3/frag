import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { ZoomIn, ZoomOut, Maximize2, Magnet } from 'lucide-react'
import { useLookup } from '../lib/assets'
import VImg from './VImg'
import SpikeIcon from './SpikeIcon'
import type { Clip, Marker, ThumbStrip, Waveform } from '@shared/types'
import { joinPath, mediaUrl } from '../lib/format'
import type { RoundInfo, TLEvent } from '../lib/match'

export interface TimelineHandle {
  zoomIn: () => void
  zoomOut: () => void
  fit: () => void
}

interface Props {
  duration: number
  time: number
  playing: boolean
  aspect: number
  clips: Clip[]
  markers: Marker[]
  selectedId: string | null
  thumbs: ThumbStrip | null
  wave: Waveform | null
  snap: boolean
  onSnapChange: (v: boolean) => void
  tools?: ReactNode
  onSeek: (t: number) => void
  onSelect: (id: string | null) => void
  onClipEditStart: () => void
  onClipChange: (id: string, start: number, end: number) => void
  onClipEditEnd: () => void
  selectedMarkerId: string | null
  onMarkerSelect: (id: string) => void
  onMarkerRemove: (id: string) => void
  matchRounds: RoundInfo[] | null
  events: TLEvent[]
  selectedEventId: string | null
  onEventSelect: (id: string) => void
}

const PAD = 14
const RULER_H = 26
const LANE_H = 24
const THUMB_H = 58
const WAVE_H = 52
const MATCH_H = 30
const MAX_PPS = 600
const MIN_CLIP = 0.2
const SNAP_PX = 8

const TICKS: [number, number][] = [
  [0.1, 0.02], [0.2, 0.05], [0.5, 0.1], [1, 0.2], [2, 0.5], [5, 1], [10, 2], [15, 5], [30, 5],
  [60, 10], [120, 30], [300, 60], [600, 120], [900, 300], [1800, 300], [3600, 600]
]

function tickLabel(t: number, fine: boolean): string {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  if (fine) return `${m}:${s.toFixed(1).padStart(4, '0')}`
  return `${m}:${String(Math.round(s)).padStart(2, '0')}`
}

const css = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

type Drag =
  | { kind: 'scrub' }
  | { kind: 'start' | 'end' | 'move'; id: string; x0: number; s0: number; e0: number; targets: number[] }

const Timeline = forwardRef<TimelineHandle, Props>(function Timeline(p, ref) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgCache = useRef(new Map<string, HTMLImageElement>())
  const dragRef = useRef<Drag | null>(null)
  const pendingScroll = useRef<number | null>(null)
  const raf = useRef(0)

  const [width, setWidth] = useState(800)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [fit, setFit] = useState(true)
  const [ppsRaw, setPpsRaw] = useState(1)
  const [hoverX, setHoverX] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)

  const L = useLookup()
  const matchH = p.matchRounds ? MATCH_H : 0
  const laneTop = RULER_H + matchH
  const TRACK_TOP = laneTop + LANE_H
  const TOTAL_H = TRACK_TOP + THUMB_H + WAVE_H

  const fitPps = Math.max(0.0001, (width - PAD * 2) / Math.max(p.duration, 0.1))
  const pps = fit ? fitPps : Math.min(MAX_PPS, Math.max(fitPps, ppsRaw))
  const contentW = PAD * 2 + p.duration * pps

  // Taille du viewport
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Applique le scroll calculé lors d'un zoom une fois la largeur mise à jour
  useLayoutEffect(() => {
    const sc = scrollRef.current
    if (sc && pendingScroll.current !== null) {
      sc.scrollLeft = pendingScroll.current
      pendingScroll.current = null
      setScrollLeft(sc.scrollLeft)
    }
  }, [pps])

  const zoomTo = useCallback(
    (nextPps: number, anchorTime?: number, anchorScreenX?: number) => {
      const target = Math.min(MAX_PPS, Math.max(fitPps, nextPps))
      const sc = scrollRef.current
      if (!sc) return
      let t = anchorTime ?? p.time
      let sx = anchorScreenX ?? PAD + t * pps - sc.scrollLeft
      if (anchorScreenX === undefined && (sx < 0 || sx > width)) {
        sx = width / 2
        t = (sc.scrollLeft + sx - PAD) / pps
      }
      if (target <= fitPps + 1e-6) {
        setFit(true)
        pendingScroll.current = 0
      } else {
        setFit(false)
        setPpsRaw(target)
        pendingScroll.current = Math.max(0, PAD + t * target - sx)
      }
    },
    [fitPps, p.time, pps, width]
  )

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomTo(pps * 1.6),
      zoomOut: () => zoomTo(pps / 1.6),
      fit: () => zoomTo(0)
    }),
    [zoomTo, pps]
  )

  // Molette : Ctrl = zoom autour du curseur, sinon défilement horizontal
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = sc.getBoundingClientRect()
        const sx = e.clientX - rect.left
        const t = (sc.scrollLeft + sx - PAD) / pps
        zoomTo(pps * Math.exp(-e.deltaY * 0.0025), t, sx)
      } else {
        sc.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      }
    }
    sc.addEventListener('wheel', onWheel, { passive: false })
    return () => sc.removeEventListener('wheel', onWheel)
  }, [pps, zoomTo])

  // Suit la tête de lecture pendant la lecture
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc || !p.playing || dragging || fit) return
    const x = PAD + p.time * pps
    if (x > sc.scrollLeft + width - 40 || x < sc.scrollLeft) {
      sc.scrollLeft = x - width * 0.12
    }
  }, [p.time, p.playing, pps, width, dragging, fit])

  /* ------------------------------ Dessin canvas ------------------------------ */

  const draw = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const W = width
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(TOTAL_H * dpr)) {
      c.width = Math.round(W * dpr)
      c.height = Math.round(TOTAL_H * dpr)
      c.style.width = `${W}px`
      c.style.height = `${TOTAL_H}px`
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, TOTAL_H)

    const sl = scrollLeft
    const X = (t: number): number => PAD + t * pps - sl
    const x0 = Math.max(0, X(0))
    const x1 = Math.min(W, X(p.duration))

    const cTrack = css('--track') || '#141418'
    const cLine = css('--line') || 'rgba(255,255,255,.07)'
    const cFaint = css('--faint') || '#5c5c66'
    const cWave = css('--wave') || '#4a4a56'

    // Fonds des pistes
    ctx.fillStyle = cTrack
    ctx.fillRect(x0, TRACK_TOP, x1 - x0, THUMB_H)
    ctx.fillRect(x0, TRACK_TOP + THUMB_H + 1, x1 - x0, WAVE_H - 1)

    // Règle
    const [major, minor] = TICKS.find(([m]) => m * pps >= 84) ?? TICKS[TICKS.length - 1]
    const tStart = Math.max(0, (sl - PAD) / pps)
    const tEnd = Math.min(p.duration, (sl + W - PAD) / pps)
    ctx.fillStyle = cLine
    for (let t = Math.floor(tStart / minor) * minor; t <= tEnd; t += minor) {
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6
      const x = Math.round(X(t)) + 0.5
      ctx.fillRect(x - 0.5, isMajor ? RULER_H - 10 : RULER_H - 5, 1, isMajor ? 10 : 5)
    }
    ctx.font = '400 10px "Geist Mono Variable", ui-monospace, monospace'
    ctx.fillStyle = cFaint
    ctx.textBaseline = 'middle'
    for (let t = Math.floor(tStart / major) * major; t <= tEnd; t += major) {
      ctx.fillText(tickLabel(t, major < 1), Math.round(X(t)) + 4, 9)
    }
    ctx.fillStyle = cLine
    ctx.fillRect(0, RULER_H - 0.5, W, 1)

    // Vignettes
    const th = p.thumbs
    if (th && th.count > 0) {
      const tw = THUMB_H * p.aspect
      ctx.save()
      ctx.beginPath()
      ctx.rect(x0, TRACK_TOP, x1 - x0, THUMB_H)
      ctx.clip()
      const kStart = Math.max(0, Math.floor((sl - PAD) / tw))
      for (let k = kStart; ; k++) {
        const cx = PAD + k * tw - sl
        if (cx > W || (k * tw) / pps >= p.duration) break
        const tc = Math.min((k * tw + tw / 2) / pps, p.duration - 0.01)
        const idx = Math.min(th.count - 1, Math.max(0, Math.floor(tc / th.interval)))
        const url = mediaUrl(joinPath(th.dir, `t_${String(idx + 1).padStart(5, '0')}.jpg`))
        let img = imgCache.current.get(url)
        if (!img) {
          img = new Image()
          img.src = url
          img.onload = () => scheduleDraw()
          imgCache.current.set(url, img)
        }
        if (img.complete && img.naturalWidth) {
          ctx.drawImage(img, cx, TRACK_TOP, tw, THUMB_H)
        }
        ctx.fillStyle = 'rgba(0,0,0,.35)'
        ctx.fillRect(cx + tw - 1, TRACK_TOP, 1, THUMB_H)
      }
      ctx.restore()
    }

    // Forme d'onde
    const wv = p.wave
    if (wv && wv.peaks.length) {
      const ps = wv.perSecond
      const peaks = wv.peaks
      const mid = TRACK_TOP + THUMB_H + WAVE_H / 2 + 0.5
      const amp = WAVE_H / 2 - 5
      ctx.fillStyle = cWave
      ctx.beginPath()
      for (let sx = Math.floor(x0); sx < x1; sx++) {
        const ta = (sx + sl - PAD) / pps
        const tb = ta + 1 / pps
        const i0 = Math.max(0, Math.floor(ta * ps))
        const i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.ceil(tb * ps)))
        let m = 0
        for (let i = i0; i < i1; i++) if (peaks[i] > m) m = peaks[i]
        const h = Math.max(0.5, (m / 255) * amp)
        ctx.rect(sx, mid - h, 1, h * 2)
      }
      ctx.fill()
    }
  }, [width, scrollLeft, pps, p.duration, p.thumbs, p.wave, p.aspect, TRACK_TOP, TOTAL_H])

  const scheduleDraw = useCallback(() => {
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => drawRef.current())
  }, [])
  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    imgCache.current.clear()
  }, [p.thumbs])

  /* ------------------------------ Interactions ------------------------------ */

  const timeAt = (clientX: number): number => {
    const rect = innerRef.current!.getBoundingClientRect()
    return Math.min(p.duration, Math.max(0, (clientX - rect.left - PAD) / pps))
  }

  const snapTo = (t: number, targets: number[]): number => {
    if (!p.snap) return t
    let best = t
    let bestD = SNAP_PX / pps
    for (const s of targets) {
      const d = Math.abs(s - t)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }

  const beginScrub = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { kind: 'scrub' }
    setDragging(true)
    p.onSeek(timeAt(e.clientX))
  }

  const beginClipDrag = (e: React.PointerEvent, clip: Clip, kind: 'start' | 'end' | 'move'): void => {
    if (e.button !== 0) return
    e.stopPropagation()
    innerRef.current!.setPointerCapture(e.pointerId)
    p.onSelect(clip.id)
    p.onClipEditStart()
    const targets = [0, p.duration, p.time, ...p.markers.map((m) => m.time)]
    for (const c of p.clips) if (c.id !== clip.id) targets.push(c.start, c.end)
    dragRef.current = { kind, id: clip.id, x0: e.clientX, s0: clip.start, e0: clip.end, targets }
    setDragging(true)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    const rect = innerRef.current!.getBoundingClientRect()
    setHoverX(e.clientX - rect.left)
    if (!d) return
    if (d.kind === 'scrub') {
      p.onSeek(timeAt(e.clientX))
      return
    }
    const dt = (e.clientX - d.x0) / pps
    if (d.kind === 'start') {
      const s = Math.min(d.e0 - MIN_CLIP, Math.max(0, snapTo(d.s0 + dt, d.targets)))
      p.onClipChange(d.id, s, d.e0)
      p.onSeek(s)
    } else if (d.kind === 'end') {
      const en = Math.max(d.s0 + MIN_CLIP, Math.min(p.duration, snapTo(d.e0 + dt, d.targets)))
      p.onClipChange(d.id, d.s0, en)
      p.onSeek(Math.max(0, en - 0.001))
    } else {
      const len = d.e0 - d.s0
      let s = d.s0 + dt
      const sSnap = snapTo(s, d.targets)
      const eSnap = snapTo(s + len, d.targets)
      if (sSnap !== s) s = sSnap
      else if (eSnap !== s + len) s = eSnap - len
      s = Math.min(p.duration - len, Math.max(0, s))
      p.onClipChange(d.id, s, s + len)
      p.onSeek(s)
    }
  }

  const endDrag = (): void => {
    const d = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (d && d.kind !== 'scrub') p.onClipEditEnd()
  }

  /* ------------------------------ Rendu ------------------------------ */

  const zoomValue = useMemo(() => {
    const r = MAX_PPS / fitPps
    return r <= 1 ? 0 : Math.log(pps / fitPps) / Math.log(r)
  }, [pps, fitPps])

  const hoverTime = hoverX !== null ? Math.min(p.duration, Math.max(0, (hoverX - PAD) / pps)) : null

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <div className="tl-tools">{p.tools}</div>
        <div className="tl-zoom">
          <button
            className={`icon-btn ${p.snap ? 'is-on' : ''}`}
            onClick={() => p.onSnapChange(!p.snap)}
            title="Magnétisme (aimante les bords sur la tête de lecture, les marqueurs et les autres clips)"
          >
            <Magnet size={15} />
          </button>
          <span className="tl-sep" />
          <button className="icon-btn" onClick={() => zoomTo(pps / 1.6)} title="Dézoomer (-)">
            <ZoomOut size={15} />
          </button>
          <input
            type="range"
            className="slider tl-zoom-slider"
            min={0}
            max={1}
            step={0.001}
            value={zoomValue}
            onChange={(e) => zoomTo(fitPps * Math.pow(MAX_PPS / fitPps, Number(e.target.value)))}
          />
          <button className="icon-btn" onClick={() => zoomTo(pps * 1.6)} title="Zoomer (+)">
            <ZoomIn size={15} />
          </button>
          <button className={`icon-btn ${fit ? 'is-on' : ''}`} onClick={() => zoomTo(0)} title="Tout afficher (0)">
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      <div className="tl-view" ref={wrapRef} style={{ height: TOTAL_H + 10 }}>
        <canvas ref={canvasRef} className="tl-canvas" />
        <div
          className="tl-scroll"
          ref={scrollRef}
          onScroll={(e) => setScrollLeft((e.target as HTMLDivElement).scrollLeft)}
        >
          <div
            className={`tl-inner ${dragging ? 'is-dragging' : ''}`}
            ref={innerRef}
            style={{ width: contentW, height: TOTAL_H }}
            onPointerDown={beginScrub}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => !dragRef.current && setHoverX(null)}
          >
            {p.matchRounds?.map((r) => {
              if (r.start === null || r.end === null) return null
              const s0 = Math.max(0, r.start)
              const e0 = Math.min(p.duration, r.end)
              if (e0 <= s0) return null
              const w = (e0 - s0) * pps
              return (
                <div
                  key={r.index}
                  className={`tl-round ${r.won ? 'is-win' : r.won === false ? 'is-loss' : ''}`}
                  style={{ left: PAD + s0 * pps, width: w, top: RULER_H + 2, height: MATCH_H - 4 }}
                  title={`Round ${r.n} · ${r.won ? 'gagné' : r.won === false ? 'perdu' : ''} · ${r.score}`}
                >
                  {w > 30 && <span>R{r.n}</span>}
                </div>
              )
            })}

            {p.events.map((ev) => {
              if (ev.t < 0 || ev.t > p.duration) return null
              const sel = ev.id === p.selectedEventId
              return (
                <div key={ev.id}>
                  {ev.kind === 'kill' && (
                    <div
                      className={`tl-killline ${sel ? 'is-sel' : ''}`}
                      style={{ left: PAD + ev.t * pps, top: laneTop, height: TOTAL_H - laneTop }}
                    />
                  )}
                  <button
                    className={`tl-ev is-${ev.kind} ${sel ? 'is-sel' : ''}`}
                    style={{ left: PAD + ev.t * pps, top: RULER_H + MATCH_H / 2 }}
                    title={ev.label}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      if (e.button === 0) p.onEventSelect(ev.id)
                    }}
                  >
                    {ev.kind === 'kill' || ev.kind === 'death' ? (
                      <VImg
                        src={L.agent(ev.agentId, ev.agent)?.icon}
                        className="tl-ev-agent"
                        fallback={<span className="tl-ev-dot" />}
                      />
                    ) : (
                      <SpikeIcon size={13} />
                    )}
                  </button>
                </div>
              )
            })}

            {p.clips.map((c) => {
              const w = Math.max(3, (c.end - c.start) * pps)
              const sel = c.id === p.selectedId
              return (
                <div
                  key={c.id}
                  className={`tl-clip ${sel ? 'is-sel' : ''}`}
                  style={{ left: PAD + c.start * pps, width: w, top: laneTop, height: TOTAL_H - laneTop }}
                >
                  <div className="tl-clip-head" onPointerDown={(e) => beginClipDrag(e, c, 'move')}>
                    {w > 46 && <span>{c.name}</span>}
                  </div>
                  <div className="tl-clip-edge is-l" onPointerDown={(e) => beginClipDrag(e, c, 'start')} />
                  <div className="tl-clip-edge is-r" onPointerDown={(e) => beginClipDrag(e, c, 'end')} />
                </div>
              )
            })}

            {p.markers.map((m) => (
              <div
                key={m.id}
                className={`tl-marker ${m.id === p.selectedMarkerId ? 'is-sel' : ''}`}
                style={{ left: PAD + m.time * pps }}
              >
                <button
                  className="tl-marker-flag"
                  title={`${m.label ? `${m.label}\n` : ''}Clic : sélectionner · Suppr ou clic droit : supprimer`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    if (e.button === 0) {
                      p.onMarkerSelect(m.id)
                      p.onSeek(m.time)
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    p.onMarkerRemove(m.id)
                  }}
                />
              </div>
            ))}

            {hoverTime !== null && !dragging && (
              <div className="tl-hover" style={{ left: PAD + hoverTime * pps }}>
                <span>{tickLabel(hoverTime, true)}</span>
              </div>
            )}

            <div className="tl-playhead" style={{ left: PAD + p.time * pps }}>
              <div className="tl-playhead-head" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

export default Timeline
