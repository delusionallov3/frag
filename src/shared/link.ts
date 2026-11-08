import type { MatchCandidate } from './types'

/** Seuil de couverture : la rec doit filmer au moins un quart du match pour être liée toute seule */
export const MIN_COVERAGE = 0.25

export function fmtMinutes(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s ? `${m} min ${String(s).padStart(2, '0')}` : `${m} min`
}

/**
 * Peut-on lier cette rec à ce match sans demander ?
 * Évite les recs de test (quelques secondes pendant une game) liées par erreur.
 */
export function autoLinkVerdict(c: MatchCandidate | undefined, minMinutes: number): { ok: boolean; reason: string | null } {
  if (!c) return { ok: false, reason: null }
  if (c.recSeconds < minMinutes * 60) {
    return {
      ok: false,
      reason: `Rec courte (${fmtMinutes(c.recSeconds)}) : pas liée toute seule. Si c'est bien une game, choisis-la ci-dessous.`
    }
  }
  if (c.overlap < 0.5) return { ok: false, reason: null }
  if (c.coverage < MIN_COVERAGE) {
    return {
      ok: false,
      reason: `Cette rec ne filme que ${Math.round(c.coverage * 100)} % du match : pas liée toute seule. Choisis-le ci-dessous si c'est le bon.`
    }
  }
  return { ok: true, reason: null }
}
