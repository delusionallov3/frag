/**
 * Frag's motion layer, "Broadcast" style. Drawn in an offscreen window by the main process
 * (src/main/motion.ts) one frame at a time: setup() loads a scene and its images, render(t) poses it
 * at t seconds. Nothing here runs on a clock, so every export is identical frame for frame.
 *
 * Scenes are laid out at 1920×1080 and scaled to the export size.
 *   intro: the match card (map, score, agent, rank, stats). Opaque.
 *   wipe:  the red diagonal wipe that hides the cut between two clips, with the next round's label. Transparent.
 *   lower: the highlight's lower third and score bug; its count pops on each kill. Transparent.
 */
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/barlow-condensed/latin-800.css'
import '@fontsource-variable/geist'
import './motion.css'
import type { MotionHighlight, MotionIntro } from '@shared/types'

type Scene = 'intro' | 'wipe' | 'lower'
interface SetupArgs {
  scene: Scene
  width: number
  height: number
  intro?: MotionIntro
  highlight?: MotionHighlight
  /** lower third: how long it stays on screen (s) */
  duration?: number
  lang?: 'en' | 'fr'
}

declare global {
  interface Window {
    setup: (a: SetupArgs) => Promise<void>
    render: (t: number) => void
  }
}

const asset = (u?: string | null): string => (u ? `frag-media://asset/?u=${encodeURIComponent(u)}` : '')
const clamp = (v: number, a = 0, b = 1): number => Math.min(b, Math.max(a, v))
/** progress of t through [start, start + dur], eased */
const prog = (t: number, start: number, dur: number): number => clamp((t - start) / dur)
const outExpo = (u: number): number => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u))
const outQuart = (u: number): number => 1 - Math.pow(1 - u, 4)
const inOutQuart = (u: number): number => (u < 0.5 ? 8 * u ** 4 : 1 - Math.pow(-2 * u + 2, 4) / 2)
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

const stage = document.getElementById('stage') as HTMLDivElement
let draw: (t: number) => void = () => {}

function waitImages(): Promise<void> {
  const imgs = [...stage.querySelectorAll('img')]
  return Promise.all(
    imgs.map((img) => (img.complete ? Promise.resolve() : new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => { img.remove(); r() } })))
  ).then(() => undefined)
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => stage.querySelector(sel) as T
const $$ = <T extends HTMLElement = HTMLElement>(sel: string): T[] => [...stage.querySelectorAll(sel)] as T[]

/* ------------------------------------------------------------------ intro */
function introScene(m: MotionIntro): void {
  const fr = m.lang === 'fr'
  const won = m.us > m.them
  const date = new Date(m.date).toLocaleDateString(fr ? 'fr-FR' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const meta = [m.mode, date, m.agent, m.tier].filter(Boolean).join(' · ')
  const stats: [string, string][] = [['K/D/A', m.kda]]
  if (m.acs != null) stats.push(['ACS', String(m.acs)])
  if (m.adr != null) stats.push(['ADR', String(m.adr)])
  if (m.hs != null) stats.push(['HS%', String(m.hs)])
  stage.className = 'intro'
  stage.innerHTML = `
    <div class="i-bg">${m.splash ? `<img src="${asset(m.splash)}" alt="">` : ''}</div>
    ${m.portrait ? `<img class="i-agent" src="${asset(m.portrait)}" alt="">` : ''}
    <div class="i-panel"></div><div class="i-stripe"></div>
    ${m.rankIcon ? `<img class="i-rank" src="${asset(m.rankIcon)}" alt="">` : ''}
    <div class="i-text">
      <div class="i-tag"><span>${fr ? 'Résumé de match' : 'Match recap'}</span></div>
      <h1 class="i-map">${[...m.map.toUpperCase()].map((c) => `<span><i>${esc(c)}</i></span>`).join('')}</h1>
      <div class="i-meta">${esc(meta)}</div>
      <div class="i-score"><span class="${won ? 'w' : 'l'}">${m.us}</span><u>—</u><span>${m.them}</span></div>
      <div class="i-stats">${stats.map(([k, v]) => `<div><em>${k}</em><b>${esc(v)}</b></div>`).join('')}</div>
    </div>`
  draw = (t) => {
    const bg = $('.i-bg')
    bg.style.transform = `scale(${1.1 - 0.1 * outQuart(prog(t, 0, 4.6))})`
    const ag = stage.querySelector<HTMLElement>('.i-agent')
    if (ag) {
      const u = outExpo(prog(t, 0.2, 0.75))
      ag.style.transform = `translateX(${(1 - u) * 180}px)`
      ag.style.opacity = String(u)
    }
    $('.i-panel').style.transform = `skewX(-12deg) translateX(${(1 - outQuart(prog(t, 0, 0.45))) * -110}%)`
    $('.i-stripe').style.transform = `skewX(-12deg) translateX(${(1 - outQuart(prog(t, 0.07, 0.45))) * -2200}px)`
    const rk = stage.querySelector<HTMLElement>('.i-rank')
    if (rk) {
      const u = outExpo(prog(t, 1.0, 0.5))
      rk.style.opacity = String(u)
      rk.style.transform = `scale(${0.7 + 0.3 * u})`
    }
    $('.i-tag span').style.clipPath = `inset(0 ${(1 - outQuart(prog(t, 0.42, 0.3))) * 100}% 0 0)`
    $$('.i-map i').forEach((el, i) => {
      el.style.transform = `translateY(${(1 - outExpo(prog(t, 0.5 + i * 0.035, 0.55))) * 105}%)`
    })
    const meta = $('.i-meta')
    const um = outQuart(prog(t, 0.85, 0.4))
    meta.style.opacity = String(um)
    meta.style.transform = `translateX(${(1 - um) * -30}px)`
    const sc = $('.i-score')
    const us = outExpo(prog(t, 1.0, 0.5))
    sc.style.opacity = String(us)
    sc.style.transform = `translateY(${(1 - us) * 40}px)`
    $$('.i-stats > div').forEach((el, i) => {
      const u = outExpo(prog(t, 1.25 + i * 0.08, 0.45))
      el.style.opacity = String(u)
      el.style.transform = `translateY(${(1 - u) * 26}px)`
    })
  }
}

/* ------------------------------------------------------------------ wipe */
function wipeScene(h: MotionHighlight | undefined, lang: 'en' | 'fr'): void {
  const fr = lang === 'fr'
  stage.className = 'wipe'
  stage.innerHTML = `
    <div class="w-dark"></div><div class="w-red"></div>
    ${h ? `<div class="w-lab"><small>${fr ? 'Round' : 'Round'} ${h.round}</small><b>${esc(h.label)}</b>${h.clutch ? `<em>${esc(h.clutch)}</em>` : ''}</div>` : ''}`
  // the panels cover the whole frame from 0.36 to 0.54 s; the cut sits at 0.45 s
  const pos = (t: number, delay: number): number => {
    if (t < 0.45) return -2900 + 2900 * inOutQuart(prog(t, delay, 0.36))
    return 2600 * inOutQuart(prog(t, 0.54 + delay * 0.5, 0.36))
  }
  draw = (t) => {
    $('.w-red').style.transform = `translateX(${pos(t, 0)}px) skewX(-14deg)`
    $('.w-dark').style.transform = `translateX(${pos(t, 0.05) - (t < 0.45 ? 120 : -120)}px) skewX(-14deg)`
    const lab = stage.querySelector<HTMLElement>('.w-lab')
    if (lab) {
      const inU = outExpo(prog(t, 0.24, 0.3))
      const outU = inOutQuart(prog(t, 0.56, 0.3))
      lab.style.transform = `translateX(${(1 - inU) * -260 + outU * 1500}px)`
      lab.style.opacity = String(Math.min(inU * 1.4, 1))
    }
  }
}

/* ------------------------------------------------------------------ lower third */
function lowerScene(h: MotionHighlight, duration: number, lang: 'en' | 'fr'): void {
  const fr = lang === 'fr'
  const [us, them] = h.score.split(/[–-]/)
  const enter = Math.max(0.35, Math.min(h.kills[0] ?? 0.6, duration - 1.2))
  const leave = duration - 0.4
  const bar = [h.weapon, `${fr ? 'Round' : 'Round'} ${h.round}`, h.clutch].filter(Boolean).join(' · ')
  stage.className = 'lower'
  stage.innerHTML = `
    <div class="l-bug"><span class="a">${esc(us ?? '')}</span><span class="r">R${h.round}</span><span class="b">${esc(them ?? '')}</span></div>
    <div class="l-box">
      <div class="l-slab"><b>${esc(h.label)}</b></div>
      <div class="l-bar">${h.weaponIcon ? `<img src="${asset(h.weaponIcon)}" alt="">` : ''}<span>${esc(bar)}</span></div>
    </div>`
  const total = h.kills.length
  draw = (t) => {
    const bug = $('.l-bug')
    const ub = outExpo(prog(t, 0.2, 0.45)) * (1 - inOutQuart(prog(t, leave, 0.35)))
    bug.style.opacity = String(ub)
    bug.style.transform = `translateX(-50%) translateY(${(1 - ub) * -50}px)`
    const slab = $('.l-slab')
    const uIn = outExpo(prog(t, enter, 0.5))
    const uOut = inOutQuart(prog(t, leave, 0.35))
    slab.style.transform = `skewX(-10deg) translateX(${((1 - uIn) * -120 - uOut * 120)}%)`
    const barEl = $('.l-bar')
    const ub2 = outExpo(prog(t, enter + 0.12, 0.5))
    barEl.style.transform = `translateX(${(1 - ub2) * -110 - uOut * 120}%)`
    // the count follows the kills: 1K, 2K… then the final label; each kill pops it
    const done = h.kills.filter((k) => k <= t).length
    const shown = done >= total ? h.label : `${Math.max(1, done)}K`
    const b = slab.querySelector('b') as HTMLElement
    if (b.textContent !== shown) b.textContent = shown
    const lastKill = [...h.kills].reverse().find((k) => k <= t)
    const pop = lastKill == null ? 0 : 1 - outQuart(prog(t, lastKill, 0.32))
    b.style.transform = `scale(${1 + 0.22 * pop})`
    slab.style.background = pop > 0.6 ? '#ffffff' : '#ff4655'
  }
}

window.setup = async (a: SetupArgs): Promise<void> => {
  document.documentElement.style.setProperty('--k', String(a.height / 1080))
  document.body.style.width = `${a.width}px`
  document.body.style.height = `${a.height}px`
  const lang = a.lang ?? a.intro?.lang ?? 'en'
  if (a.scene === 'intro' && a.intro) introScene(a.intro)
  else if (a.scene === 'wipe') wipeScene(a.highlight, lang)
  else if (a.scene === 'lower' && a.highlight) lowerScene(a.highlight, a.duration ?? 4, lang)
  else { stage.className = ''; stage.innerHTML = ''; draw = () => {} }
  await document.fonts.ready
  await waitImages()
  draw(0)
}

window.render = (t: number): void => draw(t)
