/**
 * The match recap window: pick a style, tune every part, watch it live, export.
 * The preview is the real motion page (motion.html) in an iframe, driven frame by frame through
 * postMessage, so what you see is exactly what the export draws.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MatchLink, MotionOptions, MotionStyle } from '@shared/types'
import { tr } from '@shared/i18n'
import { MOTION_ACCENTS, MOTION_STYLES, MOTION_TIMES } from '@shared/motion'
import { useApp } from '../store'
import { mediaUrl, fmtClipLen } from '../lib/format'
import type { AutoClipOptions, RoundInfo } from '../lib/match'
import { introFor, readMotion, recapItems, writeMotion } from '../lib/recap'
import { Clapperboard } from '../lib/icons'
import Modal from './Modal'

type PreviewScene = 'intro' | 'lobby' | 'wipe' | 'lower'


const styleInfo = (s: MotionStyle): { name: string; line: string } =>
  ({
    clean: { name: 'Clean', line: tr('Calm and exact: big type, soft pushes', 'Calme et précis : grand texte, transitions douces') },
    broadcast: { name: 'Broadcast', line: tr('Esports energy: slanted panels, colour wipes', 'Énergie esport : panneaux en biais, volets couleur') },
    kinetic: { name: 'Kinetic', line: tr('Type in motion: huge words, speed lines', 'Texte en mouvement : mots géants, traits de vitesse') }
  })[s]

export default function RecapModal({
  open,
  onClose,
  link,
  rounds,
  videoPath,
  duration,
  defaults
}: {
  open: boolean
  onClose: () => void
  link: MatchLink
  rounds: RoundInfo[]
  videoPath: string
  duration: number
  defaults: AutoClipOptions
}): JSX.Element | null {
  const { showToast, setExportsOpen } = useApp()
  const [m, setM] = useState<MotionOptions>(readMotion)
  const [minKills, setMinKills] = useState(defaults.minKills)
  const [clutches, setClutches] = useState(defaults.clutches)
  const [scene, setScene] = useState<PreviewScene>('intro')
  const [busy, setBusy] = useState(false)
  const [bg, setBg] = useState<string | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const [loaded, setLoaded] = useState(false)

  const update = (patch: Partial<MotionOptions>): void =>
    setM((cur) => {
      const next = { ...cur, ...patch }
      writeMotion(next)
      return next
    })

  const intro = useMemo(() => introFor(link), [link])
  const opts: AutoClipOptions = { ...defaults, minKills, clutches }
  const items = useMemo(
    () => (open ? recapItems(link, rounds, videoPath, duration, opts) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, link, rounds, videoPath, duration, minKills, clutches, defaults.pre, defaults.post]
  )
  const sample = items.find((it) => it.motion && it.motion.kills.length >= 2) ?? items[0] ?? null
  const length =
    items.reduce((a, it) => a + (it.end - it.start), 0) +
    (m.intro ? MOTION_TIMES.intro : 0) +
    (m.lobby !== 'off' ? MOTION_TIMES.lobby : 0)

  // a real frame of the first highlight behind the transparent scenes
  useEffect(() => {
    if (!open || !sample) return
    let alive = true
    window.frag.frame(videoPath, sample.start + 1).then((r) => alive && r.ok && setBg(mediaUrl(r.data)))
    return () => {
      alive = false
    }
  }, [open, sample?.start, videoPath])

  // fit the 1280×720 page into the preview box
  useEffect(() => {
    if (!open || !box.current) return
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / 1280))
    ro.observe(box.current)
    return () => ro.disconnect()
  }, [open])

  // drive the preview: set the scene up, then play it in a loop
  useEffect(() => {
    if (!open || !loaded) return
    const win = frame.current?.contentWindow
    if (!win) return
    const dur =
      scene === 'intro' ? MOTION_TIMES.intro : scene === 'lobby' ? MOTION_TIMES.lobby : scene === 'wipe' ? MOTION_TIMES.wipe : sample ? Math.min(8, sample.end - sample.start) : 5
    const args = {
      scene,
      width: 1280,
      height: 720,
      opts: m,
      intro,
      highlight: sample?.motion ?? null,
      duration: dur,
      lang: intro.lang
    }
    let raf = 0
    let ready = false
    const id = Math.random()
    const onMsg = (e: MessageEvent): void => {
      if ((e.data as { type?: string; id?: number })?.type === 'ready' && (e.data as { id?: number }).id === id) ready = true
    }
    window.addEventListener('message', onMsg)
    const start = performance.now()
    const loop = dur + (scene === 'wipe' ? 1.2 : 0.8)
    const tick = (): void => {
      if (ready) win.postMessage({ type: 'render', t: ((performance.now() - start) / 1000) % loop }, '*')
      raf = requestAnimationFrame(tick)
    }
    const send = (): void => win.postMessage({ type: 'setup', args, id }, '*')
    send()
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('message', onMsg)
    }
  }, [open, loaded, scene, m, intro, sample])

  const exportRecap = async (): Promise<void> => {
    if (!items.length) return
    setBusy(true)
    const res = await window.frag.exportMontage(items, {
      transition: 0,
      name: `${intro.map} ${intro.us}-${intro.them} · ${tr('recap', 'résumé')}`,
      style: 'motion',
      motion: m,
      intro
    })
    setBusy(false)
    if (!res.ok) {
      showToast(res.error)
      return
    }
    onClose()
    showToast(tr(`Recap queued: ${items.length} highlights`, `Résumé en file : ${items.length} temps forts`), {
      label: tr('View', 'Voir'),
      run: () => setExportsOpen(true)
    })
  }

  if (!open) return null
  const toggle = (k: 'intro' | 'lowerThirds' | 'scoreBug' | 'wipeLabels' | 'names', label: string): JSX.Element => (
    <label className="toggle">
      <input type="checkbox" checked={m[k]} onChange={(e) => update({ [k]: e.target.checked })} />
      <span />
      {label}
    </label>
  )
  const scenes: [PreviewScene, string][] = [
    ['intro', 'Intro'],
    ['lower', tr('Highlight', 'Temps fort')],
    ['wipe', 'Transition'],
    ['lobby', tr('Scoreboard', 'Tableau')]
  ]

  return (
    <Modal open title={tr('Match recap', 'Résumé du match')} onClose={onClose} width={1220}>
      <div className="rc">
        <div className="rc-preview">
          <div className="rc-screen" ref={box} style={{ backgroundImage: bg && (scene === 'lower' || scene === 'wipe') ? `url("${bg}")` : undefined }}>
            <iframe
              ref={frame}
              src="motion.html"
              title={tr('Preview', 'Aperçu')}
              style={{ transform: `scale(${scale})` }}
              onLoad={() => setLoaded(true)}
            />
          </div>
          <div className="segmented rc-scenes">
            {scenes.map(([k, l]) => (
              <button key={k} className={scene === k ? 'is-on' : ''} onClick={() => setScene(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="rc-side">
          <div className="field">
            <label>Style</label>
            <div className="rc-styles">
              {MOTION_STYLES.map((s) => (
                <button key={s} className={m.style === s ? 'is-on' : ''} onClick={() => update({ style: s })}>
                  <b>{styleInfo(s).name}</b>
                  <span>{styleInfo(s).line}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{tr('Colour', 'Couleur')}</label>
            <div className="rc-accents">
              {MOTION_ACCENTS.map((c) => (
                <button key={c} className={m.accent === c ? 'is-on' : ''} style={{ background: c }} onClick={() => update({ accent: c })} aria-label={c} />
              ))}
            </div>
          </div>

          <div className="field">
            <label>{tr('On screen', 'À l’écran')}</label>
            <div className="rc-toggles">
              {toggle('intro', tr('Match intro', 'Intro du match'))}
              {toggle('lowerThirds', tr('Highlight label', 'Titre du temps fort'))}
              {toggle('scoreBug', tr('Round and score', 'Round et score'))}
              {toggle('wipeLabels', tr('Round on transitions', 'Round sur les transitions'))}
              {toggle('names', tr('Player names', 'Pseudos des joueurs'))}
            </div>
          </div>

          <div className="field">
            <label>{tr('Scoreboard (all 10 players, ranks)', 'Tableau (les 10 joueurs, rangs)')}</label>
            <div className="segmented">
              {(
                [
                  ['off', tr('Off', 'Non')],
                  ['intro', tr('After the intro', 'Après l’intro')],
                  ['outro', tr('At the end', 'À la fin')]
                ] as const
              ).map(([v, l]) => (
                <button key={v} className={m.lobby === v ? 'is-on' : ''} onClick={() => update({ lobby: v })}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{tr('Zoom on kills', 'Zoom sur les kills')}</label>
            <div className="segmented">
              {(
                [
                  ['off', tr('Off', 'Non')],
                  ['soft', tr('Soft', 'Léger')],
                  ['strong', tr('Strong', 'Fort')]
                ] as const
              ).map(([v, l]) => (
                <button key={v} className={m.punch === v ? 'is-on' : ''} onClick={() => update({ punch: v })}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label>{tr('Highlights', 'Temps forts')}</label>
            <div className="row gap-8">
              <div className="segmented">
                {[1, 2, 3].map((n) => (
                  <button key={n} className={minKills === n ? 'is-on' : ''} onClick={() => setMinKills(n)}>
                    {n}K+
                  </button>
                ))}
              </div>
              <label className="toggle">
                <input type="checkbox" checked={clutches} onChange={(e) => setClutches(e.target.checked)} />
                <span />
                {tr('Clutches', 'Clutchs')}
              </label>
            </div>
          </div>

          <button className="btn btn-primary btn-block" disabled={!items.length || busy} onClick={exportRecap}>
            <Clapperboard size={15} />
            {busy
              ? tr('Preparing…', 'Préparation…')
              : items.length
                ? tr(`Export · ${items.length} highlights · ${fmtClipLen(length)}`, `Exporter · ${items.length} temps forts · ${fmtClipLen(length)}`)
                : tr('No highlights at this setting', 'Aucun temps fort avec ce réglage')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
