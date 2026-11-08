import { useEffect, useState } from 'react'
import { FolderOpen, RotateCcw, RefreshCw } from 'lucide-react'
import { useAssets } from '../lib/assets'
import type { EncoderPref, KeyboardLayout, UpdateStatus } from '@shared/types'
import { locale, tr, type Lang } from '@shared/i18n'
import { useApp } from '../store'
import Modal from './Modal'
import { AccountsField, KeyField, RateField } from './HenrikSetup'
import { ObsSettingsSection } from './ObsSetup'

function AssetsStatus(): JSX.Element {
  const assets = useAssets((s) => s.assets)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = async (): Promise<void> => {
    setBusy(true)
    setError(await useAssets.getState().refresh())
    setBusy(false)
  }
  const date = assets ? new Date(assets.fetchedAt).toLocaleDateString(locale()) : ''
  return (
    <div className="setting">
      <div className="setting-label">
        <strong>{tr('Valorant assets', 'Visuels Valorant')}</strong>
        <span>
          {assets
            ? tr(
                `${assets.agents.length} agents, ${assets.maps.length} maps, ${assets.weapons.length} weapons, ${assets.tiers.length} ranks · updated ${date}`,
                `${assets.agents.length} agents, ${assets.maps.length} maps, ${assets.weapons.length} armes, ${assets.tiers.length} rangs · mis à jour le ${date}`
              )
            : tr('Not loaded yet.', 'Pas encore chargés.')}{' '}
          {tr('Source: valorant-api.com, cached on this PC.', 'Source : valorant-api.com, gardés en cache sur ce PC.')}
        </span>
      </div>
      <div className="row gap-8">
        <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={busy}>
          <RefreshCw size={13} className={busy ? 'spin' : ''} />
          {tr('Reload', 'Recharger')}
        </button>
        {error && (
          <span className="assets-err">
            {tr('Can’t reach valorant-api.com', 'Impossible de joindre valorant-api.com')} ({error})
          </span>
        )}
      </div>
    </div>
  )
}

function updateText(u: UpdateStatus): string {
  switch (u.state) {
    case 'dev':
      return tr('Development build: no automatic updates.', 'Mode développement : pas de mise à jour automatique.')
    case 'checking':
      return tr('Looking for a new version…', 'Recherche d’une nouvelle version…')
    case 'none':
      return tr('You’re on the latest version.', 'Tu as la dernière version.')
    case 'downloading':
      return tr(
        `Downloading ${u.version ?? 'the new version'}… ${Math.round(u.progress * 100)}%`,
        `Téléchargement de la ${u.version ?? 'nouvelle version'}… ${Math.round(u.progress * 100)} %`
      )
    case 'ready':
      return tr(
        `${u.version} is ready: it will install when you quit Frag.`,
        `La ${u.version} est prête : elle s’installera quand tu quitteras Frag.`
      )
    case 'error':
      return tr(
        `Couldn’t check for updates (${u.error ?? 'unknown error'}).`,
        `Impossible de vérifier les mises à jour (${u.error ?? 'erreur inconnue'}).`
      )
    default:
      return tr('Frag checks GitHub for new versions on its own.', 'Frag vérifie tout seul les nouvelles versions sur GitHub.')
  }
}

function UpdateSettings(): JSX.Element | null {
  const [u, setU] = useState<UpdateStatus | null>(null)
  const setWhatsNewOpen = useApp((s) => s.setWhatsNewOpen)
  useEffect(() => {
    void window.frag.updateStatus().then(setU)
    return window.frag.onUpdateStatus(setU)
  }, [])
  if (!u) return null
  const busy = u.state === 'checking' || u.state === 'downloading'
  return (
    <div className="setting">
      <div className="setting-label">
        <strong>
          {tr('Updates', 'Mises à jour')} · version {u.current}
        </strong>
        <span>{updateText(u)}</span>
      </div>
      <div className="row gap-8">
        {u.state === 'ready' ? (
          <button className="btn btn-primary btn-sm" onClick={() => void window.frag.installUpdate()}>
            <RefreshCw size={13} />
            {tr('Restart and update', 'Redémarrer et mettre à jour')}
          </button>
        ) : (
          u.state !== 'dev' && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void window.frag.checkForUpdates().then(setU)}>
              <RefreshCw size={13} className={busy ? 'spin' : ''} />
              {tr('Check now', 'Vérifier maintenant')}
            </button>
          )
        )}
        <button className="link-btn" onClick={() => setWhatsNewOpen(true)}>
          {tr('What’s new', 'Nouveautés')}
        </button>
      </div>
    </div>
  )
}

function HenrikSettings(): JSX.Element {
  return (
    <>
      <div className="setting">
        <div className="setting-label">
          <strong>HenrikDev</strong>
          <span>
            {tr(
              'Links your recordings to your matches (kills, rounds, auto clips).',
              'Pour lier tes recs à tes matchs (kills, rounds, clips auto).'
            )}
          </span>
        </div>
        <KeyField />
      </div>
      <div className="setting">
        <RateField />
      </div>
      <div className="setting">
        <AccountsField />
      </div>
    </>
  )
}

export default function SettingsModal(): JSX.Element | null {
  const { settingsOpen, setSettingsOpen, settings, updateSettings, encoders } = useApp()
  if (!settings) return null

  const pick = async (key: 'recsFolder' | 'outputFolder', title: string): Promise<void> => {
    const p = await window.frag.pickFolder(title)
    if (p) await updateSettings({ [key]: p })
  }

  const encoderOptions: { value: EncoderPref; label: string; hint: string }[] = [
    { value: 'auto', label: 'Auto', hint: tr('NVENC when available, CPU otherwise', 'NVENC si dispo, sinon processeur') },
    { value: 'nvenc', label: 'NVENC', hint: tr('Always use the Nvidia GPU', 'Toujours la carte Nvidia') },
    { value: 'cpu', label: tr('CPU', 'Processeur'), hint: tr('x264, slower', 'x264, plus lent') }
  ]
  const languages: { value: Lang; label: string }[] = [
    { value: 'en', label: 'English' },
    { value: 'fr', label: 'Français' }
  ]
  const layouts: { value: KeyboardLayout; label: string }[] = [
    { value: 'qwerty', label: 'QWERTY' },
    { value: 'azerty', label: 'AZERTY' }
  ]

  return (
    <Modal open={settingsOpen} title={tr('Settings', 'Réglages')} onClose={() => setSettingsOpen(false)} width={600}>
      <div className="setting">
        <div className="setting-head">
          <div className="setting-label">
            <strong>{tr('Language', 'Langue')}</strong>
            <span>{tr('Interface and notifications.', 'Interface et notifications.')}</span>
          </div>
          <div className="segmented">
            {languages.map((o) => (
              <button
                key={o.value}
                className={settings.language === o.value ? 'is-on' : ''}
                onClick={() => updateSettings({ language: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="setting">
        <div className="setting-head">
          <div className="setting-label">
            <strong>{tr('Keyboard', 'Clavier')}</strong>
            <span>
              {tr(
                'Adapts the shortcuts that use symbol keys (zoom, review, clip edges).',
                'Adapte les raccourcis qui utilisent des symboles (zoom, revue, bords de clip).'
              )}
            </span>
          </div>
          <div className="segmented">
            {layouts.map((o) => (
              <button
                key={o.value}
                className={settings.keyboardLayout === o.value ? 'is-on' : ''}
                onClick={() => updateSettings({ keyboardLayout: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="setting">
        <div className="setting-label">
          <strong>{tr('Recordings folder', 'Dossier des recs')}</strong>
          <span>{tr('Where OBS saves your games. Frag keeps an eye on it.', 'Là où OBS enregistre. Frag le surveille en continu.')}</span>
        </div>
        <button className="path-btn" onClick={() => pick('recsFolder', tr('OBS recordings folder', 'Dossier des recs OBS'))}>
          <FolderOpen size={14} />
          <span>{settings.recsFolder ?? tr('Choose…', 'Choisir…')}</span>
        </button>
      </div>

      <div className="setting">
        <div className="setting-label">
          <strong>{tr('Clips folder', 'Dossier des clips')}</strong>
          <span>
            {tr('Default: a “Clips” subfolder in your recordings folder.', 'Par défaut : un sous-dossier « Clips » dans le dossier des recs.')}
          </span>
        </div>
        <div className="row gap-6">
          <button className="path-btn" onClick={() => pick('outputFolder', tr('Clips output folder', 'Dossier de sortie des clips'))}>
            <FolderOpen size={14} />
            <span>{settings.outputFolder ?? tr('Default (…\\Clips)', 'Par défaut (…\\Clips)')}</span>
          </button>
          {settings.outputFolder && (
            <button
              className="icon-btn"
              title={tr('Back to the default folder', 'Revenir au dossier par défaut')}
              onClick={() => updateSettings({ outputFolder: null })}
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="setting">
        <div className="setting-label">
          <strong>{tr('Encoder', 'Encodeur')}</strong>
          <span>
            {encoders === null
              ? tr('Detecting…', 'Détection en cours…')
              : encoders.nvenc
                ? tr('NVENC found on your graphics card.', 'NVENC détecté sur ta carte graphique.')
                : tr('NVENC not found, exporting on the CPU.', 'NVENC non détecté, export par le processeur.')}
          </span>
        </div>
        <div className="segmented">
          {encoderOptions.map((o) => (
            <button
              key={o.value}
              className={settings.encoder === o.value ? 'is-on' : ''}
              title={o.hint}
              onClick={() => updateSettings({ encoder: o.value })}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="setting">
        <div className="setting-label">
          <strong>{tr('Background', 'Arrière-plan')}</strong>
          <span>
            {tr(
              'Frag stays in the system tray so it can start your recordings on its own. Right-click the icon to quit.',
              'Frag reste dans la zone de notification pour lancer tes recs tout seul. Clic droit sur l’icône pour quitter.'
            )}
          </span>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.closeToTray}
            onChange={(e) => void updateSettings({ closeToTray: e.target.checked })}
          />
          <span />
          {tr('Minimize to the system tray on close', 'Réduire dans la zone de notification en fermant')}
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) => void updateSettings({ launchAtLogin: e.target.checked })}
          />
          <span />
          {tr('Start Frag with Windows (hidden)', 'Lancer Frag au démarrage de Windows (caché)')}
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.notifications}
            onChange={(e) => void updateSettings({ notifications: e.target.checked })}
          />
          <span />
          {tr(
            'Notifications: end of game, OBS not running, exports done',
            'Notifications : fin de game, OBS pas lancé, exports terminés'
          )}
        </label>
      </div>

      <HenrikSettings />
      <ObsSettingsSection />
      <AssetsStatus />
      <UpdateSettings />

      <p className="settings-foot">
        {tr(
          'Your clips, markers and settings are saved automatically on your PC. Nothing is sent online.',
          'Tes clips, marqueurs et réglages sont sauvegardés automatiquement sur ton PC. Rien n’est envoyé en ligne.'
        )}
      </p>
    </Modal>
  )
}
