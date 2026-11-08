import type { MatchKill, MatchLink, MatchPlayer } from '@shared/types'
import { myTeam, toVideo } from './match'

/* ------------------------------------------------------------------ Playlists du mode Revoir */

export type ReviewKind = 'death' | 'entry' | 'untraded' | 'clutchLost' | 'lostAfterFB'

export const REVIEW_LISTS: { kind: ReviewKind; label: string; hint: string }[] = [
  { kind: 'death', label: 'Mes morts', hint: 'Chaque mort, de 6 s avant à 2 s après' },
  { kind: 'entry', label: 'Premières morts', hint: 'Tu es le premier mort du round' },
  { kind: 'untraded', label: 'Non tradées', hint: 'Personne n’a tué ton tueur dans les 3 s' },
  { kind: 'clutchLost', label: 'Clutchs ratés', hint: 'Seul en vie face à au moins un ennemi, round perdu' },
  { kind: 'lostAfterFB', label: 'Avantage perdu', hint: 'Ton équipe a fait le first blood mais a perdu le round' }
]

/** Tags rapides pour noter ses erreurs (et ce qui marche) */
export const REVIEW_TAGS = [
  'Peek seul',
  'Mauvais placement',
  'Pas d’utilitaire',
  'Visée',
  'Info ignorée',
  'Rotation',
  'Trop agressif',
  'Trop passif',
  'Bien joué'
]

export interface ReviewItem {
  key: string
  kind: ReviewKind
  round: number
  /** fenêtre à lire (temps vidéo) */
  start: number
  end: number
  /** instant clé (la mort, le moment où tu te retrouves seul…) */
  focus: number
  killIndex?: number
  title: string
  sub: string
  /** l'adversaire en cause (tueur), pour l'icône */
  other?: MatchPlayer
  weapon?: string | null
  weaponId?: string | null
}

const TRADE_WINDOW = 3

/** Analyse « progression » d'un match : sert au mode Revoir et à la page Stats */
export interface MatchInsights {
  rounds: number
  firstBloods: number
  firstDeaths: number
  deaths: number
  untradedDeaths: number
  trades: number
  clutchesWon: number
  clutchesLost: number
  lostAfterFB: number
  items: ReviewItem[]
}

export function insights(link: MatchLink, duration = Infinity): MatchInsights {
  const { match, puuid } = link
  const team = myTeam(link)
  const byId = new Map(match.players.map((p) => [p.puuid, p]))
  const items: ReviewItem[] = []
  let firstBloods = 0
  let firstDeaths = 0
  let deaths = 0
  let untradedDeaths = 0
  let trades = 0
  let clutchesWon = 0
  let clutchesLost = 0
  let lostAfterFB = 0

  const v = (m: number): number => toVideo(link, m)
  const inVideo = (t: number): boolean => t > -2 && t < duration + 2

  match.rounds.forEach((r, ri) => {
    const kills = match.kills.filter((k) => k.round === ri).sort((a, b) => a.tMatch - b.tMatch)
    if (!kills.length) return
    const won = team ? r.winningTeam === team : null
    const roundEnd = match.rounds[ri + 1]?.start ?? kills[kills.length - 1].tMatch + 8
    const first = kills[0]
    const fbForUs = team ? first.killerTeam === team && first.victimTeam !== team : false

    if (first.killer === puuid && first.victim !== puuid) firstBloods++
    if (first.victim === puuid) firstDeaths++

    // Trades : je tue quelqu'un qui vient de tuer un coéquipier
    for (const k of kills) {
      if (k.killer !== puuid || k.victimTeam === team) continue
      const avenged = kills.some(
        (x) => x.killer === k.victim && x.victimTeam === team && x.victim !== puuid && k.tMatch - x.tMatch <= TRADE_WINDOW && k.tMatch >= x.tMatch
      )
      if (avenged) trades++
    }

    // Mes morts
    for (const k of kills) {
      if (k.victim !== puuid) continue
      deaths++
      const killIndex = match.kills.indexOf(k)
      const traded = kills.some(
        (x) => x.victim === k.killer && x.killerTeam === team && x.tMatch > k.tMatch && x.tMatch - k.tMatch <= TRADE_WINDOW
      )
      if (!traded) untradedDeaths++
      const killer = byId.get(k.killer)
      const t = v(k.tMatch)
      const base: Omit<ReviewItem, 'key' | 'kind'> = {
        round: ri,
        start: Math.max(0, t - 6),
        end: t + 2,
        focus: t,
        killIndex,
        title: `R${ri + 1} · ${k.tRound.toFixed(0)} s`,
        sub: `Tué par ${killer?.name ?? '?'}${killer ? ` (${killer.agent})` : ''}`,
        other: killer,
        weapon: k.weapon,
        weaponId: k.weaponId
      }
      if (inVideo(t)) {
        items.push({ ...base, key: `d-${killIndex}`, kind: 'death' })
        if (k === first) items.push({ ...base, key: `d-${killIndex}`, kind: 'entry' })
        if (!traded) items.push({ ...base, key: `d-${killIndex}`, kind: 'untraded' })
      }
    }

    // Clutch : je reste seul face à au moins un ennemi
    if (team) {
      const alive = new Map<string, Set<string>>()
      for (const p of match.players) {
        if (!alive.has(p.team)) alive.set(p.team, new Set())
        alive.get(p.team)!.add(p.puuid)
      }
      let clutchAt: MatchKill | null = null
      let vs = 0
      for (const k of kills) {
        alive.get(k.victimTeam)?.delete(k.victim)
        const mine = alive.get(team)
        if (!clutchAt && mine && mine.size === 1 && mine.has(puuid)) {
          let enemies = 0
          for (const [t, set] of alive) if (t !== team) enemies += set.size
          if (enemies >= 1) {
            clutchAt = k
            vs = enemies
          }
        }
      }
      if (clutchAt) {
        if (won) clutchesWon++
        else {
          clutchesLost++
          const s = v(clutchAt.tMatch)
          if (inVideo(s)) {
            items.push({
              key: `c-${ri}`,
              kind: 'clutchLost',
              round: ri,
              start: Math.max(0, s - 2),
              end: v(roundEnd),
              focus: s,
              title: `R${ri + 1} · 1v${vs}`,
              sub: 'Clutch perdu'
            })
          }
        }
      }
    }

    // First blood pour nous, mais round perdu
    if (fbForUs && won === false) {
      lostAfterFB++
      const s = v(first.tMatch)
      if (inVideo(s)) {
        items.push({
          key: `f-${ri}`,
          kind: 'lostAfterFB',
          round: ri,
          start: Math.max(0, s - 3),
          end: v(roundEnd),
          focus: s,
          title: `R${ri + 1} · avantage 5v4`,
          sub: `First blood de ${byId.get(first.killer)?.name ?? '?'}, round perdu`
        })
      }
    }
  })

  items.sort((a, b) => a.start - b.start)
  return {
    rounds: match.rounds.length,
    firstBloods,
    firstDeaths,
    deaths,
    untradedDeaths,
    trades,
    clutchesWon,
    clutchesLost,
    lostAfterFB,
    items
  }
}
