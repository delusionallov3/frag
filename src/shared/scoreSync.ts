import type { MatchData, RecRound } from './types'

/** Durée du spike une fois posé (s) */
const SPIKE_TIMER = 45

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Instant (temps de match, s) où chaque round se termine, quand on peut le savoir :
 * dernier kill pour une élimination, defuse, ou explosion du spike. null sinon.
 */
export function roundEnds(match: MatchData): (number | null)[] {
  return match.rounds.map((r) => {
    if (r.start === null) return null
    if (r.defuse) return r.start + r.defuse.tRound
    if (r.plant && /detonat/i.test(r.result)) return r.start + r.plant.tRound + SPIKE_TIMER
    if (/elimination/i.test(r.result)) {
      const kills = match.kills.filter((k) => k.round === r.index).map((k) => k.tMatch)
      return kills.length ? Math.max(...kills) : null
    }
    return null
  })
}

export interface ScoreSync {
  matchTime: number
  videoTime: number
  /** nombre de rounds qui ont servi */
  rounds: number
  /** écart typique entre rounds (s) */
  spread: number
}

/**
 * Calage à partir des fins de round vues pendant la game (score du client Riot).
 * Renvoie null si pas assez de rounds, si les vainqueurs ne collent pas (mauvais match)
 * ou si les écarts sont trop dispersés.
 */
export function scoreSync(match: MatchData, puuid: string, recRounds: RecRound[] | undefined): ScoreSync | null {
  if (!recRounds?.length) return null
  const me = match.players.find((p) => p.puuid === puuid)
  if (!me) return null
  const ends = roundEnds(match)
  let agree = 0
  let disagree = 0
  const pairs: { end: number; t: number }[] = []
  for (const rr of recRounds) {
    const round = match.rounds[rr.round]
    if (!round) {
      disagree++
      continue
    }
    if ((round.winningTeam === me.team) === rr.allyWon) agree++
    else {
      disagree++
      continue
    }
    const end = ends[rr.round]
    if (end !== null && end !== undefined) pairs.push({ end, t: rr.t })
  }
  // vainqueurs des rounds incohérents : ce n'est pas la bonne game
  if (disagree > Math.max(1, (agree + disagree) * 0.2)) return null
  if (pairs.length < 3) return null
  const diffs = pairs.map((p) => p.end - p.t)
  const offset = median(diffs)
  const spread = median(diffs.map((d) => Math.abs(d - offset)))
  if (spread > 2) return null
  const ref = pairs.reduce((a, b) => (Math.abs(b.end - b.t - offset) < Math.abs(a.end - a.t - offset) ? b : a))
  return { matchTime: ref.end, videoTime: ref.end - offset, rounds: pairs.length, spread }
}
