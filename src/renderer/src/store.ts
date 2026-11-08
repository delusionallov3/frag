import { create } from 'zustand'
import type { AutoRecStatus, EncoderInfo, ExportJob, Settings } from '@shared/types'
import { setLang, tr } from '@shared/i18n'

interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

interface AppState {
  settings: Settings | null
  encoders: EncoderInfo | null
  view: 'library' | 'editor' | 'stats'
  videoPath: string | null
  jobs: ExportJob[]
  exportsOpen: boolean
  settingsOpen: boolean
  shortcutsOpen: boolean
  montageOpen: boolean
  whatsNewOpen: boolean
  toast: Toast | null
  autoRec: AutoRecStatus | null

  init: () => Promise<void>
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  openVideo: (path: string) => void
  closeVideo: () => void
  setView: (v: 'library' | 'stats') => void
  setJobs: (jobs: ExportJob[]) => void
  setExportsOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  setShortcutsOpen: (v: boolean) => void
  setMontageOpen: (v: boolean) => void
  setWhatsNewOpen: (v: boolean) => void
  showToast: (text: string, action?: Toast['action']) => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useApp = create<AppState>((set, get) => ({
  settings: null,
  encoders: null,
  view: 'library',
  videoPath: null,
  jobs: [],
  exportsOpen: false,
  settingsOpen: false,
  shortcutsOpen: false,
  montageOpen: false,
  whatsNewOpen: false,
  toast: null,
  autoRec: null,

  init: async () => {
    const [settings, jobs] = await Promise.all([window.frag.getSettings(), window.frag.listJobs()])
    setLang(settings.language)
    document.documentElement.lang = settings.language
    set({ settings, jobs })
    window.frag.onJobs((jobs) => {
      // an export that just finished: say so, with a one-click copy for Discord
      const before = new Map(get().jobs.map((j) => [j.id, j.status]))
      const fresh = jobs.filter((j) => j.status === 'done' && before.get(j.id) === 'running')
      set({ jobs })
      const j = fresh[fresh.length - 1]
      if (j)
        get().showToast(tr(`Exported: ${j.clipName}`, `Exporté : ${j.clipName}`), {
          label: tr('Copy file', 'Copier le fichier'),
          run: () => void copyExport(j.outputPath)
        })
    })
    window.frag.autoRecStatus().then((autoRec) => set({ autoRec }))
    window.frag.onAutoRecStatus((autoRec) => set({ autoRec }))
    window.frag.encoders().then((encoders) => set({ encoders }))
  },
  updateSettings: async (patch) => {
    const cur = get().settings
    if (patch.language) {
      setLang(patch.language)
      document.documentElement.lang = patch.language
    }
    if (cur) set({ settings: { ...cur, ...patch } })
    const settings = await window.frag.setSettings(patch)
    set({ settings })
  },
  openVideo: (path) => set({ view: 'editor', videoPath: path }),
  closeVideo: () => set({ view: 'library', videoPath: null }),
  setView: (view) => set({ view, videoPath: null }),
  setJobs: (jobs) => set({ jobs }),
  setExportsOpen: (exportsOpen) => set({ exportsOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setMontageOpen: (montageOpen) => set({ montageOpen }),
  setWhatsNewOpen: (whatsNewOpen) => set({ whatsNewOpen }),
  showToast: (text, action) => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: { id: Date.now(), text, action } })
    toastTimer = setTimeout(() => set({ toast: null }), 4200)
  }
}))

/** Copies an exported file to the clipboard (paste it straight into Discord) and says so */
export async function copyExport(path: string): Promise<void> {
  const ok = await window.frag.copyFile(path)
  useApp.getState().showToast(ok ? tr('File copied: paste it in Discord or a chat', 'Fichier copié : colle-le dans Discord ou un chat') : tr('Couldn’t copy the file', 'Impossible de copier le fichier'))
}
