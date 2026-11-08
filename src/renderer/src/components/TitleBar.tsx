import { useEffect, useState } from 'react'
import { ChevronLeft, Keyboard, Settings, Download } from 'lucide-react'
import { useApp } from '../store'
import { baseName, fmtDuration, stripExt } from '../lib/format'

export function Logo(): JSX.Element {
  return (
    <svg className="logo" viewBox="0 0 24 24" aria-hidden>
      <path d="M5 4h14l-3 4H9.6l-.8 3H14l-2.6 4H7.7L6 20H2L5 4z" fill="currentColor" />
      <path d="M17 13h5l-1.5 7h-5z" fill="var(--accent)" />
    </svg>
  )
}

/** État du pilotage OBS : visible seulement s'il est activé */
function RecPill(): JSX.Element | null {
  const { autoRec: a, setSettingsOpen } = useApp()
  const [now, setNow] = useState(Date.now())
  const ticking = !!a && (a.recording || a.stopAt !== null)
  useEffect(() => {
    if (!ticking) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [ticking])
  if (!a?.enabled) return null

  let tone = 'is-idle'
  let text = 'OBS prêt'
  if (a.obs === 'connecting' || a.obs === 'off') {
    text = 'Connexion à OBS…'
  } else if (a.obs !== 'ready') {
    tone = 'is-warn'
    text = a.obs === 'auth' ? 'Mot de passe OBS' : 'OBS déconnecté'
  } else if (a.stopAt) {
    tone = 'is-rec'
    text = `Arrêt dans ${Math.max(0, Math.ceil((a.stopAt - now) / 1000))} s`
  } else if (a.recording) {
    tone = 'is-rec'
    text = a.recStartedAt ? `REC ${fmtDuration(Math.max(0, (now - a.recStartedAt) / 1000))}` : 'REC'
  } else if (a.game === 'pregame') {
    text = 'Sélection d’agent'
  } else if (a.game === 'ingame') {
    text = 'En game'
  } else if (a.game === 'menus') {
    text = 'Valorant ouvert'
  }
  const tip = [a.obsError, a.last, a.obsVersion ? `OBS WebSocket ${a.obsVersion}` : null].filter(Boolean).join('\n')
  return (
    <button className={`rec-pill ${tone}`} onClick={() => setSettingsOpen(true)} title={tip || 'Enregistrement auto'}>
      <span className="rec-dot" />
      <span>{text}</span>
    </button>
  )
}

export default function TitleBar(): JSX.Element {
  const { view, videoPath, closeVideo, setView, jobs, setExportsOpen, setSettingsOpen, setShortcutsOpen } = useApp()
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued')
  const running = jobs.find((j) => j.status === 'running')
  const finished = jobs.filter((j) => j.status === 'done').length

  return (
    <header className="titlebar">
      <div className="titlebar-left">
        <div className="brand">
          <Logo />
          <span>Frag</span>
        </div>
        {view !== 'editor' && (
          <nav className="tb-nav">
            <button className={view === 'library' ? 'is-on' : ''} onClick={() => setView('library')}>
              Recs
            </button>
            <button className={view === 'stats' ? 'is-on' : ''} onClick={() => setView('stats')}>
              Stats
            </button>
          </nav>
        )}
        {view === 'editor' && videoPath && (
          <>
            <span className="crumb-sep" />
            <button className="crumb-back" onClick={closeVideo} title="Retour à la bibliothèque (Échap)">
              <ChevronLeft size={16} />
              Bibliothèque
            </button>
            <span className="crumb-current" title={videoPath}>
              {stripExt(baseName(videoPath))}
            </span>
          </>
        )}
      </div>
      <div className="titlebar-right">
        <RecPill />
        <button className="tb-btn" onClick={() => setShortcutsOpen(true)} title="Raccourcis clavier (?)">
          <Keyboard size={16} />
        </button>
        <button className={`tb-btn tb-exports ${active.length ? 'is-active' : ''}`} onClick={() => setExportsOpen(true)}>
          <Download size={16} />
          <span>Exports</span>
          {active.length > 0 ? (
            <span className="tb-count">{active.length}</span>
          ) : finished > 0 ? (
            <span className="tb-count is-done">{finished}</span>
          ) : null}
          {running && <span className="tb-progress" style={{ width: `${Math.round(running.progress * 100)}%` }} />}
        </button>
        <button className="tb-btn" onClick={() => setSettingsOpen(true)} title="Réglages">
          <Settings size={16} />
        </button>
      </div>
    </header>
  )
}
