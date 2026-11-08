import type { MatchData, RecRound } from './types'

/** Spike timer once planted (s) */
const SPIKE_TIMER = 45

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Time (match time, s) when each round ends, when it can be known:
 * last kill for an elimination, defuse, or spike detonation. null otherwise.
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
  /** number of rounds used */
  rounds: number
  /** typical spread between rounds (s) */
  spread: number
}

/**
 * Sync from the round ends seen during the game (score from the Riot client).
 * Returns null if there aren't enough rounds, if the winners don't line up (wrong match)
 * or if the offsets are too scattered.
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
  // round winners don't line up: it's not the right game
  if (disagree > Math.max(1, (agree + disagree) * 0.2)) return null
  if (pairs.length < 3) return null
  const diffs = pairs.map((p) => p.end - p.t)
  const offset = median(diffs)
  const spread = median(diffs.map((d) => Math.abs(d - offset)))
  if (spread > 2) return null
  const ref = pairs.reduce((a, b) => (Math.abs(b.end - b.t - offset) < Math.abs(a.end - a.t - offset) ? b : a))
  return { matchTime: ref.end, videoTime: ref.end - offset, rounds: pairs.length, spread }
}
