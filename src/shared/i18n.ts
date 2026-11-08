/**
 * Tiny i18n helper shared by the main process and the UI.
 * Frag ships in two languages, so strings live inline: tr('English', 'Français').
 */

export type Lang = 'en' | 'fr'

let current: Lang = 'en'

export function setLang(lang: Lang | null | undefined): void {
  current = lang === 'fr' ? 'fr' : 'en'
}

export function getLang(): Lang {
  return current
}

export function tr(en: string, fr: string): string {
  return current === 'fr' ? fr : en
}

/** Locale for dates and numbers */
export function locale(): string {
  return current === 'fr' ? 'fr-FR' : 'en-US'
}

/** 12.4 / 12,4 */
export function num(n: number, digits = 1): string {
  const s = n.toFixed(digits)
  return current === 'fr' ? s.replace('.', ',') : s
}

