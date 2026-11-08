import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, Search, Film, FileVideo, AlertTriangle, Scissors, Clapperboard, Trash2 } from 'lucide-react'
import type { CardInfo, VideoEntry } from '@shared/types'
import { tr } from '@shared/i18n'
import { useApp } from '../store'
import { useLookup } from '../lib/assets'
import VImg from './VImg'
import Modal from './Modal'
import { dayKey, dayLabel, fmtDuration, fmtSize, hourLabel, mediaUrl, stripExt } from '../lib/format'

const cardCache = new Map<string, CardInfo>()

function MatchRow({
  v,
  short,
  onOpen,
  onTrash
}: {
  v: VideoEntry
  short: boolean
  onOpen: () => void
  onTrash: () => void
}): JSX.Element {
  const key = `${v.path}|${v.size}|${v.mtime}`
  const [info, setInfo] = useState<CardInfo | null>(cardCache.get(key) ?? null)
  const ref = useRef<HTMLButtonElement>(null)
  const L = useLookup()

  useEffect(() => {
    if (info) return
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        window.frag.card(v.path).then((res) => {
          cardCache.set(key, res)
          setInfo(res)
        })
      },
      { rootMargin: '300px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [info, key, v.path])

  const meta = info?.meta
  const m = v.match
  const map = m ? L.map(m.mapId, m.map) : null
  const agent = m ? L.agent(m.agentId, m.agent) : null
  const tier = m ? L.tier(m.tier, m.rank) : null
  const result = m?.won === true ? 'is-win' : m?.won === false ? 'is-loss' : ''

  return (
    <div className="mrow-wrap">
    <button ref={ref} className={`mrow ${m ? 'is-linked' : ''} ${short ? 'is-short' : ''} ${result}`} onClick={onOpen} title={v.path}>
      {map?.listView && <VImg src={map.listView} className="mrow-banner" />}
      <span className="mrow-edge" />

      <div className="mrow-thumb">
        {info?.poster ? (
          <img src={mediaUrl(info.poster)} alt="" draggable={false} />
        ) : info?.error ? (
          <AlertTriangle size={16} className="mrow-thumb-err" />
        ) : (
          <div className="skeleton" />
        )}
        {meta && <span className="mrow-duration">{fmtDuration(meta.duration)}</span>}
      </div>

      <div className="mrow-agent">
        {agent ? <VImg src={agent.icon} className="mrow-agent-img" /> : <Film size={16} />}
      </div>

      <div className="mrow-info">
        <div className="mrow-title">{m ? m.map : stripExt(v.name)}</div>
        <div className="mrow-sub">
          {m ? (
            <>
              <span>{m.agent}</span>
              <span>{m.mode}</span>
            </>
          ) : (
            <span>{short ? tr('Short rec, not linked', 'Rec courte, pas liée') : tr('Not linked to a match yet', 'Pas encore liée à un match')}</span>
          )}
          {short && m && <span className="mrow-short">{tr('Short rec', 'Rec courte')}</span>}
          <span>{hourLabel(v.mtime)}</span>
          <span>{fmtSize(v.size)}</span>
          {meta && meta.height > 0 && (
            <span>
              {meta.height}p{Math.round(meta.fps)}
            </span>
          )}
        </div>
      </div>

      {m ? (
        <>
          <div className="mrow-stat">
            <span className="mrow-figure">
              {m.kills}
              <i>/</i>
              {m.deaths}
              <i>/</i>
              {m.assists}
            </span>
            <span className="mrow-label">K / D / A</span>
          </div>
          <div className={`mrow-stat mrow-score ${result}`}>
            <span className="mrow-figure">{m.score || '–'}</span>
            <span className="mrow-label">{m.won === true ? tr('Win', 'Victoire') : m.won === false ? tr('Loss', 'Défaite') : 'Score'}</span>
          </div>
          <div className="mrow-rank" title={tier?.name ?? m.rank ?? ''}>
            {tier?.icon ? <VImg src={tier.icon} className="mrow-rank-img" /> : null}
          </div>
        </>
      ) : (
        <>
          <span />
          <span />
          <span />
        </>
      )}

      <div className="mrow-clips">
        {v.clipCount > 0 ? (
          <>
            <Scissors size={14} />
            <span>{v.clipCount}</span>
          </>
        ) : null}
      </div>
    </button>
      <button
        className="mrow-trash"
        title={tr('Move to Recycle Bin', 'Mettre à la corbeille')}
        onClick={(e) => {
          e.stopPropagation()
          onTrash()
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

export default function Library(): JSX.Element {
  const { settings, updateSettings, openVideo } = useApp()
  const [videos, setVideos] = useState<VideoEntry[] | null>(null)
  const [query, setQuery] = useState('')

  const folder = settings?.recsFolder ?? null

  useEffect(() => {
    let alive = true
    const load = (): void => {
      window.frag.listVideos().then((list) => alive && setVideos(list))
    }
    load()
    const off = window.frag.onLibraryChanged(load)
    return () => {
      alive = false
      off()
    }
  }, [folder])

  const minShort = (settings?.minLinkMinutes ?? 5) * 60
  const isShort = (v: VideoEntry): boolean => v.duration !== null && v.duration < minShort
  const hideShort = settings?.hideShortRecs ?? false
  const shortCount = (videos ?? []).filter(isShort).length
  const [trash, setTrash] = useState<VideoEntry | null>(null)
  const [trashError, setTrashError] = useState<string | null>(null)
  const confirmTrash = async (): Promise<void> => {
    if (!trash) return
    const res = await window.frag.trashVideo(trash.path)
    if (res.ok) {
      setVideos((list) => list?.filter((x) => x.path !== trash.path) ?? null)
      setTrash(null)
      useApp.getState().showToast(tr(`“${stripExt(trash.name)}” moved to the Recycle Bin`, `« ${stripExt(trash.name)} » mise à la corbeille`))
    } else setTrashError(res.error)
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = (videos ?? []).filter(
      (v) => (!q || v.name.toLowerCase().includes(q)) && !(hideShort && v.duration !== null && v.duration < minShort)
    )
    const map = new Map<number, VideoEntry[]>()
    for (const v of list) {
      const k = dayKey(v.mtime)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(v)
    }
    return [...map.entries()].map(([k, items]) => ({ key: k, label: dayLabel(k), items }))
  }, [videos, query, hideShort, minShort])

  const pickFolder = async (): Promise<void> => {
    const p = await window.frag.pickFolder(tr('Pick the folder where OBS saves your recordings', 'Choisis le dossier où OBS enregistre tes recs'))
    if (p) {
      setVideos(null)
      await updateSettings({ recsFolder: p })
    }
  }

  const openFile = async (): Promise<void> => {
    const p = await window.frag.pickVideo()
    if (p) openVideo(p)
  }

  if (!folder) {
    return (
      <div className="empty-hero">
        <div className="empty-icon">
          <Film size={28} />
        </div>
        <h1>{tr('Connect your recordings folder', 'Branche ton dossier de recs')}</h1>
        <p>
          {tr(
            'Pick the folder where OBS saves your games. Frag watches it: every new recording shows up here as soon as you stop recording.',
            'Choisis le dossier où OBS enregistre tes games. Frag le surveille : chaque nouvelle rec apparaît ici toute seule dès que tu arrêtes l’enregistrement.'
          )}
        </p>
        <div className="row gap-8">
          <button className="btn btn-primary btn-lg" onClick={pickFolder}>
            <FolderOpen size={16} />
            {tr('Choose folder', 'Choisir le dossier')}
          </button>
          <button className="btn btn-ghost btn-lg" onClick={openFile}>
            <FileVideo size={16} />
            {tr('Open a file', 'Ouvrir un fichier')}
          </button>
        </div>
        <span className="hint">{tr('You can also drop a video onto the window', 'Tu peux aussi glisser une vidéo dans la fenêtre')}</span>
      </div>
    )
  }

  const total = videos?.length ?? 0
  const linked = videos?.filter((v) => v.match).length ?? 0
  const clips = videos?.reduce((n, v) => n + v.clipCount, 0) ?? 0

  return (
    <div className="library">
      <div className="library-head">
        <div className="library-title">
          <h1>{tr('Your recordings', 'Tes recs')}</h1>
          <div className="library-meta">
            {videos && (
              <span className="library-counts">
                {total} {total === 1 ? 'rec' : 'recs'} · {linked}{' '}
                {linked === 1 ? tr('linked match', 'match lié') : tr('linked matches', 'matchs liés')} · {clips}{' '}
                {clips === 1 ? 'clip' : 'clips'}
              </span>
            )}
            <button className="folder-chip" onClick={pickFolder} title={tr('Change folder', 'Changer de dossier')}>
              <FolderOpen size={14} />
              <span>{folder}</span>
            </button>
            {shortCount > 0 && (
              <button
                className="folder-chip"
                onClick={() => updateSettings({ hideShortRecs: !hideShort })}
                title={tr(
                  `Recordings under ${settings?.minLinkMinutes ?? 5} min (change it in Settings)`,
                  `Recs de moins de ${settings?.minLinkMinutes ?? 5} min (réglable dans les réglages)`
                )}
              >
                {hideShort
                  ? tr(`Show ${shortCount} short recs`, `Afficher les ${shortCount} recs courtes`)
                  : tr(`Hide short recs (${shortCount})`, `Masquer les recs courtes (${shortCount})`)}
              </button>
            )}
          </div>
        </div>
        <div className="row gap-8">
          <label className="search">
            <Search size={15} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Search', 'Rechercher')} spellCheck={false} />
          </label>
          <button className="btn btn-ghost" onClick={() => useApp.getState().setMontageOpen(true)}>
            <Clapperboard size={15} />
            Montage
          </button>
          <button className="btn btn-ghost" onClick={openFile}>
            <FileVideo size={15} />
            {tr('Open a file', 'Ouvrir un fichier')}
          </button>
        </div>
      </div>

      {videos === null ? (
        <div className="mlist">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="mrow is-placeholder">
              <div className="mrow-thumb">
                <div className="skeleton" />
              </div>
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <div className="empty-inline">
          <Film size={22} />
          <div>
            <strong>{tr('No recordings in this folder yet', 'Aucune rec dans ce dossier pour l’instant')}</strong>
            <span>
              {tr(
                'Play a game with OBS recording, it will show up here as soon as the recording ends.',
                'Lance une game avec OBS, elle apparaîtra ici dès la fin de l’enregistrement.'
              )}
            </span>
          </div>
        </div>
      ) : groups.length === 0 ? (
        <div className="empty-inline">
          <Search size={20} />
          <div>
            <strong>{tr(`Nothing matches “${query}”`, `Rien ne correspond à « ${query} »`)}</strong>
          </div>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="day">
            <h2>
              {g.label}
              <span>{g.items.length}</span>
            </h2>
            <div className="mlist">
              {g.items.map((v) => (
                <MatchRow
                  key={v.path}
                  v={v}
                  short={isShort(v)}
                  onOpen={() => openVideo(v.path)}
                  onTrash={() => {
                    setTrashError(null)
                    setTrash(v)
                  }}
                />
              ))}
            </div>
          </section>
        ))
      )}

      <Modal open={!!trash} title={tr('Move to Recycle Bin?', 'Mettre à la corbeille ?')} onClose={() => setTrash(null)} width={460}>
        {trash && (
          <div className="confirm">
            <p>
              <strong>{trash.name}</strong>
              {trash.duration !== null && ` · ${fmtDuration(trash.duration)}`}
              {trash.match && ` · ${trash.match.map}`}
            </p>
            <p className="confirm-sub">
              {tr(
                'The video goes to the Windows Recycle Bin (you can restore it). Frag forgets its clips and linked match; clips you already exported are not touched.',
                'La vidéo part dans la corbeille de Windows (tu peux la restaurer). Ses clips et son match lié sont oubliés par Frag ; les clips déjà exportés ne sont pas touchés.'
              )}
            </p>
            {trashError && <p className="confirm-err">{trashError}</p>}
            <div className="row gap-8 confirm-actions">
              <button className="btn btn-ghost" onClick={() => setTrash(null)}>
                {tr('Cancel', 'Annuler')}
              </button>
              <button className="btn btn-danger" onClick={() => void confirmTrash()} autoFocus>
                <Trash2 size={14} />
                {tr('Move to Recycle Bin', 'Mettre à la corbeille')}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
