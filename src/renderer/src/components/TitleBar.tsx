import { useEffect, useState } from 'react'
import { ChevronLeft, Keyboard, Settings, Download, Sparkles } from '../lib/icons'
import { tr } from '@shared/i18n'
import { useApp } from '../store'
import { baseName, fmtDuration, stripExt } from '../lib/format'

/** The app icon (build/icon.png) as a small tile: the F and its red bar on the graphite square */
export function Logo(): JSX.Element {
  return (
    <svg className="logo" viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="logo-tile" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#232325" />
          <stop offset="1" stopColor="#121213" />
        </linearGradient>
      </defs>
      <rect x=".5" y=".5" width="23" height="23" rx="5.5" fill="url(#logo-tile)" stroke="#ededed" strokeOpacity=".1" />
      <g transform="translate(4.4 4.6) scale(.64)">
        <path d="M5 4h14l-3 4H9.6l-.8 3H14l-2.6 4H7.7L6 20H2L5 4z" fill="#ededed" />
        <path d="M17 13h5l-1.5 7h-5z" fill="var(--accent)" />
      </g>
    </svg>
  )
}

/** OBS auto-record state: only shown when the feature is on */
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
  let text = tr('OBS ready', 'OBS prêt')
  if (a.obs === 'connecting' || a.obs === 'off') {
    text = tr('Connecting to OBS…', 'Connexion à OBS…')
  } else if (a.obs !== 'ready') {
    tone = 'is-warn'
    text = a.obs === 'auth' ? tr('OBS password', 'Mot de passe OBS') : tr('OBS disconnected', 'OBS déconnecté')
  } else if (a.stopAt) {
    tone = 'is-rec'
    text = `${tr('Stopping in', 'Arrêt dans')} ${Math.max(0, Math.ceil((a.stopAt - now) / 1000))} s`
  } else if (a.recording) {
    tone = 'is-rec'
    text = a.recStartedAt ? `REC ${fmtDuration(Math.max(0, (now - a.recStartedAt) / 1000))}` : 'REC'
  } else if (a.game === 'pregame') {
    text = tr('Agent select', 'Sélection d’agent')
  } else if (a.game === 'ingame') {
    text = tr('In game', 'En game')
  } else if (a.game === 'menus') {
    text = tr('Valorant open', 'Valorant ouvert')
  }
  const tip = [a.obsError, a.last, a.obsVersion ? `OBS WebSocket ${a.obsVersion}` : null].filter(Boolean).join('\n')
  return (
    <button className={`rec-pill ${tone}`} onClick={() => setSettingsOpen(true)} title={tip || tr('Auto-record', 'Enregistrement auto')}>
      <span className="rec-dot" />
      <span>{text}</span>
    </button>
  )
}

export default function TitleBar(): JSX.Element {
  const { view, videoPath, closeVideo, setView, jobs, setExportsOpen, setSettingsOpen, setShortcutsOpen, setWhatsNewOpen, settings } =
    useApp()
  const unseen = !!settings && settings.lastSeenVersion !== window.frag.version
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
            <button className="crumb-back" onClick={closeVideo} title={tr('Back to library (Esc)', 'Retour à la bibliothèque (Échap)')}>
              <ChevronLeft size={16} />
              {tr('Library', 'Bibliothèque')}
            </button>
            <span className="crumb-current" title={videoPath}>
              {stripExt(baseName(videoPath))}
            </span>
          </>
        )}
      </div>
      <div className="titlebar-right">
        <RecPill />
        <button
          className={`tb-btn tb-news ${unseen ? 'is-new' : ''}`}
          onClick={() => setWhatsNewOpen(true)}
          title={tr('What’s new', 'Nouveautés')}
        >
          <Sparkles size={16} />
          {unseen && <span>{tr('What’s new', 'Nouveautés')}</span>}
        </button>
        <button className="tb-btn" onClick={() => setShortcutsOpen(true)} title={tr('Keyboard shortcuts (?)', 'Raccourcis clavier (?)')}>
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
        <button className="tb-btn" onClick={() => setSettingsOpen(true)} title={tr('Settings', 'Réglages')}>
          <Settings size={16} />
        </button>
      </div>
    </header>
  )
}
