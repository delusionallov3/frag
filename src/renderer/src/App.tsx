import { useEffect, useState } from 'react'
import { useApp } from './store'
import { useAssets } from './lib/assets'
import TitleBar from './components/TitleBar'
import Library from './components/Library'
import StatsPage from './components/StatsPage'
import Editor from './components/Editor'
import ExportsDrawer from './components/ExportsDrawer'
import SettingsModal from './components/SettingsModal'
import ShortcutsModal from './components/ShortcutsModal'
import MontageModal from './components/MontageModal'
import Toast from './components/Toast'

const VIDEO_RE = /\.(mp4|mkv|mov|m4v|webm)$/i

export default function App(): JSX.Element {
  const { init, settings, view, videoPath, openVideo } = useApp()
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    void init()
    void useAssets.getState().load()
  }, [init])

  // Clic sur une notification Windows (fin de game, OBS pas lancé)
  useEffect(() => {
    const offVideo = window.frag.onOpenVideo((p) => openVideo(p))
    const offSettings = window.frag.onOpenSettings(() => useApp.getState().setSettingsOpen(true))
    return () => {
      offVideo()
      offSettings()
    }
  }, [openVideo])

  // Glisser-déposer une vidéo n'importe où dans la fenêtre
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = (): void => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent): void => e.preventDefault()
    const drop = (e: DragEvent): void => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) => VIDEO_RE.test(f.name))
      if (file) openVideo(window.frag.pathForFile(file))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [openVideo])

  return (
    <div className={`app platform-${window.frag.platform}`}>
      <TitleBar />
      <main className="app-main">
        {!settings ? null : view === 'editor' && videoPath ? (
          <Editor key={videoPath} path={videoPath} />
        ) : view === 'stats' ? (
          <StatsPage />
        ) : (
          <Library />
        )}
      </main>
      <ExportsDrawer />
      <SettingsModal />
      <ShortcutsModal />
      <MontageModal />
      <Toast />
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">Lâche ta vidéo pour l’ouvrir</div>
        </div>
      )}
    </div>
  )
}
