import { useEffect, useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, X, Plus, Clapperboard } from 'lucide-react'
import type { CardStyle, Clip, MontageItem, Project } from '@shared/types'
import { useApp } from '../store'
import { baseName, fmtClipLen, stripExt } from '../lib/format'
import { CARD_ACCENTS, CARD_STYLES, renderCard } from '../lib/cards'
import Modal from './Modal'
import CardPreview from './CardPreview'

interface Pick {
  key: string
  videoPath: string
  clip: Clip
  title: string
  /** ligne d'infos sous le titre (map · agent…) */
  sub: string
}

const TRANSITIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Coupe sèche' },
  { value: 0.3, label: 'Fondu court' },
  { value: 0.8, label: 'Fondu long' }
]

/** Préférences de carton gardées d'une fois sur l'autre (simple confort) */
const readPref = (k: string, d: string): string => {
  try {
    return localStorage.getItem(k) ?? d
  } catch {
    return d
  }
}
const writePref = (k: string, v: string): void => {
  try {
    localStorage.setItem(k, v)
  } catch {
    /* stockage indispo : tant pis */
  }
}

function recLabel(p: Project): { name: string; sub: string } {
  const m = p.match?.match
  if (m) {
    const me = m.players.find((x) => x.puuid === p.match!.puuid)
    const team = m.teams.find((t) => t.id === me?.team)
    return {
      name: m.map,
      sub: `${me?.agent ?? ''}${team ? ` · ${team.roundsWon}–${team.roundsLost}` : ''} · ${new Date(m.startedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
    }
  }
  return { name: stripExt(baseName(p.videoPath)), sub: 'Rec non liée' }
}

export default function MontageModal(): JSX.Element | null {
  const { montageOpen, setMontageOpen, showToast, setExportsOpen } = useApp()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [picks, setPicks] = useState<Pick[]>([])
  const [focus, setFocus] = useState<string | null>(null)
  const [transition, setTransition] = useState(0.3)
  const [style, setStyleState] = useState<CardStyle>(() => {
    const v = readPref('frag.cardStyle', 'slab')
    return CARD_STYLES.some((c) => c.value === v) ? (v as CardStyle) : 'slab'
  })
  const [accent, setAccentState] = useState(() => readPref('frag.cardAccent', CARD_ACCENTS[0]))
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setStyle = (v: CardStyle): void => {
    setStyleState(v)
    writePref('frag.cardStyle', v)
  }
  const setAccent = (v: string): void => {
    setAccentState(v)
    writePref('frag.cardAccent', v)
  }

  useEffect(() => {
    if (!montageOpen) return
    window.frag.allProjects().then((ps) =>
      setProjects(
        ps
          .filter((p) => p.clips.length > 0)
          .sort((a, b) => (b.match?.match.startedAt ?? b.updatedAt) - (a.match?.match.startedAt ?? a.updatedAt))
      )
    )
  }, [montageOpen])

  const total = useMemo(() => {
    const sum = picks.reduce((n, p) => n + (p.clip.end - p.clip.start), 0)
    return Math.max(0, sum - transition * Math.max(0, picks.length - 1))
  }, [picks, transition])

  if (!montageOpen) return null

  const shown = picks.find((p) => p.key === focus) ?? picks[0] ?? null
  const noAccent = style === 'none' || style === 'classic' || style === 'cinema'

  const has = (key: string): boolean => picks.some((p) => p.key === key)
  const add = (p: Project, c: Clip): void => {
    const key = `${p.videoPath}|${c.id}`
    if (has(key)) return
    const m = p.match?.match
    const agent = m?.players.find((x) => x.puuid === p.match!.puuid)?.agent
    const sub = [m?.map, agent].filter(Boolean).join(' · ')
    setPicks((ps) => [...ps, { key, videoPath: p.videoPath, clip: c, title: c.name, sub }])
    setFocus(key)
  }
  const edit = (key: string, patch: Partial<Pick>): void =>
    setPicks((ps) => ps.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  const move = (i: number, d: -1 | 1): void =>
    setPicks((ps) => {
      const j = i + d
      if (j < 0 || j >= ps.length) return ps
      const n = [...ps]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })

  const exportMontage = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    let items: MontageItem[]
    try {
      items = await Promise.all(
        picks.map(async (p, i) => ({
          videoPath: p.videoPath,
          start: p.clip.start,
          end: p.clip.end,
          layers: await renderCard(style, { title: p.title, sub: p.sub, index: i, total: picks.length }, accent)
        }))
      )
    } catch (e) {
      setBusy(false)
      setError(`Les cartons n’ont pas pu être dessinés (${e instanceof Error ? e.message : String(e)}).`)
      return
    }
    const res = await window.frag.exportMontage(items, { transition, name: name.trim() })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setMontageOpen(false)
    setPicks([])
    showToast('Montage ajouté à l’export', { label: 'Voir', run: () => setExportsOpen(true) })
  }

  return (
    <Modal open title="Montage" onClose={() => setMontageOpen(false)} width={1180}>
      <div className="mt">
        <div className="mt-col">
          <div className="mt-head">Tes clips</div>
          <div className="mt-scroll">
            {projects === null ? null : projects.length === 0 ? (
              <p className="mt-empty">Aucun clip pour l’instant. Crée des clips dans tes recs, ils apparaîtront ici.</p>
            ) : (
              projects.map((p) => {
                const l = recLabel(p)
                return (
                  <div key={p.videoPath} className="mt-rec">
                    <div className="mt-rec-head">
                      <span>{l.name}</span>
                      <em>{l.sub}</em>
                    </div>
                    {[...p.clips]
                      .sort((a, b) => a.start - b.start)
                      .map((c) => {
                        const key = `${p.videoPath}|${c.id}`
                        const on = has(key)
                        return (
                          <button key={c.id} className={`mt-clip ${on ? 'is-on' : ''}`} onClick={() => add(p, c)} disabled={on}>
                            <span className="mt-clip-name">{c.name}</span>
                            <span className="mt-len">{fmtClipLen(c.end - c.start)}</span>
                            <Plus />
                          </button>
                        )
                      })}
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="mt-col">
          <div className="mt-head">
            Ordre du montage
            <span className="mt-total">
              {picks.length} {picks.length > 1 ? 'clips' : 'clip'} · {fmtClipLen(total)}
            </span>
          </div>
          <div className="mt-scroll">
            {picks.length === 0 ? (
              <div className="mt-empty is-center">
                <Clapperboard />
                <p>Clique sur des clips à gauche pour les ajouter, dans l’ordre que tu veux.</p>
              </div>
            ) : (
              picks.map((p, i) => (
                <div
                  key={p.key}
                  className={`mt-pick ${shown?.key === p.key ? 'is-focus' : ''}`}
                  onMouseDown={() => setFocus(p.key)}
                  onFocusCapture={() => setFocus(p.key)}
                >
                  <span className="mt-index">{i + 1}</span>
                  <div className="mt-texts">
                    <input
                      className="input mt-title"
                      value={p.title}
                      onChange={(e) => edit(p.key, { title: e.target.value })}
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder="Titre"
                      title="Titre du carton"
                      disabled={style === 'none'}
                    />
                    <input
                      className="input mt-sub"
                      value={p.sub}
                      onChange={(e) => edit(p.key, { sub: e.target.value })}
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder="Ascent · Jett · R7"
                      title="Ligne d’infos (sépare avec ·)"
                      disabled={style === 'none'}
                    />
                  </div>
                  <span className="mt-len">{fmtClipLen(p.clip.end - p.clip.start)}</span>
                  <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} title="Monter">
                    <ArrowUp />
                  </button>
                  <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === picks.length - 1} title="Descendre">
                    <ArrowDown />
                  </button>
                  <button className="icon-btn is-danger" onClick={() => setPicks((ps) => ps.filter((x) => x.key !== p.key))} title="Retirer">
                    <X />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-col">
          <div className="mt-head">
            Carton titre
            <span className="mt-total">{shown ? `clip ${picks.indexOf(shown) + 1}` : 'exemple'}</span>
          </div>
          <div className="mt-style-body">
            <CardPreview
              videoPath={shown?.videoPath ?? null}
              at={shown ? shown.clip.start : null}
              style={style}
              accent={accent}
              text={{
                title: shown ? shown.title : 'Ace',
                sub: shown ? shown.sub : 'Ascent · Jett',
                index: shown ? picks.indexOf(shown) : 2,
                total: shown ? picks.length : 7
              }}
            />
            <div className="mt-styles">
              {CARD_STYLES.map((c) => (
                <button key={c.value} className={style === c.value ? 'is-on' : ''} onClick={() => setStyle(c.value)} title={c.hint}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className={`mt-accents ${noAccent ? 'is-off' : ''}`}>
              <span>Couleur</span>
              {CARD_ACCENTS.map((c) => (
                <button
                  key={c}
                  className={accent === c ? 'is-on' : ''}
                  style={{ background: c }}
                  onClick={() => setAccent(c)}
                  disabled={noAccent}
                  aria-label={`Couleur ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="mt-options">
            <div className="field">
              <label>Transition</label>
              <div className="segmented">
                {TRANSITIONS.map((t) => (
                  <button key={t.value} className={transition === t.value ? 'is-on' : ''} onClick={() => setTransition(t.value)}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Nom du fichier (optionnel)"
            />
            {error && <div className="mp-error">{error}</div>}
            <button className="btn btn-primary btn-block" disabled={!picks.length || busy} onClick={exportMontage}>
              {busy ? 'Préparation…' : 'Exporter le montage'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
