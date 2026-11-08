import type { KeyboardLayout } from '@shared/types'
import { useApp } from '../store'

/**
 * Shortcuts are written for QWERTY. Letters work on any layout, but a few symbol keys
 * need Shift (or AltGr) on AZERTY, so AZERTY also accepts the key printed at the same spot.
 */
const AZERTY_ALIASES: Record<string, string> = {
  à: '0',
  ';': '.',
  '(': '[',
  ')': ']'
}

const AZERTY_CAPS: Record<string, string> = {
  '0': 'à',
  '.': ';',
  '[': '(',
  ']': ')'
}

const layout = (): KeyboardLayout => useApp.getState().settings?.keyboardLayout ?? 'qwerty'

/** The QWERTY key a keydown stands for */
export function shortcutKey(key: string): string {
  return layout() === 'azerty' ? (AZERTY_ALIASES[key] ?? key) : key
}

/** Label to print on a keycap for a QWERTY shortcut key */
export function keyCap(key: string): string {
  return layout() === 'azerty' ? (AZERTY_CAPS[key] ?? key) : key
}
