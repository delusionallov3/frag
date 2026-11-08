import { useEffect, useRef, useState } from 'react'
import { Play, Trash2, Download, Scissors, FolderOpen, Check } from 'lucide-react'
import type { AudioMode, Clip, ExportMode, ExportQuality } from '@shared/types'
import { useApp } from '../store'
import { fmtClipLen, fmtTime } from '../lib/format'

interface Props {
  clips: Clip[]
  selectedId: string | null
  excluded: Set<string>
  audioTracks: number
  onSelect: (id: string) => void
  onPlay: (clip: Clip) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onToggle: (id: string) => void
  onToggleAll: (include: boolean) => void
  onExport: (clips: Clip[]) => void
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <div className={`segmented ${disabled ? 'is-disabled' : ''}`}>
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? 'is-on' : ''}
          onClick={() => onChange(o.value)}
          title={o.title}
          disabled={disabled}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ClipRow({
  clip,
  index,
  selected,
  included,
  p
}: {
  clip: Clip
  index: number
  selected: boolean
  included: boolean
  p: Props
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(clip.name)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = (): void => {
    const name = draft.trim()
    if (name && name !== clip.name) p.onRename(clip.id, name)
    else setDraft(clip.name)
    setEditing(false)
  }

  return (
    <div ref={ref} className={`clip-row ${selected ? 'is-sel' : ''}`} onClick={() => p.onSelect(clip.id)}>
      <button
        className={`check ${included ? 'is-on' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          p.onToggle(clip.id)
        }}
        title={included ? 'Inclus dans l’export' : 'Exclu de l’export'}
      >
        {included && <Check size={11} strokeWidth={3} />}
      </button>
      <div className="clip-main">
        {editing ? (
          <input
            ref={inputRef}
            className="clip-name-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(clip.name)
                setEditing(false)
              }
              e.stopPropagation()
            }}
            spellCheck={false}
          />
        ) : (
          <div
            className="clip-name"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setDraft(clip.name)
              setEditing(true)
            }}
            title="Double-clic pour renommer"
          >
            <span className="clip-index">{index + 1}</span>
            {clip.name}
          </div>
        )}
        <div className="clip-times">
          {fmtTime(clip.start)} → {fmtTime(clip.end)}
        </div>
      </div>
      <span className="clip-len">{fmtClipLen(clip.end - clip.start)}</span>
      <div className="clip-actions">
        <button
          className="icon-btn"
          title="Lire le clip"
          onClick={(e) => {
            e.stopPropagation()
            p.onPlay(clip)
          }}
        >
          <Play size={14} />
        </button>
        <button
          className="icon-btn"
          title="Exporter ce clip"
          onClick={(e) => {
            e.stopPropagation()
            p.onExport([clip])
          }}
        >
          <Download size={14} />
        </button>
        <button
          className="icon-btn is-danger"
          title="Supprimer (Suppr)"
          onClick={(e) => {
            e.stopPropagation()
            p.onDelete(clip.id)
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

export default function ClipPanel(p: Props): JSX.Element {
  const { settings, updateSettings, encoders } = useApp()
  const [outFolder, setOutFolder] = useState<string | null>(null)

  useEffect(() => {
    window.frag.outputFolder().then(setOutFolder)
  }, [settings?.outputFolder, settings?.recsFolder])

  const included = p.clips.filter((c) => !p.excluded.has(c.id))
  const allOn = included.length === p.clips.length

  if (!settings) return <div className="side-pane" />
  const mode = settings.exportMode
  const nvenc = encoders?.nvenc && settings.encoder !== 'cpu'

  return (
    <div className="side-pane">
      {p.clips.length > 1 && (
        <div className="side-sub">
          <span>
            {included.length} / {p.clips.length} cochés pour l’export
          </span>
          <button className="link-btn" onClick={() => p.onToggleAll(!allOn)}>
            {allOn ? 'Tout décocher' : 'Tout cocher'}
          </button>
        </div>
      )}

      <div className="clip-list">
        {p.clips.length === 0 ? (
          <div className="clip-empty">
            <div className="clip-empty-icon">
              <Scissors size={18} />
            </div>
            <strong>Pas encore de clip</strong>
            <p>
              Regarde ta game, et au moment d’une action appuie sur <kbd>C</kbd> : ça crée un clip des 10 dernières
              secondes.
            </p>
            <p>
              Ajuste ensuite le début avec <kbd>I</kbd> et la fin avec <kbd>O</kbd>, ou tire les bords sur la timeline.
            </p>
          </div>
        ) : (
          p.clips.map((c, i) => (
            <ClipRow
              key={c.id}
              clip={c}
              index={i}
              selected={c.id === p.selectedId}
              included={!p.excluded.has(c.id)}
              p={p}
            />
          ))
        )}
      </div>

      <div className="export-box">
        <div className="field">
          <label>Méthode</label>
          <Segmented<ExportMode>
            value={mode}
            onChange={(v) => updateSettings({ exportMode: v })}
            options={[
              {
                value: 'precise',
                label: nvenc ? 'Précise · NVENC' : 'Précise',
                title: 'Coupe à l’image près, réencodée (très rapide avec ta carte Nvidia)'
              },
              {
                value: 'fast',
                label: 'Instantanée',
                title: 'Aucun réencodage : qualité d’origine, mais la coupe se cale sur l’image clé la plus proche'
              }
            ]}
          />
        </div>
        <div className="field">
          <label>Qualité</label>
          <Segmented<ExportQuality>
            value={settings.quality}
            disabled={mode === 'fast'}
            onChange={(v) => updateSettings({ quality: v })}
            options={[
              { value: 'high', label: 'Haute' },
              { value: 'balanced', label: 'Équilibrée' },
              { value: 'light', label: 'Légère' }
            ]}
          />
        </div>
        <div className="field">
          <label>
            Audio
            {p.audioTracks > 1 && <span className="field-note">{p.audioTracks} pistes détectées</span>}
          </label>
          <Segmented<AudioMode>
            value={settings.audio}
            onChange={(v) => updateSettings({ audio: v })}
            options={[
              { value: 'all', label: 'Toutes', title: 'Garde toutes les pistes séparées' },
              { value: 'first', label: 'Piste 1', title: 'Seulement la première piste' },
              { value: 'mix', label: 'Mixer', title: 'Fusionne toutes les pistes en une seule' }
            ]}
          />
        </div>

        <button
          className="btn btn-primary btn-block"
          disabled={included.length === 0}
          onClick={() => p.onExport(included)}
        >
          <Download size={16} />
          {included.length <= 1 ? 'Exporter le clip' : `Exporter ${included.length} clips`}
          <kbd className="kbd-inline">⇧E</kbd>
        </button>
        {outFolder && (
          <button className="out-folder" onClick={() => window.frag.openFolder(outFolder)} title={outFolder}>
            <FolderOpen size={13} />
            <span>{outFolder}</span>
          </button>
        )}
      </div>
    </div>
  )
}
