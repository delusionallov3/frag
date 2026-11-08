import { useEffect, useMemo, useState } from 'react'
import {
  Link2,
  Loader2,
  RefreshCw,
  KeyRound,
  Crosshair,
  Wand2,
  Unlink,
  Flag,
  Check,
  AlertTriangle,
  ChevronDown,
  ScanSearch
} from 'lucide-react'
import type { AutoSyncResult, MatchCandidate, MatchData, MatchKill, MatchLink, MatchPlayer, RiotAccount } from '@shared/types'
import { useApp } from '../store'
import { fmtTime } from '../lib/format'
import { fmtDate, myTeam, toMatch, type AutoClipOptions, type RoundInfo, type TLEvent } from '../lib/match'
import { useLookup } from '../lib/assets'
import VImg from './VImg'
import SpikeIcon from './SpikeIcon'
import { AccountsField, KeyField } from './HenrikSetup'

export interface AutoSyncState {
  running: boolean
  progress: number
  result?: AutoSyncResult
  error?: string
}

interface Props {
  path: string
  duration: number
  time: number
  link: MatchLink | null
  rounds: RoundInfo[]
  selectedEvent: TLEvent | null
  autoTried: 'idle' | 'loading' | 'done'
  /** pourquoi la rec n'a pas été liée toute seule */
  autoNote?: string | null
  onSkipAuto: () => void
  onLink: (match: MatchData, account: RiotAccount) => void
  onUnlink: () => void
  onSetPuuid: (puuid: string) => void
  onAnchorRound: (roundIndex: number) => void
  onAnchorKill: (killIndex: number) => void
  autoSync: AutoSyncState
  onAutoSync: () => void
  onApplyAutoSync: () => void
  onNudge: (delta: number) => void
  onResetSync: () => void
  onSeek: (t: number) => void
  onSelectEvent: (id: string) => void
  onAutoClips: (opts: AutoClipOptions) => number
  previewAutoClips: (opts: AutoClipOptions) => number
}

/* ------------------------------------------------------------------ Configuration (clé testée + compte vérifié) */

function Setup(): JSX.Element {
  const { settings } = useApp()
  const step = !settings?.hasHenrikKey ? 1 : 2
  return (
    <div className="mp-section">
      <div className="mp-intro">
        <div className="mp-intro-icon">
          <Link2 size={18} />
        </div>
        <strong>Relie tes recs à tes matchs</strong>
        <p>Frag récupère tes kills, tes morts et les rounds via HenrikDev, et les place sur la timeline.</p>
      </div>
      <div className="mp-steps">
        <span className={step === 1 ? 'is-on' : 'is-done'}>{step > 1 ? <Check size={11} /> : '1'} Clé API</span>
        <span className={step === 2 ? 'is-on' : ''}>2 Compte Riot</span>
      </div>
      {step === 1 ? <KeyField compact /> : <AccountsField compact />}
      <p className="mp-note">
        {step === 1
          ? 'La clé est testée auprès de HenrikDev avant d’être enregistrée (chiffrée, uniquement sur ton PC).'
          : 'Ton Riot ID est vérifié : Frag récupère ton identifiant unique et ta région, donc plus besoin de les saisir.'}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ Choix du match */

function MatchRow({ c, account, onPick }: { c: MatchCandidate; account: RiotAccount; onPick: () => void }): JSX.Element {
  const m = c.match
  const me =
    m.players.find((p) => account.puuid && p.puuid === account.puuid) ??
    m.players.find((p) => `${p.name}#${p.tag}`.toLowerCase() === account.riotId.toLowerCase())
  const team = m.teams.find((t) => t.id === me?.team)
  return (
    <button className={`mp-cand ${c.overlap > 0.5 ? 'is-best' : ''}`} onClick={onPick}>
      <div className={`mp-cand-result ${team ? (team.won ? 'is-win' : 'is-loss') : ''}`}>
        {team ? `${team.roundsWon}–${team.roundsLost}` : '–'}
      </div>
      <div className="mp-cand-main">
        <div className="mp-cand-title">
          {m.map}
          <span>{me?.agent}</span>
        </div>
        <div className="mp-cand-sub">
          {fmtDate(m.startedAt)} · {m.mode}
        </div>
      </div>
      {c.linkedElsewhere.length > 0 ? (
        <span className="mp-badge is-muted" title={c.linkedElsewhere.join('\n')}>
          Déjà liée à {c.linkedElsewhere.length > 1 ? `${c.linkedElsewhere.length} recs` : 'une rec'}
        </span>
      ) : (
        c.overlap > 0.5 && <span className="mp-badge">Correspond</span>
      )}
    </button>
  )
}

function Picker({
  path,
  onLink,
  note
}: {
  path: string
  onLink: (m: MatchData, a: RiotAccount) => void
  note: string | null
}): JSX.Element {
  const { settings } = useApp()
  const accounts = settings?.accounts ?? []
  const [accIdx, setAccIdx] = useState(0)
  const account = accounts[Math.min(accIdx, accounts.length - 1)]
  const [list, setList] = useState<MatchCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [matchId, setMatchId] = useState('')

  const load = async (force = false): Promise<void> => {
    if (!account) return
    setLoading(true)
    setError(null)
    const res = await window.frag.matchCandidates(path, account.region, account.riotId, force)
    setLoading(false)
    if (res.ok) setList(res.data)
    else {
      setList(null)
      setError(res.error)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, account?.riotId])

  const byId = async (): Promise<void> => {
    if (!account) return
    setLoading(true)
    setError(null)
    const res = await window.frag.matchById(account.region, matchId)
    setLoading(false)
    if (res.ok) onLink(res.data, account)
    else setError(res.error)
  }

  if (!account) return <></>

  return (
    <div className="mp-section">
      {note && (
        <div className="mp-note is-warn">
          <AlertTriangle size={14} />
          <span>{note}</span>
        </div>
      )}
      <div className="field">
        <label>Compte</label>
        <div className="row gap-6">
          <div className="select-wrap">
            <select
              className="input"
              value={accIdx}
              onChange={(e) => setAccIdx(Number(e.target.value))}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {accounts.map((a, i) => (
                <option key={a.riotId} value={i}>
                  {a.riotId} · {a.region.toUpperCase()}
                  {a.verified ? '' : ' (non vérifié)'}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          <button className="icon-btn is-boxed" onClick={() => load(true)} title="Recharger l’historique">
            {loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="mp-error">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      {list && (
        <div className="mp-cands">
          <div className="mp-label">Matchs récents</div>
          {list.length === 0 && <div className="mp-note">Aucun match trouvé pour ce compte.</div>}
          {list.length > 0 && !note && !list.some((c) => c.overlap > 0.5) && (
            <div className="mp-note">Aucun match ne correspond à l’heure de cette rec : choisis-le dans la liste.</div>
          )}
          {list.map((c) => (
            <MatchRow key={c.match.id} c={c} account={account} onPick={() => onLink(c.match, account)} />
          ))}
        </div>
      )}
      {!list && loading && (
        <div className="mp-loading">
          <Loader2 size={16} className="spin" /> Récupération de tes matchs…
        </div>
      )}

      <div className="field mp-byid">
        <label>Ou colle un match ID</label>
        <div className="row gap-6">
          <input
            className="input"
            value={matchId}
            onChange={(e) => setMatchId(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="xxxxxxxx-xxxx-xxxx-…"
            spellCheck={false}
          />
          <button
            className="btn btn-ghost btn-sm"
            disabled={!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(matchId.trim()) || loading}
            onClick={byId}
          >
            Lier
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Match lié */

function killLabel(k: MatchKill, names: Map<string, MatchPlayer>, me: string): string {
  const killer = names.get(k.killer)
  const victim = names.get(k.victim)
  const who = (p?: MatchPlayer, id?: string): string => (id === me ? 'Toi' : (p?.name ?? '?'))
  return `${k.tRound.toFixed(0).padStart(2, ' ')} s · ${who(killer, k.killer)} → ${who(victim, k.victim)}${k.weapon ? ` · ${k.weapon}` : ''}`
}

function Killfeed({ k, names, me }: { k: MatchKill; names: Map<string, MatchPlayer>; me: string }): JSX.Element {
  const L = useLookup()
  const killer = names.get(k.killer)
  const victim = names.get(k.victim)
  const ka = L.agent(killer?.agentId, killer?.agent)
  const va = L.agent(victim?.agentId, victim?.agent)
  const w = L.weapon(k.weaponId, k.weapon)
  const mine = k.killer === me
  return (
    <div className={`kf ${mine ? 'is-mine' : k.victim === me ? 'is-death' : ''}`}>
      <VImg src={ka?.killfeed ?? ka?.icon} className="kf-agent" fallback={<span className="kf-agent is-empty" />} />
      <span className="kf-name">{k.killer === me ? 'Toi' : killer?.name}</span>
      <VImg src={w?.killfeed} className="kf-weapon" fallback={<span className="kf-weapon-txt">{k.weapon ?? '✕'}</span>} />
      <span className="kf-name">{k.victim === me ? 'Toi' : victim?.name}</span>
      <VImg src={va?.killfeed ?? va?.icon} className="kf-agent is-victim" fallback={<span className="kf-agent is-empty" />} />
    </div>
  )
}

function Linked(p: Props & { link: MatchLink }): JSX.Element {
  const { settings, updateSettings } = useApp()
  const L = useLookup()
  const { link, rounds, time } = p
  const match = link.match
  const me = match.players.find((x) => x.puuid === link.puuid)
  const myTeamId = myTeam(link)
  const team = match.teams.find((t) => t.id === myTeamId)
  const names = useMemo(() => new Map(match.players.map((pl) => [pl.puuid, pl])), [match.players])
  const mapA = L.map(match.mapId, match.map)
  const meAgent = L.agent(me?.agentId, me?.agent)
  const tier = L.tier(me?.tier, me?.rank)

  const matchNow = toMatch(link, time)

  // Round estimé sous la tête de lecture, pour pré-remplir le calage
  const guessRound = useMemo(() => {
    let idx = 0
    for (const r of match.rounds) if (r.start !== null && r.start <= matchNow + 20) idx = r.index
    return idx
  }, [matchNow, match.rounds])
  const [roundSel, setRoundSel] = useState<number | null>(null)
  const roundIdx = roundSel ?? guessRound

  // Kill pré-sélectionné : celui choisi sur la timeline, sinon le plus proche de la tête de lecture
  const guessKill = useMemo(() => {
    if (p.selectedEvent?.killIndex !== undefined) return p.selectedEvent.killIndex
    let best = 0
    let bestD = Infinity
    match.kills.forEach((k, i) => {
      const d = Math.abs(k.tMatch - matchNow)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }, [p.selectedEvent, match.kills, matchNow])
  const [killSel, setKillSel] = useState<number | null>(null)
  const killIdx = killSel ?? guessKill
  const [mode, setMode] = useState<'round' | 'kill'>('kill')

  useEffect(() => {
    if (p.selectedEvent?.killIndex !== undefined) {
      setKillSel(null)
      setMode('kill')
    }
  }, [p.selectedEvent])

  const anchor = link.anchors[0] ?? null
  const synced = link.anchors.length > 0

  const [minKills, setMinKills] = useState(2)
  const [clutches, setClutches] = useState(true)
  const opts: AutoClipOptions = {
    pre: settings?.preRoll ?? 4,
    post: settings?.postRoll ?? 2,
    minKills,
    clutches
  }
  const preview = p.previewAutoClips(opts)

  const teams = useMemo(() => {
    const sorted = [...match.players].sort((a, b) => b.score - a.score)
    return [
      { id: myTeamId, label: 'Ton équipe', players: sorted.filter((x) => x.team === myTeamId) },
      { id: 'enemy', label: 'Adversaires', players: sorted.filter((x) => x.team !== myTeamId) }
    ]
  }, [match.players, myTeamId])

  const killsByRound = useMemo(() => {
    const g = new Map<number, number[]>()
    match.kills.forEach((k, i) => {
      if (!g.has(k.round)) g.set(k.round, [])
      g.get(k.round)!.push(i)
    })
    return [...g.entries()].sort((a, b) => a[0] - b[0])
  }, [match.kills])

  return (
    <>
      <div className="mh">
        <VImg src={mapA?.splash ?? mapA?.listView} className="mh-bg" fallback={<div className="mh-bg is-empty" />} />
        <div className="mh-shade" />
        <div className="mh-content">
          <div className="mh-top">
            <span>
              {match.mode} · {fmtDate(match.startedAt)}
            </span>
            <button className="mh-change" onClick={p.onUnlink} title="Lier un autre match">
              <Unlink size={12} /> Changer
            </button>
          </div>
          <div className="mh-bottom">
            <div className="mh-map">{match.map}</div>
            {team && (
              <div className={`mh-score ${team.won ? 'is-win' : 'is-loss'}`}>
                <strong>
                  {team.roundsWon}
                  <span>–</span>
                  {team.roundsLost}
                </strong>
                <em>{team.won ? 'Victoire' : 'Défaite'}</em>
              </div>
            )}
          </div>
        </div>
      </div>

      {me ? (
        <div className="mme" style={meAgent?.colors[0] ? { ['--agent' as string]: meAgent.colors[0] } : undefined}>
          <VImg src={meAgent?.icon} className="mme-agent" fallback={<div className="mme-agent is-empty" />} />
          <div className="mme-main">
            <div className="mme-name">
              {me.name}
              <span>#{me.tag}</span>
            </div>
            <div className="mme-sub">
              <span>{me.agent}</span>
              <span className="mme-kda">
                <b>{me.kills}</b> / {me.deaths} / {me.assists}
              </span>
            </div>
          </div>
          {(tier || me.rank) && (
            <div className="mme-rank" title={tier?.name ?? me.rank ?? ''}>
              <VImg src={tier?.icon} className="mme-rank-icon" />
              <span>{tier?.name ?? me.rank}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="mp-section">
          <div className="field">
            <label>Quel joueur es-tu ?</label>
            <select className="input" value="" onChange={(e) => p.onSetPuuid(e.target.value)}>
              <option value="" disabled>
                Choisir…
              </option>
              {match.players.map((pl) => (
                <option key={pl.puuid} value={pl.puuid}>
                  {pl.name}#{pl.tag} · {pl.agent}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <details className="msb">
        <summary>
          Tableau des scores <ChevronDown size={13} />
        </summary>
        {teams.map((t) => (
          <div key={t.id ?? 'x'} className="msb-team">
            <div className="msb-label">{t.label}</div>
            {t.players.map((pl) => {
              const a = L.agent(pl.agentId, pl.agent)
              const tr = L.tier(pl.tier, pl.rank)
              return (
                <div key={pl.puuid} className={`msb-row ${pl.puuid === link.puuid ? 'is-me' : ''}`}>
                  <VImg src={a?.icon} className="msb-agent" fallback={<span className="msb-agent is-empty" />} />
                  <span className="msb-name">{pl.name}</span>
                  <VImg src={tr?.icon} className="msb-rank" title={tr?.name} />
                  <span className="msb-kda">
                    {pl.kills}/{pl.deaths}/{pl.assists}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </details>

      <div className="mp-section">
        <div className="mp-head">
          <span className="mp-label">Synchro</span>
          <span className={`mp-status ${synced ? 'is-ok' : 'is-warn'}`}>
            {synced ? (
              <>
                <Check size={12} /> Calée · {anchor?.label}
              </>
            ) : (
              <>Approximative</>
            )}
          </span>
        </div>

        <div className="as">
          <button className="btn btn-ghost btn-sm btn-block" onClick={p.onAutoSync} disabled={p.autoSync.running}>
            {p.autoSync.running ? <Loader2 className="spin" /> : <ScanSearch />}
            {p.autoSync.running ? `Analyse du killfeed · ${Math.round(p.autoSync.progress * 100)} %` : 'Caler automatiquement'}
          </button>
          {p.autoSync.running && (
            <div className="bar">
              <div style={{ width: `${Math.round(p.autoSync.progress * 100)}%` }} />
            </div>
          )}
          {!p.autoSync.running && p.autoSync.result && (
            p.autoSync.result.confidence >= 0.5 ? (
              <div className="hk-msg is-ok">
                <Check />
                <span>
                  Calé sur le killfeed · confiance {Math.round(p.autoSync.result.confidence * 100)} % ·{' '}
                  {p.autoSync.result.kills} kills
                </span>
              </div>
            ) : (
              <div className="hk-msg is-warn">
                <AlertTriangle />
                <span>
                  Pas assez sûr (confiance {Math.round(p.autoSync.result.confidence * 100)} %). Cale à la main, ou{' '}
                  <button className="inline-action" onClick={p.onApplyAutoSync}>
                    applique quand même
                  </button>
                </span>
              </div>
            )
          )}
          {!p.autoSync.running && p.autoSync.error && (
            <div className="hk-msg is-err">
              <AlertTriangle />
              <span>{p.autoSync.error}</span>
            </div>
          )}
        </div>
        <div className="mp-or">ou à la main</div>

        <div className="segmented">
          <button className={mode === 'kill' ? 'is-on' : ''} onClick={() => setMode('kill')}>
            Sur un kill
          </button>
          <button className={mode === 'round' ? 'is-on' : ''} onClick={() => setMode('round')}>
            Début de round
          </button>
        </div>

        {mode === 'kill' ? (
          <>
            <p className="mp-help">
              Mets la vidéo pile à l’image où le kill <strong>apparaît dans le killfeed</strong>, choisis-le, et valide :
              tout le match se recale dessus.
            </p>
            <div className="select-wrap">
              <select
                className="input"
                value={killIdx}
                onChange={(e) => setKillSel(Number(e.target.value))}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {killsByRound.map(([r, idxs]) => (
                  <optgroup key={r} label={`Round ${r + 1}`}>
                    {idxs.map((i) => (
                      <option key={i} value={i}>
                        {killLabel(match.kills[i], names, link.puuid)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <ChevronDown size={14} />
            </div>
            {match.kills[killIdx] && <Killfeed k={match.kills[killIdx]} names={names} me={link.puuid} />}
            <button
              className="btn btn-primary btn-sm btn-block"
              onClick={() => {
                p.onAnchorKill(killIdx)
                setKillSel(null)
              }}
            >
              <Crosshair size={14} />
              Caler le match sur ce kill
              <span className="btn-meta">{fmtTime(time)}</span>
            </button>
          </>
        ) : (
          <>
            <p className="mp-help">
              Mets la vidéo pile au moment où les <strong>barrières tombent</strong> (le chrono passe à 1:40), choisis
              le round, et valide.
            </p>
            <div className="row gap-6">
              <div className="select-wrap">
                <select
                  className="input"
                  value={roundIdx}
                  onChange={(e) => setRoundSel(Number(e.target.value))}
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  {match.rounds.map((r) => (
                    <option key={r.index} value={r.index} disabled={r.start === null}>
                      Round {r.index + 1}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
              <button
                className="btn btn-primary btn-sm mp-anchor-btn"
                onClick={() => {
                  p.onAnchorRound(roundIdx)
                  setRoundSel(null)
                }}
              >
                <Flag size={14} />
                Le round commence ici
              </button>
            </div>
          </>
        )}

        <div className="mp-nudge">
          <span>Décaler tout</span>
          {[-1, -0.1, 0.1, 1].map((d) => (
            <button key={d} className="chip-btn" onClick={() => p.onNudge(d)}>
              {d > 0 ? '+' : '−'}
              {Math.abs(d).toString().replace('.', ',')} s
            </button>
          ))}
          {synced && (
            <button className="link-btn" onClick={p.onResetSync} title="Revenir à la synchro approximative">
              Réinitialiser
            </button>
          )}
        </div>
      </div>

      <div className="mp-section">
        <div className="mp-head">
          <span className="mp-label">Clips auto</span>
        </div>
        <div className="row gap-8 mp-auto-opts">
          <div className="segmented">
            {[1, 2, 3].map((n) => (
              <button key={n} className={minKills === n ? 'is-on' : ''} onClick={() => setMinKills(n)}>
                {n}K+
              </button>
            ))}
          </div>
          <label className="toggle">
            <input type="checkbox" checked={clutches} onChange={(e) => setClutches(e.target.checked)} />
            <span />
            Clutchs
          </label>
        </div>
        <div className="mp-rolls">
          <label>
            Avant
            <input
              className="input input-num"
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={opts.pre}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => updateSettings({ preRoll: Math.max(0, Number(e.target.value) || 0) })}
            />
            s
          </label>
          <label>
            Après
            <input
              className="input input-num"
              type="number"
              min={0}
              max={30}
              step={0.5}
              value={opts.post}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => updateSettings({ postRoll: Math.max(0, Number(e.target.value) || 0) })}
            />
            s
          </label>
        </div>
        <button className="btn btn-ghost btn-block" disabled={preview === 0} onClick={() => p.onAutoClips(opts)}>
          <Wand2 size={15} />
          {preview === 0 ? 'Aucun nouveau clip' : preview === 1 ? 'Créer 1 clip' : `Créer ${preview} clips`}
        </button>
        {!synced && <p className="mp-note">Cale la synchro d’abord pour que les clips tombent pile.</p>}
      </div>

      <div className="mp-section mp-rounds-section">
        <div className="mp-head">
          <span className="mp-label">Rounds</span>
        </div>
        <div className="mp-rounds">
          {rounds.map((r) => {
            const outside = r.start === null || r.end! < 0 || r.start > p.duration
            const deaths = match.kills.filter((k) => k.round === r.index && k.victim === link.puuid)
            return (
              <div key={r.index} className={`mp-round ${outside ? 'is-out' : ''}`}>
                <button
                  className={`mp-round-n ${r.won ? 'is-win' : r.won === false ? 'is-loss' : ''}`}
                  onClick={() => r.start !== null && p.onSeek(Math.max(0, r.start))}
                  title={outside ? 'Hors de la rec' : 'Aller au début du round'}
                >
                  {r.n}
                </button>
                <div className="mp-round-body">
                  <div className="mp-round-meta">
                    <span className="mp-round-score">{r.score}</span>
                    {r.clutch !== null && <span className="mp-tag is-accent">Clutch 1v{r.clutch}</span>}
                    {r.myKills.length >= 2 && (
                      <span className="mp-tag">{r.myKills.length === 5 ? 'ACE' : `${r.myKills.length}K`}</span>
                    )}
                    {r.plant && <SpikeIcon size={13} className="mp-ico" />}
                  </div>
                  {(r.myKills.length > 0 || deaths.length > 0) && (
                    <div className="mp-kills">
                      {r.myKills.map((k) => {
                        const id = `k-${r.index}-${k.tMatch}`
                        const victim = names.get(k.victim)
                        const va = L.agent(victim?.agentId, victim?.agent)
                        const w = L.weapon(k.weaponId, k.weapon)
                        return (
                          <button
                            key={id}
                            className={`mp-kill ${p.selectedEvent?.id === id ? 'is-sel' : ''}`}
                            onClick={() => p.onSelectEvent(id)}
                            title={`${k.tRound.toFixed(0)} s · ${k.weapon ?? ''} → ${victim?.name ?? ''}`}
                          >
                            <VImg
                              src={w?.killfeed}
                              className="mp-kill-weapon"
                              fallback={<span className="mp-kill-txt">{k.weapon ?? 'Kill'}</span>}
                            />
                            <VImg src={va?.killfeed ?? va?.icon} className="mp-kill-agent" fallback={null} />
                          </button>
                        )
                      })}
                      {deaths.map((k) => {
                        const id = `d-${r.index}-${k.tMatch}`
                        const killer = names.get(k.killer)
                        const ka = L.agent(killer?.agentId, killer?.agent)
                        return (
                          <button
                            key={id}
                            className={`mp-kill is-death ${p.selectedEvent?.id === id ? 'is-sel' : ''}`}
                            onClick={() => p.onSelectEvent(id)}
                            title={`Mort à ${k.tRound.toFixed(0)} s · ${killer?.name ?? ''}`}
                          >
                            <VImg
                              src={ka?.killfeed ?? ka?.icon}
                              className="mp-kill-agent"
                              fallback={<span className="mp-kill-txt">{killer?.name ?? 'Mort'}</span>}
                            />
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

export default function MatchPanel(p: Props): JSX.Element {
  const { settings } = useApp()
  if (!settings) return <div className="side-pane" />
  const configured = settings.hasHenrikKey && settings.accounts.length > 0
  return (
    <div className="side-pane mp">
      {!configured ? (
        <Setup />
      ) : p.link ? (
        <Linked {...p} link={p.link} />
      ) : p.autoTried === 'loading' ? (
        <div className="mp-loading is-block is-col">
          <span className="row gap-8">
            <Loader2 size={16} className="spin" /> Recherche du match de cette rec…
          </span>
          <button className="link-btn" onClick={p.onSkipAuto}>
            Choisir moi-même
          </button>
        </div>
      ) : (
        <Picker path={p.path} onLink={p.onLink} note={p.autoNote ?? null} />
      )}
      {configured && (
        <button className="mp-key link-btn" onClick={() => useApp.getState().setSettingsOpen(true)}>
          <KeyRound size={12} /> Clé et comptes dans les réglages
        </button>
      )}
    </div>
  )
}
