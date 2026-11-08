import type { MatchKill, MatchLink, MatchPlayer } from '@shared/types'
import { tr } from '@shared/i18n'
import { myTeam, toVideo } from './match'

/* ------------------------------------------------------------------ Review mode playlists */

export type ReviewKind = 'death' | 'entry' | 'untraded' | 'clutchLost' | 'lostAfterFB'

export const reviewLists = (): { kind: ReviewKind; label: string; hint: string }[] => [
  { kind: 'death', label: tr('My deaths', 'Mes morts'), hint: tr('Every death, from 6 s before to 2 s after', 'Chaque mort, de 6 s avant à 2 s après') },
  { kind: 'entry', label: tr('First deaths', 'Premières morts'), hint: tr('You’re the first one down in the round', 'Tu es le premier mort du round') },
  { kind: 'untraded', label: tr('Untraded', 'Non tradées'), hint: tr('Nobody killed your killer within 3 s', 'Personne n’a tué ton tueur dans les 3 s') },
  {
    kind: 'clutchLost',
    label: tr('Lost clutches', 'Clutchs ratés'),
    hint: tr('Last one alive against at least one enemy, round lost', 'Seul en vie face à au moins un ennemi, round perdu')
  },
  {
    kind: 'lostAfterFB',
    label: tr('Thrown advantage', 'Avantage perdu'),
    hint: tr('Your team got first blood but lost the round', 'Ton équipe a fait le first blood mais a perdu le round')
  }
]

/**
 * Quick tags to note mistakes (and what works).
 * The French text is the value saved in projects, so it must never change: use tagLabel() to display it.
 */
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

const TAG_EN: Record<string, string> = {
  'Peek seul': 'Dry peek',
  'Mauvais placement': 'Bad positioning',
  'Pas d’utilitaire': 'No utility',
  Visée: 'Aim',
  'Info ignorée': 'Ignored info',
  Rotation: 'Rotation',
  'Trop agressif': 'Too aggressive',
  'Trop passif': 'Too passive',
  'Bien joué': 'Well played'
}

export const GOOD_TAG = 'Bien joué'

export function tagLabel(tag: string): string {
  return tr(TAG_EN[tag] ?? tag, tag)
}

export interface ReviewItem {
  key: string
  kind: ReviewKind
  round: number
  /** window to play (video time) */
  start: number
  end: number
  /** key moment (the death, the moment you end up alone…) */
  focus: number
  killIndex?: number
  title: string
  sub: string
  /** the opponent involved (killer), for the icon */
  other?: MatchPlayer
  weapon?: string | null
  weaponId?: string | null
}

const TRADE_WINDOW = 3

/** "Improvement" analysis of a match: used by Review mode and the Stats page */
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

    // Trades: I kill someone who just killed a teammate
    for (const k of kills) {
      if (k.killer !== puuid || k.victimTeam === team) continue
      const avenged = kills.some(
        (x) => x.killer === k.victim && x.victimTeam === team && x.victim !== puuid && k.tMatch - x.tMatch <= TRADE_WINDOW && k.tMatch >= x.tMatch
      )
      if (avenged) trades++
    }

    // My deaths
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
        sub: `${tr('Killed by', 'Tué par')} ${killer?.name ?? '?'}${killer ? ` (${killer.agent})` : ''}`,
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

    // Clutch: I'm the last one alive against at least one enemy
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
              sub: tr('Clutch lost', 'Clutch perdu')
            })
          }
        }
      }
    }

    // First blood for us, but round lost
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
          title: `R${ri + 1} · ${tr('5v4 advantage', 'avantage 5v4')}`,
          sub: tr(
            `First blood by ${byId.get(first.killer)?.name ?? '?'}, round lost`,
            `First blood de ${byId.get(first.killer)?.name ?? '?'}, round perdu`
          )
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
