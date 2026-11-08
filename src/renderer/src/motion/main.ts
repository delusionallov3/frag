/**
 * Frag's motion layer. Three styles (clean, broadcast, kinetic), four scenes:
 *   intro  the match card (map, result, agent, rank, stats). Opaque.
 *   lobby  the scoreboard: all ten players with agent, rank, K/D/A and ACS. Opaque.
 *   wipe   the transition that hides the cut between two clips, naming the next highlight. Transparent.
 *   lower  the highlight's label and the round's score over a clip. Transparent.
 *
 * Drawn one frame at a time: setup() builds a scene, render(t) poses it at t seconds. Nothing runs on a
 * clock, so an export is identical frame for frame. Two drivers:
 *   the export (src/main/motion.ts) calls window.setup / window.render in an offscreen window;
 *   the live preview in the recap window (RecapModal) sends the same calls through postMessage.
 * Scenes are laid out at 1920×1080 and scaled to the output size.
 */
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-800.css'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './motion.css'
import type { MotionHighlight, MotionIntro, MotionOptions, MotionPlayer, MotionStyle } from '@shared/types'

export type Scene = 'intro' | 'lobby' | 'wipe' | 'lower'
export interface SetupArgs {
  scene: Scene
  width: number
  height: number
  opts: MotionOptions
  intro?: MotionIntro | null
  highlight?: MotionHighlight | null
  /** how long the scene stays on screen (s) */
  duration: number
  lang: 'en' | 'fr'
}

declare global {
  interface Window {
    setup: (a: SetupArgs) => Promise<void>
    render: (t: number) => void
  }
}

const asset = (u?: string | null): string => (u ? `frag-media://asset/?u=${encodeURIComponent(u)}` : '')
const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v))
const prog = (t: number, start: number, dur: number): number => clamp((t - start) / dur)
const outExpo = (u: number): number => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u))
const outQuart = (u: number): number => 1 - Math.pow(1 - u, 4)
const inOutQuart = (u: number): number => (u < 0.5 ? 8 * u ** 4 : 1 - Math.pow(-2 * u + 2, 4) / 2)
const esc = (s: string | number | null | undefined): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
/** in, hold, out: 0 → 1 → 0 over the scene */
const life = (t: number, inAt: number, inDur: number, outAt: number, outDur: number): number =>
  outExpo(prog(t, inAt, inDur)) * (1 - inOutQuart(prog(t, outAt, outDur)))

const stage = document.getElementById('stage') as HTMLDivElement
let draw: (t: number) => void = () => {}

const $ = (sel: string): HTMLElement | null => stage.querySelector(sel)
const $$ = (sel: string): HTMLElement[] => [...stage.querySelectorAll<HTMLElement>(sel)]
const set = (el: HTMLElement | null, o: number, tf: string): void => {
  if (!el) return
  el.style.opacity = String(o)
  el.style.transform = tf
}

/** dark or light ink for text on the accent */
function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#0f0f10'
  const n = parseInt(m[1], 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.3 ? '#0f0f10' : '#ededed'
}

const words = (lang: 'en' | 'fr') =>
  lang === 'fr'
    ? { recap: 'Résumé de match', win: 'Victoire', loss: 'Défaite', draw: 'Égalité', round: 'Round', us: 'Ton équipe', them: 'Adversaires' }
    : { recap: 'Match recap', win: 'Victory', loss: 'Defeat', draw: 'Draw', round: 'Round', us: 'Your team', them: 'Enemy team' }

function fmtDate(ms: number, lang: 'en' | 'fr'): string {
  return new Date(ms).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function statList(m: MotionIntro): [string, string][] {
  const s: [string, string][] = [['K/D/A', m.kda]]
  if (m.acs != null) s.push(['ACS', String(m.acs)])
  if (m.adr != null) s.push(['ADR', String(m.adr)])
  if (m.hs != null) s.push(['HS', `${m.hs}%`])
  return s
}

const result = (m: MotionIntro, w: ReturnType<typeof words>): string => (m.us > m.them ? w.win : m.us < m.them ? w.loss : w.draw)

/* ================================================================== intro */

function introBroadcast(m: MotionIntro, w: ReturnType<typeof words>): void {
  const meta = [m.mode, fmtDate(m.date, m.lang), m.agent].filter(Boolean).join(' · ')
  stage.innerHTML = `
    <div class="bg">${m.splash ? `<img src="${asset(m.splash)}" alt="">` : ''}</div>
    ${m.portrait ? `<img class="agent" src="${asset(m.portrait)}" alt="">` : ''}
    <div class="panel"></div><div class="stripe"></div>
    <div class="txt">
      <div class="tag"><span>${esc(w.recap)}</span></div>
      <h1 class="map">${[...m.map.toUpperCase()].map((c) => `<span><i>${esc(c)}</i></span>`).join('')}</h1>
      <div class="meta">${esc(meta)}${m.tier ? `<span class="tier">${m.rankIcon ? `<img src="${asset(m.rankIcon)}" alt="">` : ''}${esc(m.tier)}</span>` : ''}</div>
      <div class="res"><em>${esc(result(m, w))}</em><b>${m.us}</b><i></i><b class="dim">${m.them}</b></div>
      <div class="stats">${statList(m).map(([k, v]) => `<div><em>${k}</em><b>${esc(v)}</b></div>`).join('')}</div>
    </div>`
  draw = (t) => {
    set($('.bg'), 1, `scale(${1.1 - 0.1 * outQuart(prog(t, 0, 4.6))})`)
    const ua = outExpo(prog(t, 0.2, 0.75))
    set($('.agent'), ua, `translateX(${(1 - ua) * 180}px)`)
    set($('.panel'), 1, `skewX(-12deg) translateX(${(1 - outQuart(prog(t, 0, 0.45))) * -110}%)`)
    set($('.stripe'), 1, `skewX(-12deg) translateX(${(1 - outQuart(prog(t, 0.07, 0.45))) * -2200}px)`)
    const tag = $('.tag span')
    if (tag) tag.style.clipPath = `inset(0 ${(1 - outQuart(prog(t, 0.42, 0.3))) * 100}% 0 0)`
    $$('.map i').forEach((el, i) => (el.style.transform = `translateY(${(1 - outExpo(prog(t, 0.5 + i * 0.035, 0.55))) * 105}%)`))
    const um = outQuart(prog(t, 0.85, 0.4))
    set($('.meta'), um, `translateX(${(1 - um) * -30}px)`)
    const ur = outExpo(prog(t, 1.0, 0.5))
    set($('.res'), ur, `translateY(${(1 - ur) * 40}px)`)
    $$('.stats > div').forEach((el, i) => {
      const u = outExpo(prog(t, 1.25 + i * 0.08, 0.45))
      set(el, u, `translateY(${(1 - u) * 26}px)`)
    })
  }
}

function introClean(m: MotionIntro, w: ReturnType<typeof words>): void {
  const meta = [m.mode, fmtDate(m.date, m.lang), m.agent].filter(Boolean).join(' · ')
  stage.innerHTML = `
    <div class="bg">${m.splash ? `<img src="${asset(m.splash)}" alt="">` : ''}</div>
    <div class="veil"></div>
    ${m.portrait ? `<img class="agent" src="${asset(m.portrait)}" alt="">` : ''}
    <div class="txt">
      <div class="meta">${esc(meta)}</div>
      <h1 class="map"><span><i>${esc(m.map)}</i></span></h1>
      <div class="res"><em>${esc(result(m, w))}</em><b>${m.us}<u>–</u>${m.them}</b></div>
      <div class="stats">${m.tier ? `<div class="rank"><em>Rank</em><b>${m.rankIcon ? `<img src="${asset(m.rankIcon)}" alt="">` : ''}${esc(m.tier)}</b></div>` : ''}${statList(m).map(([k, v]) => `<div><em>${k}</em><b>${esc(v)}</b></div>`).join('')}</div>
    </div>`
  draw = (t) => {
    set($('.bg'), outQuart(prog(t, 0, 0.6)), `scale(${1.08 - 0.08 * outQuart(prog(t, 0, 4.6))})`)
    const ua = outExpo(prog(t, 0.3, 1))
    set($('.agent'), ua, `translateX(${(1 - ua) * 60}px)`)
    const u0 = outQuart(prog(t, 0.3, 0.5))
    set($('.meta'), u0, `translateY(${(1 - u0) * 12}px)`)
    const i = $('.map i')
    if (i) i.style.transform = `translateY(${(1 - outExpo(prog(t, 0.45, 0.8))) * 102}%)`
    const ur = outQuart(prog(t, 0.95, 0.6))
    set($('.res'), ur, `translateY(${(1 - ur) * 16}px)`)
    $$('.stats > div').forEach((el, k) => {
      const u = outQuart(prog(t, 1.2 + k * 0.09, 0.6))
      set(el, u, `translateY(${(1 - u) * 16}px)`)
    })
  }
}

function introKinetic(m: MotionIntro, w: ReturnType<typeof words>): void {
  const name = m.map.toUpperCase()
  const meta = [m.mode, fmtDate(m.date, m.lang), m.agent, m.tier, m.kda].filter(Boolean).join('  ·  ')
  stage.innerHTML = `
    <div class="bg">${m.splash ? `<img src="${asset(m.splash)}" alt="">` : ''}</div>
    <div class="big a">${esc(name)}</div><div class="big b">${esc(name)}</div>
    <div class="band"><b>${m.us}–${m.them}</b><em>${esc(result(m, w))}</em><span>${esc(meta.toUpperCase())}</span>${m.rankIcon ? `<img src="${asset(m.rankIcon)}" alt="">` : ''}</div>`
  draw = (t) => {
    set($('.bg'), outQuart(prog(t, 0, 0.5)), `scale(${1.12 - 0.06 * prog(t, 0, 4.6)})`)
    const ua = outExpo(prog(t, 0, 0.7))
    set($('.big.a'), 1, `translateX(${(1 - ua) * 1400 - t * 60}px)`)
    const ub = outExpo(prog(t, 0.15, 0.8))
    set($('.big.b'), 1, `translateX(${(1 - ub) * -1600 + t * 90}px)`)
    const band = $('.band')
    if (band) band.style.clipPath = `inset(0 ${(1 - outExpo(prog(t, 0.6, 0.6))) * 100}% 0 0)`
  }
}

/* ================================================================== lobby: all ten players */

function lobbyScene(m: MotionIntro, opts: MotionOptions, w: ReturnType<typeof words>): void {
  const row = (p: MotionPlayer): string => `
    <div class="lr${p.me ? ' me' : ''}">
      <span class="ag">${p.agentIcon ? `<img src="${asset(p.agentIcon)}" alt="">` : ''}</span>
      <span class="nm"><b>${esc(opts.names ? p.name : p.agent)}</b>${opts.names ? `<small>${esc(p.agent)}</small>` : ''}</span>
      <span class="rk">${p.rankIcon ? `<img src="${asset(p.rankIcon)}" alt="">` : ''}<em>${esc(p.tier ?? '–')}</em></span>
      <span class="kda">${p.k}/${p.d}/${p.a}</span>
      <span class="acs">${p.acs}</span>
    </div>`
  const team = (side: 'us' | 'them'): string =>
    m.players
      .filter((p) => p.team === side)
      .sort((a, b) => b.acs - a.acs)
      .map(row)
      .join('')
  stage.innerHTML = `
    <div class="bg">${m.splash ? `<img src="${asset(m.splash)}" alt="">` : ''}</div>
    <div class="shade"></div>
    <div class="lb">
      <div class="lh"><b class="mp">${esc(opts.style === 'clean' ? m.map : m.map.toUpperCase())}</b><span class="sc"><b>${m.us}</b><i></i><b class="dim">${m.them}</b></span><em>${esc([m.mode, fmtDate(m.date, m.lang)].join(' · '))}</em></div>
      <div class="cols">
        <div class="col us"><div class="th"><span>${esc(w.us)}</span><span>K/D/A</span><span>ACS</span></div>${team('us')}</div>
        <div class="col them"><div class="th"><span>${esc(w.them)}</span><span>K/D/A</span><span>ACS</span></div>${team('them')}</div>
      </div>
    </div>`
  draw = (t) => {
    set($('.bg'), outQuart(prog(t, 0, 0.5)), `scale(${1.08 - 0.05 * prog(t, 0, 6)})`)
    const uh = outExpo(prog(t, 0.1, 0.6))
    set($('.lh'), uh, `translateY(${(1 - uh) * -30}px)`)
    $$('.col').forEach((col, c) => {
      const th = col.querySelector<HTMLElement>('.th')
      const ut = outQuart(prog(t, 0.3 + c * 0.1, 0.5))
      set(th, ut, `translateY(${(1 - ut) * 14}px)`)
      ;[...col.querySelectorAll<HTMLElement>('.lr')].forEach((r, i) => {
        const u = outExpo(prog(t, 0.45 + c * 0.12 + i * 0.07, 0.55))
        set(r, u, `translateX(${(1 - u) * (c ? 60 : -60)}px)`)
      })
    })
  }
}

/* ================================================================== wipe */

function wipeScene(style: MotionStyle, h: MotionHighlight | null | undefined, show: boolean, w: ReturnType<typeof words>): void {
  const lab = show && h
  if (style === 'clean') {
    stage.innerHTML = `<div class="shut"><i></i></div>${lab ? `<div class="lab"><small>${esc(w.round)} ${h.round}${h.clutch ? ` · ${esc(h.clutch)}` : ''}</small><b>${esc(h.label === 'ACE' ? 'Ace' : h.label)}</b></div>` : ''}`
    // a dark shutter crosses left to right; fully closed from 0.36 to 0.54 s (the cut is at 0.45 s)
    draw = (t) => {
      const x = t < 0.45 ? -100 + 100 * inOutQuart(prog(t, 0, 0.36)) : 100 * inOutQuart(prog(t, 0.54, 0.36))
      set($('.shut'), 1, `translateX(${x}%)`)
      const u = outQuart(prog(t, 0.22, 0.25)) * (1 - inOutQuart(prog(t, 0.52, 0.22)))
      set($('.lab'), u, `translateY(${(1 - u) * 14}px)`)
    }
    return
  }
  if (style === 'kinetic') {
    stage.innerHTML = `<div class="slab"></div>${[150, 290, 440, 610, 760, 900].map((y, i) => `<i class="ln" style="top:${y}px;--d:${i % 3}"></i>`).join('')}${lab ? `<div class="num"><b>${h.round}</b><span>${esc(h.label)}${h.clutch ? `<small>${esc(h.clutch)}</small>` : ''}</span></div>` : ''}`
    draw = (t) => {
      const x = t < 0.45 ? -130 + 130 * inOutQuart(prog(t, 0, 0.36)) : 130 * inOutQuart(prog(t, 0.54, 0.36))
      set($('.slab'), 1, `translateX(${x}%)`)
      $$('.ln').forEach((l, i) => {
        const u = prog(t, 0.05 + i * 0.03, 0.5)
        set(l, Math.sin(u * Math.PI), `translateX(${-120 + 240 * u}%)`)
      })
      const un = outExpo(prog(t, 0.2, 0.3)) * (1 - inOutQuart(prog(t, 0.55, 0.25)))
      set($('.num'), un, `translateX(${(1 - un) * 200}px)`)
    }
    return
  }
  stage.innerHTML = `<div class="dark"></div><div class="red"></div>${lab ? `<div class="lab"><small>${esc(w.round)} ${h.round}</small><b>${esc(h.label)}</b>${h.clutch ? `<em>${esc(h.clutch)}</em>` : ''}</div>` : ''}`
  const pos = (t: number, delay: number): number =>
    t < 0.45 ? -2900 + 2900 * inOutQuart(prog(t, delay, 0.36)) : 2600 * inOutQuart(prog(t, 0.54 + delay * 0.5, 0.36))
  draw = (t) => {
    set($('.red'), 1, `translateX(${pos(t, 0)}px) skewX(-14deg)`)
    set($('.dark'), 1, `translateX(${pos(t, 0.05) - (t < 0.45 ? 120 : -120)}px) skewX(-14deg)`)
    const inU = outExpo(prog(t, 0.24, 0.3))
    const outU = inOutQuart(prog(t, 0.56, 0.3))
    set($('.lab'), Math.min(inU * 1.4, 1), `translateX(${(1 - inU) * -260 + outU * 1500}px)`)
  }
}

/* ================================================================== lower third + score bug */

function lowerScene(style: MotionStyle, h: MotionHighlight, opts: MotionOptions, d: number, w: ReturnType<typeof words>): void {
  const [us, them] = h.score.split(/[–-]/)
  const enter = Math.max(0.35, Math.min(h.kills.length ? Math.max(...h.kills) - 0.4 : 0.6, d - 2.2))
  const leave = d - 0.45
  const sub = [h.weapon, `${w.round} ${h.round}`].filter(Boolean).join(' · ')
  const icon = h.weaponIcon ? `<img src="${asset(h.weaponIcon)}" alt="">` : ''
  let bug = ''
  let label = ''
  if (style === 'clean') {
    bug = `<div class="bug"><span>${esc(w.round)} ${h.round}</span><b>${esc(us)}<u>–</u>${esc(them)}</b></div>`
    label = `<div class="lt"><b class="k">${esc(h.label)}</b><span><b>${esc(h.clutch ?? sub)}</b><em>${esc(h.clutch ? sub : '')}</em></span></div>`
  } else if (style === 'kinetic') {
    bug = `<div class="bug">R${String(h.round).padStart(2, '0')} <u>/</u> ${esc(us)}:${esc(them)}</div>`
    label = `<div class="lt"><b class="k"><i>${esc(h.label)}</i></b><span>${icon}${esc([sub, h.clutch].filter(Boolean).join(' · ').toUpperCase())}</span></div>`
  } else {
    bug = `<div class="bug"><span class="r">R${h.round}</span><span class="s"><b>${esc(us)}</b><i></i><b class="dim">${esc(them)}</b></span></div>`
    label = `<div class="lt"><div class="slab"><b>${esc(h.label)}</b></div><div class="bar">${icon}<span>${esc([sub, h.clutch].filter(Boolean).join(' · '))}</span></div></div>`
  }
  stage.innerHTML = `${opts.scoreBug ? bug : ''}${opts.lowerThirds ? label : ''}`
  draw = (t) => {
    const ub = life(t, 0.2, 0.45, leave, 0.35)
    const bugEl = $('.bug')
    if (bugEl) set(bugEl, ub, style === 'broadcast' ? `translateX(-50%) translateY(${(1 - ub) * -40}px)` : `translateY(${(1 - ub) * -16}px)`)
    const lt = $('.lt')
    if (!lt) return
    const u = outExpo(prog(t, enter, 0.55))
    const o = inOutQuart(prog(t, leave, 0.35))
    if (style === 'clean') {
      set(lt, u * (1 - o), `translateY(${(1 - u) * 20 + o * 10}px)`)
    } else if (style === 'kinetic') {
      const k = lt.querySelector<HTMLElement>('.k i')
      if (k) k.style.transform = `translateY(${(1 - u) * 105 + o * 105}%)`
      const sp = lt.querySelector<HTMLElement>('span')
      const us2 = outQuart(prog(t, enter + 0.15, 0.4))
      set(sp, us2 * (1 - o), `translateX(${(1 - us2) * -40}px)`)
    } else {
      set(lt.querySelector('.slab'), 1, `skewX(-10deg) translateX(${(1 - u) * -120 - o * 120}%)`)
      const u2 = outExpo(prog(t, enter + 0.12, 0.5))
      set(lt.querySelector('.bar'), 1, `translateX(${(1 - u2) * -110 - o * 120}%)`)
    }
  }
}

/* ================================================================== setup / render */

window.setup = async (a: SetupArgs): Promise<void> => {
  const style = a.opts.style
  const root = document.documentElement
  root.style.setProperty('--k', String(a.height / 1080))
  root.style.setProperty('--acc', a.opts.accent)
  root.style.setProperty('--acc-ink', inkOn(a.opts.accent))
  root.classList.toggle('ink-dark', inkOn(a.opts.accent) === '#0f0f10')
  document.body.style.width = `${a.width}px`
  document.body.style.height = `${a.height}px`
  const w = words(a.lang)
  stage.className = `st-${style} sc-${a.scene}`
  draw = () => {}
  stage.innerHTML = ''
  if (a.scene === 'intro' && a.intro) {
    if (style === 'clean') introClean(a.intro, w)
    else if (style === 'kinetic') introKinetic(a.intro, w)
    else introBroadcast(a.intro, w)
  } else if (a.scene === 'lobby' && a.intro) lobbyScene(a.intro, a.opts, w)
  else if (a.scene === 'wipe') wipeScene(style, a.highlight, a.opts.wipeLabels, w)
  else if (a.scene === 'lower' && a.highlight) lowerScene(style, a.highlight, a.opts, a.duration, w)
  await document.fonts.ready
  await Promise.all(
    [...stage.querySelectorAll('img')].map((img) =>
      img.complete ? undefined : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => { img.remove(); r() } })
    )
  )
  draw(0)
}

window.render = (t: number): void => draw(t)

/* the live preview drives the page through postMessage (it runs in an iframe of the app) */
window.addEventListener('message', (e) => {
  const d = e.data as { type?: string; args?: SetupArgs; t?: number; id?: number }
  if (d?.type === 'setup' && d.args) void window.setup(d.args).then(() => (e.source as Window | null)?.postMessage({ type: 'ready', id: d.id }, '*'))
  else if (d?.type === 'render' && typeof d.t === 'number') window.render(d.t)
})
