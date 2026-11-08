import type { MatchCandidate } from './types'
import { tr } from './i18n'

/** Coverage threshold: a recording must cover at least a quarter of the match to be linked automatically */
export const MIN_COVERAGE = 0.25

export function fmtMinutes(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s ? `${m} min ${String(s).padStart(2, '0')}` : `${m} min`
}

/**
 * Can this recording be linked to this match without asking?
 * Keeps test recordings (a few seconds during a game) from being linked by mistake.
 */
export function autoLinkVerdict(c: MatchCandidate | undefined, minMinutes: number): { ok: boolean; reason: string | null } {
  if (!c) return { ok: false, reason: null }
  if (c.recSeconds < minMinutes * 60) {
    return {
      ok: false,
      reason: tr(
        `Short recording (${fmtMinutes(c.recSeconds)}): not linked automatically. If it really is a game, pick it below.`,
        `Rec courte (${fmtMinutes(c.recSeconds)}) : pas liée toute seule. Si c'est bien une game, choisis-la ci-dessous.`
      )
    }
  }
  if (c.overlap < 0.5) return { ok: false, reason: null }
  if (c.coverage < MIN_COVERAGE) {
    return {
      ok: false,
      reason: tr(
        `This recording only covers ${Math.round(c.coverage * 100)}% of the match: not linked automatically. Pick it below if it’s the right one.`,
        `Cette rec ne filme que ${Math.round(c.coverage * 100)} % du match : pas liée toute seule. Choisis-le ci-dessous si c'est le bon.`
      )
    }
  }
  return { ok: true, reason: null }
}
