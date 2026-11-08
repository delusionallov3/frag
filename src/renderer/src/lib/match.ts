import type { Clip, MatchKill, MatchLink, SyncAnchor } from '@shared/types'

/* ------------------------------------------------------------------ Synchro temps de match ↔ temps vidéo */

/** Ancre active pour un instant du match : la dernière calée avant lui (gère les pauses techniques en recalant plus loin). */
export function anchorFor(link: MatchLink, matchTime: number): SyncAnchor | null {
  if (!link.anchors.length) return null
  const sorted = [...link.anchors].sort((a, b) => a.matchTime - b.matchTime)
  let best = sorted[0]
  for (const a of sorted) if (a.matchTime <= matchTime + 0.5) best = a
  return best
}

/** Décalage (temps de match - temps vidéo) à utiliser pour un instant du match */
export function offsetAt(link: MatchLink, matchTime: number): number {
  const a = anchorFor(link, matchTime)
  if (a) return a.matchTime - a.videoTime
  return link.autoOffset ?? 0
}

export const toVideo = (link: MatchLink, matchTime: number): number => matchTime - offsetAt(link, matchTime)

/** Instant du match correspondant à un instant vidéo (approx. : utilise l'ancre la plus proche) */
export function toMatch(link: MatchLink, videoTime: number): number {
  if (!link.anchors.length) return videoTime + (link.autoOffset ?? 0)
  let best = link.anchors[0]
  for (const a of link.anchors) if (Math.abs(a.videoTime - videoTime) < Math.abs(best.videoTime - videoTime)) best = a
  return videoTime + best.matchTime - best.videoTime
}

/* ------------------------------------------------------------------ Analyse des rounds */

export interface RoundInfo {
  index: number
  n: number
  won: boolean | null
  /** score de mon équipe après ce round */
  score: string
  /** temps vidéo */
  start: number | null
  end: number | null
  myKills: MatchKill[]
  died: boolean
  clutch: number | null
  plant: boolean
  defuse: boolean
}

export interface TLEvent {
  id: string
  kind: 'kill' | 'death' | 'plant' | 'defuse'
  t: number
  matchTime: number
  round: number
  label: string
  /** index dans match.kills (kills et morts) */
  killIndex?: number
  /** l'autre joueur : la victime pour un kill, le tueur pour une mort */
  agentId?: string | null
  agent?: string | null
  weaponId?: string | null
  weapon?: string | null
}

export function myTeam(link: MatchLink): string | null {
  return link.match.players.find((p) => p.puuid === link.puuid)?.team ?? null
}

export function analyse(link: MatchLink): { rounds: RoundInfo[]; events: TLEvent[] } {
  const { match, puuid } = link
  const team = myTeam(link)
  const names = new Map(match.players.map((p) => [p.puuid, p.name]))
  const byId = new Map(match.players.map((p) => [p.puuid, p]))
  const rounds: RoundInfo[] = []
  const events: TLEvent[] = []
  let won = 0
  let lost = 0

  match.rounds.forEach((r, i) => {
    const roundKills = match.kills.filter((k) => k.round === i)
    const myKills = roundKills.filter((k) => k.killer === puuid && k.victim !== puuid && k.victimTeam !== team)
    const isWin = team ? r.winningTeam === team : null
    if (isWin === true) won++
    else if (isWin === false) lost++

    // Clutch : je reste seul en vie dans mon équipe face à au moins un ennemi, et on gagne le round
    let clutch: number | null = null
    if (team && isWin) {
      const alive = new Map<string, Set<string>>()
      for (const p of match.players) {
        if (!alive.has(p.team)) alive.set(p.team, new Set())
        alive.get(p.team)!.add(p.puuid)
      }
      for (const k of roundKills) {
        alive.get(k.victimTeam)?.delete(k.victim)
        const mine = alive.get(team)
        if (clutch === null && mine && mine.size === 1 && mine.has(puuid)) {
          let enemies = 0
          for (const [t, set] of alive) if (t !== team) enemies += set.size
          if (enemies >= 1) clutch = enemies
        }
      }
    }

    const next = match.rounds[i + 1]
    const startM = r.start
    const endM = next?.start ?? match.length
    rounds.push({
      index: i,
      n: i + 1,
      won: isWin,
      score: `${won}–${lost}`,
      start: startM !== null ? toVideo(link, startM) : null,
      end: endM !== null && startM !== null ? toVideo(link, endM) : null,
      myKills,
      died: roundKills.some((k) => k.victim === puuid),
      clutch,
      plant: !!r.plant,
      defuse: !!r.defuse
    })

    for (const k of myKills) {
      events.push({
        id: `k-${i}-${k.tMatch}`,
        kind: 'kill',
        killIndex: match.kills.indexOf(k),
        agentId: byId.get(k.victim)?.agentId ?? null,
        agent: byId.get(k.victim)?.agent ?? null,
        weaponId: k.weaponId ?? null,
        weapon: k.weapon,
        t: toVideo(link, k.tMatch),
        matchTime: k.tMatch,
        round: i,
        label: `R${i + 1} · ${k.weapon ?? 'Kill'} → ${names.get(k.victim) ?? '?'}`
      })
    }
    for (const k of roundKills.filter((k) => k.victim === puuid)) {
      events.push({
        id: `d-${i}-${k.tMatch}`,
        kind: 'death',
        killIndex: match.kills.indexOf(k),
        agentId: byId.get(k.killer)?.agentId ?? null,
        agent: byId.get(k.killer)?.agent ?? null,
        weaponId: k.weaponId ?? null,
        weapon: k.weapon,
        t: toVideo(link, k.tMatch),
        matchTime: k.tMatch,
        round: i,
        label: `R${i + 1} · Mort (${names.get(k.killer) ?? '?'}${k.weapon ? `, ${k.weapon}` : ''})`
      })
    }
    if (startM !== null && r.plant) {
      const m = startM + r.plant.tRound
      events.push({
        id: `p-${i}`,
        kind: 'plant',
        t: toVideo(link, m),
        matchTime: m,
        round: i,
        label: `R${i + 1} · Spike posé (${r.plant.site})${r.plant.player === puuid ? ' par toi' : ''}`
      })
    }
    if (startM !== null && r.defuse) {
      const m = startM + r.defuse.tRound
      events.push({
        id: `f-${i}`,
        kind: 'defuse',
        t: toVideo(link, m),
        matchTime: m,
        round: i,
        label: `R${i + 1} · Spike désamorcé${r.defuse.player === puuid ? ' par toi' : ''}`
      })
    }
  })

  events.sort((a, b) => a.t - b.t)
  return { rounds, events }
}

/* ------------------------------------------------------------------ Clips automatiques */

export interface AutoClipOptions {
  pre: number
  post: number
  minKills: number
  clutches: boolean
}

const GAP = 15

export function autoClips(
  link: MatchLink,
  rounds: RoundInfo[],
  opts: AutoClipOptions,
  duration: number,
  existing: Clip[]
): Omit<Clip, 'id'>[] {
  const out: Omit<Clip, 'id'>[] = []
  for (const r of rounds) {
    const k = r.myKills.length
    const keep = k >= opts.minKills || (opts.clutches && r.clutch !== null && k > 0)
    if (!keep || !k) continue

    // Kills espacés de plus de 15 s → clips séparés
    const groups: MatchKill[][] = []
    for (const kill of r.myKills) {
      const g = groups[groups.length - 1]
      if (g && kill.tMatch - g[g.length - 1].tMatch <= GAP) g.push(kill)
      else groups.push([kill])
    }

    const weapons = new Set(r.myKills.map((x) => x.weapon).filter(Boolean))
    let label = k === 5 ? 'ACE' : `${k}K`
    if (r.clutch !== null) label += ` · Clutch 1v${r.clutch}`
    if (weapons.size === 1) label += ` · ${[...weapons][0]}`

    groups.forEach((g, gi) => {
      const start = Math.max(0, toVideo(link, g[0].tMatch) - opts.pre)
      const end = Math.min(duration, toVideo(link, g[g.length - 1].tMatch) + opts.post)
      if (end - start < 0.5) return
      const overlapping = existing.some((c) => {
        const inter = Math.min(c.end, end) - Math.max(c.start, start)
        return inter > 0.5 * Math.min(c.end - c.start, end - start)
      })
      if (overlapping) return
      out.push({ name: `R${r.n} · ${label}${groups.length > 1 ? ` (${gi + 1}/${groups.length})` : ''}`, start, end })
    })
  }
  return out
}

export function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
