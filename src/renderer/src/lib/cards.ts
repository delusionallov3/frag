import type { CardAnim, CardLayer, CardStyle } from '@shared/types'
import { tr } from '@shared/i18n'

/**
 * Montage title cards.
 * Drawn here (real font, crisp shapes) on a 1920×1080 canvas, then handed to ffmpeg,
 * which overlays and animates them. The Montage window preview uses the exact same images.
 */

export const CARD_STYLES = (): { value: CardStyle; label: string; hint: string }[] => [
  { value: 'none', label: tr('None', 'Aucun'), hint: tr('No title card', 'Pas de carton') },
  { value: 'slab', label: tr('Slab', 'Plaque'), hint: tr('Slanted color banner sliding in from the left', 'Bandeau incliné en couleur, entre par la gauche') },
  { value: 'bar', label: tr('Bar', 'Barre'), hint: tr('Color stroke, title and info on two lines', 'Trait de couleur, titre et infos sur deux lignes') },
  { value: 'count', label: tr('Counter', 'Compteur'), hint: tr('Big clip number, top-10 style', 'Gros numéro du clip, façon top 10') },
  { value: 'cinema', label: tr('Cinema', 'Cinéma'), hint: tr('Letterbox bars and a centered title', 'Bandes noires et titre centré') },
  { value: 'hud', label: 'HUD', hint: tr('Map / agent tags that stay for the whole clip', 'Pastilles map / agent qui restent tout le clip') },
  { value: 'classic', label: tr('Classic', 'Classique'), hint: tr('The original card, bottom left', 'L’ancien carton, en bas à gauche') }
]

export const CARD_ACCENTS = ['#ff4655', '#f5c542', '#3ee0b0', '#5aa9ff', '#c58cff', '#f2f2f2']

export interface CardText {
  title: string
  sub: string
  index: number
  total: number
}

const FONT = '"Barlow Condensed"'
const INK = '#0d0f14'
/** how long a card stays on screen (s) */
const HOLD = 2.9

let fontsReady: Promise<unknown> | null = null
function loadFonts(): Promise<unknown> {
  fontsReady ??= Promise.all(
    ['500', '600', '800'].map((w) => document.fonts.load(`${w} 40px ${FONT}`))
  ).catch(() => undefined)
  return fontsReady
}

type Ctx = CanvasRenderingContext2D

function font(ctx: Ctx, weight: number, size: number, spacing = 0): void {
  ctx.font = `${weight} ${size}px ${FONT}`
  ctx.letterSpacing = `${spacing}px`
}

function measure(weight: number, size: number, spacing: number, text: string): number {
  const ctx = document.createElement('canvas').getContext('2d')!
  font(ctx, weight, size, spacing)
  // letter spacing is also added after the last letter: remove it
  return Math.ceil(ctx.measureText(text).width - spacing)
}

async function layer(
  w: number,
  h: number,
  draw: (ctx: Ctx) => void,
  pos: { x: number; y: number; anim: CardAnim; delay?: number; until?: number; center?: boolean }
): Promise<CardLayer> {
  const c = document.createElement('canvas')
  c.width = Math.ceil(w)
  c.height = Math.ceil(h)
  const ctx = c.getContext('2d')!
  ctx.textBaseline = 'alphabetic'
  draw(ctx)
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('PNG'))), 'image/png'))
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    w: c.width,
    h: c.height,
    center: pos.center,
    anim: pos.anim,
    delay: pos.delay ?? 0,
    until: pos.until ?? HOLD
  }
}

const upper = (s: string): string => s.toLocaleUpperCase('fr-FR')

/** margin around unboxed text so its shadow isn't clipped */
const M = 16

/** Short shadow under text drawn straight on the video (readable on bright scenes) */
function shade(ctx: Ctx): void {
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 2
}

/* ------------------------------------------------------------------ */

async function classic(t: CardText): Promise<CardLayer[]> {
  const text = t.sub ? `${t.title} · ${t.sub}` : t.title
  const size = 46
  const pad = 22
  const tw = measure(600, size, 0, text)
  const w = tw + pad * 2
  const h = size + pad * 1.6
  return [
    await layer(
      w,
      h,
      (ctx) => {
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(0, 0, w, h)
        font(ctx, 600, size)
        ctx.fillStyle = '#fff'
        ctx.fillText(text, pad, h / 2 + size * 0.35)
      },
      { x: 54, y: 1080 - 54 - h, anim: 'fade' }
    )
  ]
}

async function bar(t: CardText, accent: string): Promise<CardLayer[]> {
  const title = upper(t.title)
  const sub = upper(t.sub)
  const ts = 72
  const ss = 26
  const padX = 30
  const tw = measure(800, ts, 1, title)
  const sw = sub ? measure(600, ss, 5, sub) : 0
  const w = 10 + padX * 2 + Math.max(tw, sw)
  const h = sub ? 148 : 108
  return [
    await layer(
      w,
      h,
      (ctx) => {
        ctx.fillStyle = 'rgba(11,13,18,0.86)'
        ctx.fillRect(0, 0, w, h)
        ctx.fillStyle = accent
        ctx.fillRect(0, 0, 10, h)
        font(ctx, 800, ts, 1)
        ctx.fillStyle = '#fff'
        ctx.fillText(title, 10 + padX, 82)
        if (sub) {
          font(ctx, 600, ss, 5)
          ctx.fillStyle = '#b9bfcb'
          ctx.fillText(sub, 10 + padX, 124)
        }
      },
      { x: 72, y: 1080 - 84 - h, anim: 'slide' }
    )
  ]
}

async function slab(t: CardText, accent: string): Promise<CardLayer[]> {
  const title = upper(t.title)
  const sub = upper(t.sub)
  const ts = 92
  const th = 108
  const sk = Math.round(th * 0.25) // slant offset
  const tw = measure(800, ts, 0, title)
  const plateW = tw + 56 + sk
  const ss = 28
  const sh = 46
  const ssk = Math.round(sh * 0.25)
  const sw = sub ? measure(600, ss, 6, sub) + 40 + ssk : 0
  const subX = sk + 18
  const w = Math.max(plateW, subX + sw) + 2
  const h = th + (sub ? sh + 6 : 0)
  const para = (ctx: Ctx, x: number, y: number, pw: number, ph: number, s: number): void => {
    ctx.beginPath()
    ctx.moveTo(x + s, y)
    ctx.lineTo(x + pw, y)
    ctx.lineTo(x + pw - s, y + ph)
    ctx.lineTo(x, y + ph)
    ctx.closePath()
    ctx.fill()
  }
  return [
    await layer(
      w,
      h,
      (ctx) => {
        ctx.fillStyle = accent
        para(ctx, 0, 0, plateW, th, sk)
        font(ctx, 800, ts, 0)
        ctx.fillStyle = INK
        ctx.fillText(title, sk / 2 + 28, th / 2 + ts * 0.36)
        if (sub) {
          ctx.fillStyle = INK
          para(ctx, subX, th + 6, sw, sh, ssk)
          font(ctx, 600, ss, 6)
          ctx.fillStyle = '#fff'
          ctx.fillText(sub, subX + ssk / 2 + 20, th + 6 + sh / 2 + ss * 0.36)
        }
      },
      { x: 64, y: 84, anim: 'slide' }
    )
  ]
}

async function cinema(t: CardText): Promise<CardLayer[]> {
  const title = upper(t.title)
  const sub = upper(t.sub)
  const ts = 84
  const ss = 26
  const tw = measure(500, ts, 18, title)
  const sw = sub ? measure(600, ss, 10, sub) : 0
  const w = Math.max(tw, sw) + 40
  const h = sub ? 150 : 100
  const barH = 118
  const bars: CardLayer[] = [
    { x: 0, y: 0, w: 1920, h: barH, anim: 'barTop', delay: 0, until: HOLD + 0.4 },
    { x: 0, y: 1080 - barH, w: 1920, h: barH, anim: 'barBottom', delay: 0, until: HOLD + 0.4 }
  ]
  return [
    ...bars,
    await layer(
      w,
      h,
      (ctx) => {
        ctx.textAlign = 'center'
        shade(ctx)
        font(ctx, 500, ts, 18)
        ctx.fillStyle = '#fff'
        // letterSpacing shifts the center by half a letter
        ctx.fillText(title, w / 2 + 9, 80)
        if (sub) {
          font(ctx, 600, ss, 10)
          ctx.fillStyle = '#c3c7d0'
          ctx.fillText(sub, w / 2 + 5, 132)
        }
      },
      { x: 0, y: 1080 - barH - 60 - h, anim: 'fade', delay: 0.25, until: HOLD + 0.2, center: true }
    )
  ]
}

async function count(t: CardText, accent: string): Promise<CardLayer[]> {
  const num = String(t.index + 1).padStart(2, '0')
  const tot = `/ ${String(t.total).padStart(2, '0')}`
  const title = upper(t.title)
  const sub = upper(t.sub)
  const ns = 220
  const nw = measure(800, ns, 0, num)
  const ts = 60
  const tw = Math.max(measure(800, ts, 1, title), sub ? measure(600, 26, 5, sub) : 0, measure(600, 30, 4, tot))
  const gap = 26
  const w = nw + gap + tw + 12 + M * 2
  const h = 196 + M * 2
  return [
    await layer(
      w,
      h,
      (ctx) => {
        ctx.translate(M, M)
        shade(ctx)
        font(ctx, 800, ns, 0)
        ctx.lineWidth = 5
        ctx.strokeStyle = '#fff'
        ctx.lineJoin = 'round'
        ctx.strokeText(num, 4, 196 - 14)
        const x = nw + gap
        font(ctx, 600, 30, 4)
        ctx.fillStyle = accent
        ctx.fillText(tot, x, sub ? 74 : 106)
        font(ctx, 800, ts, 1)
        ctx.fillStyle = '#fff'
        ctx.fillText(title, x, sub ? 138 : 170)
        if (sub) {
          font(ctx, 600, 26, 5)
          ctx.fillStyle = '#c3c7d0'
          ctx.fillText(sub, x, 178)
        }
      },
      { x: 70 - M, y: 1080 - 70 - h + M, anim: 'rise' }
    )
  ]
}

async function hud(t: CardText, accent: string): Promise<CardLayer[]> {
  const tags = t.sub
    .split(/\s*[·|•\-—]\s*/)
    .map((s) => upper(s.trim()))
    .filter(Boolean)
  const out: CardLayer[] = []
  const ps = 24
  const pad = 14
  const ph = 42
  if (tags.length) {
    const widths = tags.map((s) => measure(600, ps, 4, s) + pad * 2)
    const w = widths.reduce((a, b) => a + b, 0) + 8 * (tags.length - 1)
    out.push(
      await layer(
        w,
        ph,
        (ctx) => {
          let x = 0
          tags.forEach((s, i) => {
            ctx.fillStyle = 'rgba(11,13,18,0.78)'
            ctx.fillRect(x, 0, widths[i], ph)
            ctx.fillStyle = i === 0 ? accent : 'rgba(255,255,255,0.22)'
            ctx.fillRect(x, 0, 3, ph)
            font(ctx, 600, ps, 4)
            ctx.fillStyle = '#fff'
            ctx.fillText(s, x + pad, ph / 2 + ps * 0.36)
            x += widths[i] + 8
          })
        },
        { x: 48, y: 44, anim: 'fade', until: -1 }
      )
    )
  }
  const title = upper(t.title)
  const ts = 64
  const tw = measure(800, ts, 1, title)
  out.push(
    await layer(
      tw + 4 + M * 2,
      ts + 22 + M * 2,
      (ctx) => {
        ctx.translate(M, M)
        shade(ctx)
        font(ctx, 800, ts, 1)
        ctx.fillStyle = '#fff'
        ctx.fillText(title, 0, ts * 0.92)
        ctx.fillStyle = accent
        ctx.fillRect(0, ts + 12, Math.min(tw, 140), 5)
      },
      { x: 48 - M, y: (tags.length ? 104 : 48) - M, anim: 'slide', delay: 0.2 }
    )
  )
  return out
}

export async function renderCard(style: CardStyle, text: CardText, accent: string): Promise<CardLayer[]> {
  if (style === 'none' || (!text.title.trim() && !text.sub.trim())) return []
  await loadFonts()
  const t = { ...text, title: text.title.trim(), sub: text.sub.trim() }
  switch (style) {
    case 'classic':
      return classic(t)
    case 'bar':
      return bar(t, accent)
    case 'slab':
      return slab(t, accent)
    case 'cinema':
      return cinema(t)
    case 'count':
      return count(t, accent)
    case 'hud':
      return hud(t, accent)
  }
}
