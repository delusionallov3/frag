import { create } from 'zustand'
import type { AutoRecStatus, EncoderInfo, ExportJob, Settings } from '@shared/types'

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
  toast: null,
  autoRec: null,

  init: async () => {
    const [settings, jobs] = await Promise.all([window.frag.getSettings(), window.frag.listJobs()])
    set({ settings, jobs })
    window.frag.onJobs((jobs) => set({ jobs }))
    window.frag.autoRecStatus().then((autoRec) => set({ autoRec }))
    window.frag.onAutoRecStatus((autoRec) => set({ autoRec }))
    window.frag.encoders().then((encoders) => set({ encoders }))
  },
  updateSettings: async (patch) => {
    const cur = get().settings
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
  showToast: (text, action) => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast: { id: Date.now(), text, action } })
    toastTimer = setTimeout(() => set({ toast: null }), 4200)
  }
}))
