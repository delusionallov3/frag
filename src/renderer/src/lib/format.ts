import { locale, num, tr } from '@shared/i18n'

export const mediaUrl = (path: string): string => `frag-media://local/?p=${encodeURIComponent(path)}`

export function joinPath(dir: string, file: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.endsWith(sep) ? dir + file : dir + sep + file
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

const pad = (n: number, w = 2): string => String(Math.floor(n)).padStart(w, '0')

/** 1:02:03 or 12:03 */
export function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** 12:03.45 (hundredths) */
export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const cs = Math.floor((sec % 1) * 100)
  return (h > 0 ? `${h}:${pad(m)}` : pad(m)) + `:${pad(s)}.${pad(cs)}`
}

/** Short clip length: 12.4 s / 1:05 */
export function fmtClipLen(sec: number): string {
  if (sec < 60) return `${num(sec)} s`
  return fmtDuration(sec)
}

export function fmtSize(bytes: number): string {
  if (bytes >= 1e9) return `${num(bytes / 1e9)} ${tr('GB', 'Go')}`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} ${tr('MB', 'Mo')}`
  return `${Math.max(1, Math.round(bytes / 1e3))} ${tr('KB', 'Ko')}`
}

const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function dayLabel(ms: number): string {
  const d = new Date(ms)
  const today = dayStart(new Date())
  const diff = Math.round((today - dayStart(d)) / 86400000)
  if (diff === 0) return tr('Today', 'Aujourd’hui')
  if (diff === 1) return tr('Yesterday', 'Hier')
  if (diff < 7) return d.toLocaleDateString(locale(), { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase())
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: diff > 300 ? 'numeric' : undefined })
}

export function dayKey(ms: number): number {
  return dayStart(new Date(ms))
}

export function hourLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
}

export const uid = (): string => Math.random().toString(36).slice(2, 10)
