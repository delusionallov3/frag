import { useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight, Play, Pause, Repeat } from '../lib/icons'
import type { MatchLink, ReviewNote } from '@shared/types'
import { tr } from '@shared/i18n'
import { GOOD_TAG, REVIEW_TAGS, reviewLists, tagLabel, type ReviewItem, type ReviewKind, type MatchInsights } from '../lib/review'
import { keyCap } from '../lib/keys'
import { useLookup } from '../lib/assets'
import VImg from './VImg'

interface Props {
  link: MatchLink | null
  data: MatchInsights | null
  kind: ReviewKind
  index: number
  auto: boolean
  playing: boolean
  notes: Record<string, ReviewNote>
  onKind: (k: ReviewKind) => void
  onPlay: (index: number) => void
  onTogglePlay: () => void
  onAuto: (v: boolean) => void
  onNote: (key: string, note: ReviewNote) => void
  onGoMatch: () => void
}

function ItemRow({
  item,
  i,
  active,
  note,
  p
}: {
  item: ReviewItem
  i: number
  active: boolean
  note: ReviewNote | undefined
  p: Props
}): JSX.Element {
  const L = useLookup()
  const ref = useRef<HTMLDivElement>(null)
  const agent = item.other ? L.agent(item.other.agentId, item.other.agent) : null
  const weapon = item.weapon ? L.weapon(item.weaponId, item.weapon) : null
  const tags = note?.tags ?? []

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const toggleTag = (t: string): void => {
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]
    p.onNote(item.key, { tags: next, note: note?.note ?? '' })
  }

  return (
    <div ref={ref} className={`rv-item ${active ? 'is-active' : ''}`}>
      <button className="rv-row" onClick={() => p.onPlay(i)}>
        <span className="rv-index">{i + 1}</span>
        {agent ? <VImg src={agent.icon} className="rv-agent" /> : <span className="rv-agent is-empty" />}
        <span className="rv-main">
          <span className="rv-title">{item.title}</span>
          <span className="rv-sub">{item.sub}</span>
        </span>
        {weapon?.killfeed ? <VImg src={weapon.killfeed} className="rv-weapon" /> : null}
        {tags.length > 0 && !active && <span className="rv-tagcount">{tags.length}</span>}
      </button>
      {active && (
        <div className="rv-notes">
          <div className="rv-tags">
            {REVIEW_TAGS.map((t) => (
              <button
                key={t}
                className={`rv-tag ${tags.includes(t) ? 'is-on' : ''} ${t === GOOD_TAG ? 'is-good' : ''}`}
                onClick={() => toggleTag(t)}
              >
                {tagLabel(t)}
              </button>
            ))}
          </div>
          <textarea
            className="input rv-text"
            placeholder={tr('What you should have done', 'Ce que tu aurais dû faire')}
            value={note?.note ?? ''}
            onChange={(e) => p.onNote(item.key, { tags, note: e.target.value })}
            onKeyDown={(e) => e.stopPropagation()}
            rows={2}
          />
        </div>
      )}
    </div>
  )
}

export default function ReviewPanel(p: Props): JSX.Element {
  if (!p.link || !p.data) {
    return (
      <div className="side-pane">
        <div className="clip-empty">
          <strong>{tr('Link this recording to its match first', 'Lie d’abord cette rec à son match')}</strong>
          <p>
            {tr(
              'Review mode uses the match’s kills and rounds to show you your deaths and mistakes.',
              'Le mode Revoir utilise les kills et les rounds du match pour te montrer tes morts et tes erreurs.'
            )}
          </p>
          <button className="btn btn-ghost btn-sm" onClick={p.onGoMatch}>
            {tr('Go to the Match tab', 'Aller à l’onglet Match')}
          </button>
        </div>
      </div>
    )
  }

  const counts = new Map<ReviewKind, number>()
  for (const it of p.data.items) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1)
  const list = p.data.items.filter((it) => it.kind === p.kind)
  const lists = reviewLists()
  const current = lists.find((l) => l.kind === p.kind)!
  const d = p.data

  return (
    <div className="side-pane rv">
      <div className="rv-summary">
        <div>
          <b>
            {d.firstBloods}
            <i>/</i>
            {d.firstDeaths}
          </b>
          <span>{tr('First bloods / first deaths', 'First bloods / premières morts')}</span>
        </div>
        <div>
          <b>
            {d.deaths ? Math.round((d.untradedDeaths / d.deaths) * 100) : 0}
            <i>%</i>
          </b>
          <span>{tr('Untraded deaths', 'Morts non tradées')}</span>
        </div>
        <div>
          <b>
            {d.clutchesWon}
            <i>/</i>
            {d.clutchesWon + d.clutchesLost}
          </b>
          <span>{tr('Clutches won', 'Clutchs gagnés')}</span>
        </div>
      </div>

      <div className="rv-lists">
        {lists.map((l) => (
          <button key={l.kind} className={`rv-list ${p.kind === l.kind ? 'is-on' : ''}`} onClick={() => p.onKind(l.kind)}>
            {l.label}
            <span>{counts.get(l.kind) ?? 0}</span>
          </button>
        ))}
      </div>
      <p className="rv-hint">{current.hint}</p>

      <div className="rv-controls">
        <button className="icon-btn" title={`${tr('Previous', 'Précédent')} (,)`} onClick={() => p.onPlay(Math.max(0, p.index - 1))} disabled={!list.length}>
          <ChevronLeft />
        </button>
        <button className="btn btn-ghost btn-sm rv-play" onClick={p.onTogglePlay} disabled={!list.length}>
          {p.playing ? <Pause /> : <Play />}
          {list.length ? `${Math.min(p.index + 1, list.length)} / ${list.length}` : '0 / 0'}
        </button>
        <button
          className="icon-btn"
          title={`${tr('Next', 'Suivant')} (${keyCap('.')})`}
          onClick={() => p.onPlay(Math.min(list.length - 1, p.index + 1))}
          disabled={!list.length}
        >
          <ChevronRight />
        </button>
        <button
          className={`chip-btn rv-auto ${p.auto ? 'is-on' : ''}`}
          onClick={() => p.onAuto(!p.auto)}
          title={tr('Move on to the next one automatically when each one ends', 'Passer tout seul au suivant à la fin de chaque passage')}
        >
          <Repeat />
          {tr('Autoplay', 'Enchaîner')}
        </button>
      </div>

      <div className="rv-items">
        {list.length === 0 ? (
          <div className="rv-empty">{tr('Nothing in this list for the recorded part of the game.', 'Rien dans cette liste pour la partie enregistrée.')}</div>
        ) : (
          list.map((it, i) => (
            <ItemRow key={`${it.kind}-${it.key}`} item={it} i={i} active={i === p.index} note={p.notes[it.key]} p={p} />
          ))
        )}
      </div>
    </div>
  )
}
