import { useEffect, useMemo, useState } from 'react'
import { BarChart3 } from '../lib/icons'
import type { StatsEntry } from '@shared/types'
import { useApp } from '../store'
import { useLookup } from '../lib/assets'
import { myTeam } from '../lib/match'
import { GOOD_TAG, insights, REVIEW_TAGS, tagLabel } from '../lib/review'
import { num, tr } from '@shared/i18n'
import VImg from './VImg'

type Period = '7' | '30' | 'all'

/** Display names for modes (HenrikDev returns the game's English names) */
const modeLabels = (): Record<string, string> => ({
  competitive: tr('Competitive', 'Compétition'),
  unrated: tr('Unrated', 'Non classé'),
  swiftplay: 'Swiftplay',
  'spike rush': 'Spike Rush',
  deathmatch: 'Deathmatch',
  'team deathmatch': 'Team Deathmatch',
  escalation: 'Escalation',
  skirmish: 'Skirmish',
  premier: 'Premier',
  replication: 'Replication',
  custom: tr('Custom', 'Personnalisée'),
  'custom game': tr('Custom', 'Personnalisée')
})
/** Filter display order */
const MODE_ORDER = ['competitive', 'unrated', 'swiftplay', 'premier', 'spike rush', 'skirmish', 'team deathmatch', 'deathmatch', 'escalation']
const modeKey = (mode: string): string => mode.trim().toLowerCase()
const modeLabel = (key: string, raw: string): string => modeLabels()[key] ?? raw

const MODE_PREF = 'frag.stats.mode'
function readModePref(): string | null {
  try {
    return localStorage.getItem(MODE_PREF)
  } catch {
    return null
  }
}
function writeModePref(v: string): void {
  try {
    localStorage.setItem(MODE_PREF, v)
  } catch {
    /* not a big deal */
  }
}

interface Game {
  e: StatsEntry
  date: number
  mode: string
  modeKey: string
  map: string
  mapId: string | null
  agent: string
  agentId: string | null
  won: boolean | null
  score: string
  kills: number
  deaths: number
  assists: number
  damage: number | null
  rounds: number
  hs: number | null
  shots: number | null
  fb: number
  fd: number
  deathsAll: number
  untraded: number
  trades: number
  clutchWon: number
  clutchLost: number
  lostAfterFB: number
}

function toGame(e: StatsEntry): Game | null {
  const m = e.link.match
  const me = m.players.find((p) => p.puuid === e.link.puuid)
  if (!me) return null
  const team = m.teams.find((t) => t.id === myTeam(e.link))
  const ins = insights(e.link)
  const shots = (me.headshots ?? 0) + (me.bodyshots ?? 0) + (me.legshots ?? 0)
  return {
    e,
    date: m.startedAt,
    mode: m.mode,
    modeKey: modeKey(m.mode || 'Game'),
    map: m.map,
    mapId: m.mapId ?? null,
    agent: me.agent,
    agentId: me.agentId ?? null,
    won: team ? team.won : null,
    score: team ? `${team.roundsWon}–${team.roundsLost}` : '',
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    damage: me.damage ?? null,
    rounds: m.rounds.length,
    hs: me.headshots ?? null,
    shots: shots > 0 ? shots : null,
    fb: ins.firstBloods,
    fd: ins.firstDeaths,
    deathsAll: ins.deaths,
    untraded: ins.untradedDeaths,
    trades: ins.trades,
    clutchWon: ins.clutchesWon,
    clutchLost: ins.clutchesLost,
    lostAfterFB: ins.lostAfterFB
  }
}

const sum = (gs: Game[], f: (g: Game) => number): number => gs.reduce((n, g) => n + f(g), 0)
const kd = (k: number, d: number): string => num(d ? k / d : k, 2)
const pct = (a: number, b: number): string => (b ? tr(`${Math.round((a / b) * 100)}%`, `${Math.round((a / b) * 100)} %`) : '–')

function adr(gs: Game[]): string {
  const withDmg = gs.filter((g) => g.damage !== null && g.rounds)
  if (!withDmg.length) return '–'
  return String(Math.round(sum(withDmg, (g) => g.damage!) / sum(withDmg, (g) => g.rounds)))
}

function hsPct(gs: Game[]): string {
  const w = gs.filter((g) => g.shots)
  if (!w.length) return '–'
  return pct(sum(w, (g) => g.hs ?? 0), sum(w, (g) => g.shots ?? 0))
}

/** K/D game after game: the page's main chart */
function KdChart({ games }: { games: Game[] }): JSX.Element {
  const W = 760
  const H = 240
  const P = { l: 40, r: 16, t: 16, b: 28 }
  const values = games.map((g) => (g.deaths ? g.kills / g.deaths : g.kills))
  const max = Math.max(2, Math.ceil(Math.max(...values, 1) * 2) / 2)
  const x = (i: number): number => P.l + (games.length === 1 ? (W - P.l - P.r) / 2 : (i * (W - P.l - P.r)) / (games.length - 1))
  const y = (v: number): number => P.t + (1 - v / max) * (H - P.t - P.b)
  const ticks = Array.from({ length: Math.floor(max / 0.5) + 1 }, (_, i) => i * 0.5).filter((v) => v % 1 === 0 || max <= 2)
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  // 5-game moving average
  const avg = values.map((_, i) => {
    const s = values.slice(Math.max(0, i - 4), i + 1)
    return s.reduce((a, b) => a + b, 0) / s.length
  })
  const avgPath = avg.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <svg className="kd-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className={t === 1 ? 'kd-one' : 'kd-grid'} />
          <text x={P.l - 8} y={y(t) + 4} className="kd-label" textAnchor="end">
            {num(t)}
          </text>
        </g>
      ))}
      <path d={path} className="kd-line" />
      {games.length > 2 && <path d={avgPath} className="kd-avg" />}
      {values.map((v, i) => (
        <circle
          key={i}
          cx={x(i)}
          cy={y(v)}
          r={4}
          className={games[i].won ? 'kd-dot is-win' : games[i].won === false ? 'kd-dot is-loss' : 'kd-dot'}
        >
          <title>
            {`${games[i].map} · ${games[i].mode} · ${games[i].agent} · ${games[i].kills}/${games[i].deaths}/${games[i].assists} · ${games[i].score}`}
          </title>
        </circle>
      ))}
    </svg>
  )
}

function GroupTable({ title, rows }: { title: string; rows: { key: string; icon?: string | null; name: string; gs: Game[] }[] }): JSX.Element {
  return (
    <div className="st-card">
      <div className="st-card-head">{title}</div>
      <div className="st-table">
        <div className="st-tr is-head">
          <span />
          <span>Games</span>
          <span>{tr('Wins', 'Victoires')}</span>
          <span>K/D</span>
          <span>ADR</span>
        </div>
        {rows.map((r) => {
          const w = r.gs.filter((g) => g.won).length
          const wr = r.gs.length ? w / r.gs.length : 0
          return (
            <div key={r.key} className="st-tr">
              <span className="st-name">
                {r.icon ? <VImg src={r.icon} className="st-icon" /> : <span className="st-icon is-empty" />}
                {r.name}
              </span>
              <span>{r.gs.length}</span>
              <span className="st-wr">
                <i style={{ width: `${Math.round(wr * 100)}%` }} />
                <em>{pct(w, r.gs.length)}</em>
              </span>
              <span>{kd(sum(r.gs, (g) => g.kills), sum(r.gs, (g) => g.deaths))}</span>
              <span>{adr(r.gs)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function StatsPage(): JSX.Element {
  const { openVideo } = useApp()
  const L = useLookup()
  const [entries, setEntries] = useState<StatsEntry[] | null>(null)
  const [period, setPeriod] = useState<Period>('30')

  useEffect(() => {
    window.frag.statsEntries().then(setEntries)
  }, [])

  const all = useMemo(() => (entries ?? []).map(toGame).filter((g): g is Game => !!g), [entries])
  const inPeriod = useMemo(() => {
    if (period === 'all') return all
    const from = Date.now() - Number(period) * 86400000
    return all.filter((g) => g.date >= from)
  }, [all, period])

  // Modes played in the period, with their game count
  const modes = useMemo(() => {
    const m = new Map<string, { key: string; label: string; n: number }>()
    for (const g of inPeriod) {
      const cur = m.get(g.modeKey) ?? { key: g.modeKey, label: modeLabel(g.modeKey, g.mode), n: 0 }
      cur.n++
      m.set(g.modeKey, cur)
    }
    const rank = (k: string): number => (MODE_ORDER.includes(k) ? MODE_ORDER.indexOf(k) : 99)
    return [...m.values()].sort((a, b) => rank(a.key) - rank(b.key) || b.n - a.n)
  }, [inPeriod])

  // Default: competitive if there is any, otherwise all modes
  const [modePick, setModePick] = useState<string | null>(readModePref())
  const mode =
    modePick === 'all' || (modePick && modes.some((x) => x.key === modePick))
      ? modePick
      : modes.some((x) => x.key === 'competitive')
        ? 'competitive'
        : 'all'
  const pickMode = (k: string): void => {
    setModePick(k)
    writeModePref(k)
  }

  const games = useMemo(
    () => (mode === 'all' ? inPeriod : inPeriod.filter((g) => g.modeKey === mode)),
    [inPeriod, mode]
  )

  const tags = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of games) for (const n of Object.values(g.e.review)) for (const t of n.tags) m.set(t, (m.get(t) ?? 0) + 1)
    return REVIEW_TAGS.map((t) => ({ t, n: m.get(t) ?? 0 }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
  }, [games])

  const byAgent = useMemo(() => {
    const m = new Map<string, Game[]>()
    for (const g of games) m.set(g.agent, [...(m.get(g.agent) ?? []), g])
    return [...m.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, gs]) => ({ key: name, name, gs, icon: L.agent(gs[0].agentId, name)?.icon }))
  }, [games, L])

  const byMap = useMemo(() => {
    const m = new Map<string, Game[]>()
    for (const g of games) m.set(g.map, [...(m.get(g.map) ?? []), g])
    return [...m.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, gs]) => ({ key: name, name, gs, icon: L.map(gs[0].mapId, name)?.listView }))
  }, [games, L])

  if (entries === null) return <div className="stats" />

  if (!all.length) {
    return (
      <div className="empty-hero">
        <div className="empty-icon">
          <BarChart3 />
        </div>
        <h1>{tr('No stats yet', 'Pas encore de stats')}</h1>
        <p>
          {tr(
            'Link your recordings to their matches (Match tab in the editor): every linked game feeds this page.',
            'Lie tes recs à leurs matchs (onglet Match dans l’éditeur) : chaque game liée alimente cette page.'
          )}
        </p>
      </div>
    )
  }

  const wins = games.filter((g) => g.won).length
  const losses = games.filter((g) => g.won === false).length
  const K = sum(games, (g) => g.kills)
  const D = sum(games, (g) => g.deaths)
  const A = sum(games, (g) => g.assists)
  const fb = sum(games, (g) => g.fb)
  const fd = sum(games, (g) => g.fd)
  const deathsAll = sum(games, (g) => g.deathsAll)
  const untraded = sum(games, (g) => g.untraded)
  const cw = sum(games, (g) => g.clutchWon)
  const cl = sum(games, (g) => g.clutchLost)
  const lafb = sum(games, (g) => g.lostAfterFB)
  const trades = sum(games, (g) => g.trades)
  const n = games.length || 1

  return (
    <div className="stats">
      <div className="stats-head">
        <div>
          <h1>Stats</h1>
          <span className="library-counts">
            {games.length} {games.length === 1 ? tr('linked game', 'game liée') : tr('linked games', 'games liées')}
            {mode !== 'all' && ` ${tr('in', 'en')} ${modes.find((x) => x.key === mode)?.label ?? mode}`}
          </span>
        </div>
        <div className="segmented">
          {(
            [
              ['7', tr('7 days', '7 jours')],
              ['30', tr('30 days', '30 jours')],
              ['all', tr('All time', 'Tout')]
            ] as [Period, string][]
          ).map(([p, l]) => (
            <button key={p} className={period === p ? 'is-on' : ''} onClick={() => setPeriod(p)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {modes.length > 1 && (
        <div className="st-modes">
          <button className={mode === 'all' ? 'is-on' : ''} onClick={() => pickMode('all')}>
            {tr('All modes', 'Tous les modes')} <span>{inPeriod.length}</span>
          </button>
          {modes.map((x) => (
            <button key={x.key} className={mode === x.key ? 'is-on' : ''} onClick={() => pickMode(x.key)}>
              {x.label} <span>{x.n}</span>
            </button>
          ))}
        </div>
      )}

      {!games.length ? (
        <div className="empty-inline">
          <div>
            <strong>{tr('No games in this period', 'Aucune game sur cette période')}</strong>
            <span>{tr('Pick a longer period to see your stats.', 'Élargis la période pour voir tes stats.')}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="st-cards">
            <div className="st-stat">
              <span>{tr('Wins', 'Victoires')}</span>
              <b>{pct(wins, wins + losses)}</b>
              <em>
                {wins} {tr('W', 'V')} · {losses} {tr('L', 'D')}
              </em>
            </div>
            <div className="st-stat">
              <span>K/D</span>
              <b>{kd(K, D)}</b>
              <em>
                {num(K / n)} / {num(D / n)} / {num(A / n)} {tr('per game', 'par game')}
              </em>
            </div>
            <div className="st-stat">
              <span>ADR</span>
              <b>{adr(games)}</b>
              <em>{tr('Damage per round', 'Dégâts par round')}</em>
            </div>
            <div className="st-stat">
              <span>Headshots</span>
              <b>{hsPct(games)}</b>
              <em>{tr('Of shots that hit', 'Des balles qui touchent')}</em>
            </div>
          </div>

          <div className="st-main">
            <div className="st-card st-chart">
              <div className="st-card-head">
                {tr('K/D game by game', 'K/D game après game')}
                <span className="st-legend">
                  <i className="is-win" /> {tr('win', 'victoire')} <i className="is-loss" /> {tr('loss', 'défaite')}{' '}
                  <i className="is-avg" /> {tr('5-game average', 'moyenne sur 5')}
                </span>
              </div>
              <KdChart games={games} />
            </div>

            <div className="st-card st-side">
              <div className="st-card-head">{tr('Duels and rounds', 'Duels et rounds')}</div>
              <div className="st-kv">
                <span>First bloods</span>
                <b>{fb}</b>
              </div>
              <div className="st-kv">
                <span>{tr('First deaths', 'Premières morts')}</span>
                <b className={fd > fb ? 'is-bad' : ''}>{fd}</b>
              </div>
              <div className="st-kv">
                <span>{tr('Untraded deaths', 'Morts non tradées')}</span>
                <b>{pct(untraded, deathsAll)}</b>
              </div>
              <div className="st-kv">
                <span>{tr('Trades made', 'Trades faits')}</span>
                <b>{trades}</b>
              </div>
              <div className="st-kv">
                <span>{tr('Clutches won', 'Clutchs gagnés')}</span>
                <b>
                  {cw} / {cw + cl}
                </b>
              </div>
              <div className="st-kv">
                <span>{tr('Rounds lost after first blood', 'Rounds perdus après first blood')}</span>
                <b>{lafb}</b>
              </div>
            </div>
          </div>

          <div className="st-grid">
            <GroupTable title={tr('By agent', 'Par agent')} rows={byAgent} />
            <GroupTable title={tr('By map', 'Par map')} rows={byMap} />
          </div>

          <div className="st-grid">
            <div className="st-card">
              <div className="st-card-head">{tr('Your tagged mistakes', 'Tes erreurs notées')}</div>
              {tags.length === 0 ? (
                <p className="st-empty">
                  {tr(
                    'In the editor’s Review tab, tag your deaths (“Dry peek”, “Bad positioning”…). The most frequent ones will show up here.',
                    'Dans l’onglet Revoir de l’éditeur, tague tes morts (« Peek seul », « Mauvais placement »…). Les plus fréquentes apparaîtront ici.'
                  )}
                </p>
              ) : (
                <div className="st-tags">
                  {tags.map(({ t, n: c }) => (
                    <div key={t} className={`st-tag ${t === GOOD_TAG ? 'is-good' : ''}`}>
                      <span>{tagLabel(t)}</span>
                      <i style={{ width: `${Math.round((c / tags[0].n) * 100)}%` }} />
                      <b>{c}</b>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="st-card">
              <div className="st-card-head">{tr('Recent games', 'Dernières games')}</div>
              <div className="st-games">
                {[...games]
                  .reverse()
                  .slice(0, 8)
                  .map((g) => (
                    <button key={g.e.videoPath} className="st-game" onClick={() => openVideo(g.e.videoPath)}>
                      <i className={g.won ? 'is-win' : g.won === false ? 'is-loss' : ''} />
                      <VImg src={L.agent(g.agentId, g.agent)?.icon} className="st-icon" />
                      <span className="st-name">
                        {g.map}
                        {mode === 'all' && <em>{modeLabel(g.modeKey, g.mode)}</em>}
                      </span>
                      <span className="st-mono">
                        {g.kills}/{g.deaths}/{g.assists}
                      </span>
                      <span className={`st-mono ${g.won ? 'ok' : g.won === false ? 'err' : ''}`}>{g.score}</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
