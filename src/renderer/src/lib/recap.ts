/**
 * Builds the Broadcast montage of a linked match: the intro card (map, score, agent, rank, stats)
 * and one highlight per auto clip, each with what its lower third and punch-ins need.
 */
import type { Clip, MatchLink, MontageItem, MotionHighlight, MotionIntro } from '@shared/types'
import { getLang } from '@shared/i18n'
import { useAssets } from './assets'
import { autoClips, myTeam, toVideo, type AutoClipOptions, type RoundInfo } from './match'

const key = (s?: string | null): string => (s ?? '').trim().toLowerCase()

/** The match card of the intro */
export function introFor(link: MatchLink): MotionIntro {
  const { match, puuid } = link
  const index = useAssets.getState().index
  const me = match.players.find((p) => p.puuid === puuid)
  const team = myTeam(link)
  const t = match.teams.find((x) => x.id === team)
  const rounds = Math.max(1, match.rounds.length)
  const shots = (me?.headshots ?? 0) + (me?.bodyshots ?? 0) + (me?.legshots ?? 0)
  const map = index?.maps.get(key(match.mapId)) ?? index?.maps.get(key(match.map)) ?? null
  const agent = index?.agents.get(key(me?.agentId)) ?? index?.agents.get(key(me?.agent)) ?? null
  const tier =
    (me?.tier ? index?.tiers.get(me.tier) : undefined) ??
    (me?.rank ? [...(index?.tiers.values() ?? [])].find((x) => x.name.toLowerCase() === me.rank!.toLowerCase()) : undefined) ??
    null
  return {
    map: match.map,
    mode: match.mode,
    date: match.startedAt,
    us: t?.roundsWon ?? 0,
    them: t?.roundsLost ?? 0,
    agent: me?.agent ?? '',
    tier: tier?.name ?? me?.rank ?? null,
    kda: me ? `${me.kills}/${me.deaths}/${me.assists}` : '–',
    acs: me ? Math.round(me.score / rounds) : null,
    adr: me?.damage != null ? Math.round(me.damage / rounds) : null,
    hs: shots > 0 ? Math.round(((me?.headshots ?? 0) / shots) * 100) : null,
    splash: map?.splash ?? null,
    portrait: agent?.portrait ?? null,
    rankIcon: tier && tier.tier > 2 ? tier.icon : null,
    lang: getLang()
  }
}

/** What a clip shows: the round, my kills in it (seconds from the clip start), the weapon */
export function highlightFor(link: MatchLink, rounds: RoundInfo[], clip: Pick<Clip, 'start' | 'end'>): MotionHighlight | null {
  const index = useAssets.getState().index
  const inClip = rounds.flatMap((r) =>
    r.myKills.map((k) => ({ r, k, t: toVideo(link, k.tMatch) })).filter((x) => x.t >= clip.start - 0.05 && x.t <= clip.end + 0.05)
  )
  if (!inClip.length) return null
  // the round with the most of my kills in this clip
  const counts = new Map<RoundInfo, number>()
  for (const x of inClip) counts.set(x.r, (counts.get(x.r) ?? 0) + 1)
  const round = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const kills = inClip.filter((x) => x.r === round)
  const n = round.myKills.length
  const weapons = [...new Set(kills.map((x) => x.k.weaponId || x.k.weapon).filter(Boolean))] as string[]
  const w = weapons.length === 1 ? (index?.weapons.get(key(weapons[0])) ?? null) : null
  return {
    label: n >= 5 ? 'ACE' : `${n}K`,
    round: round.n,
    score: round.score,
    clutch: round.clutch !== null ? `Clutch 1v${round.clutch}` : null,
    weapon: weapons.length === 1 ? (w?.name ?? kills[0].k.weapon ?? null) : null,
    weaponIcon: w?.killfeed ?? w?.icon ?? null,
    kills: kills.map((x) => Math.max(0, x.t - clip.start)).sort((a, b) => a - b)
  }
}

/** The whole recap: one item per auto clip of the match, in round order */
export function recapItems(
  link: MatchLink,
  rounds: RoundInfo[],
  videoPath: string,
  duration: number,
  opts: AutoClipOptions
): MontageItem[] {
  return autoClips(link, rounds, opts, duration, [])
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ videoPath, start: c.start, end: c.end, layers: [], motion: highlightFor(link, rounds, c) }))
}
