import { useEffect, useState } from 'react'
import { FolderOpen, RotateCcw, RefreshCw } from 'lucide-react'
import { useAssets } from '../lib/assets'
import type { EncoderPref, UpdateStatus } from '@shared/types'
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
  return (
    <div className="setting">
      <div className="setting-label">
        <strong>Visuels Valorant</strong>
        <span>
          {assets
            ? `${assets.agents.length} agents, ${assets.maps.length} maps, ${assets.weapons.length} armes, ${assets.tiers.length} rangs · mis à jour le ${new Date(assets.fetchedAt).toLocaleDateString('fr-FR')}`
            : 'Pas encore chargés.'}{' '}
          Source : valorant-api.com, gardés en cache sur ce PC.
        </span>
      </div>
      <div className="row gap-8">
        <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={busy}>
          <RefreshCw size={13} className={busy ? 'spin' : ''} />
          Recharger
        </button>
        {error && <span className="assets-err">Impossible de joindre valorant-api.com ({error})</span>}
      </div>
    </div>
  )
}

function updateText(u: UpdateStatus): string {
  switch (u.state) {
    case 'dev':
      return 'Mode développement : pas de mise à jour automatique.'
    case 'checking':
      return 'Recherche d’une nouvelle version…'
    case 'none':
      return 'Tu as la dernière version.'
    case 'downloading':
      return `Téléchargement de la ${u.version ?? 'nouvelle version'}… ${Math.round(u.progress * 100)} %`
    case 'ready':
      return `La ${u.version} est prête : elle s’installera quand tu quitteras Frag.`
    case 'error':
      return `Impossible de vérifier les mises à jour (${u.error ?? 'erreur inconnue'}).`
    default:
      return 'Frag vérifie tout seul les nouvelles versions sur GitHub.'
  }
}

function UpdateSettings(): JSX.Element | null {
  const [u, setU] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void window.frag.updateStatus().then(setU)
    return window.frag.onUpdateStatus(setU)
  }, [])
  if (!u) return null
  const busy = u.state === 'checking' || u.state === 'downloading'
  return (
    <div className="setting">
      <div className="setting-label">
        <strong>Mises à jour · version {u.current}</strong>
        <span>{updateText(u)}</span>
      </div>
      {u.state === 'ready' ? (
        <button className="btn btn-primary btn-sm" onClick={() => void window.frag.installUpdate()}>
          <RefreshCw size={13} />
          Redémarrer et mettre à jour
        </button>
      ) : (
        u.state !== 'dev' && (
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void window.frag.checkForUpdates().then(setU)}>
            <RefreshCw size={13} className={busy ? 'spin' : ''} />
            Vérifier maintenant
          </button>
        )
      )}
    </div>
  )
}

function HenrikSettings(): JSX.Element {
  return (
    <>
      <div className="setting">
        <div className="setting-label">
          <strong>HenrikDev</strong>
          <span>Pour lier tes recs à tes matchs (kills, rounds, clips auto).</span>
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
    { value: 'auto', label: 'Auto', hint: 'NVENC si dispo, sinon processeur' },
    { value: 'nvenc', label: 'NVENC', hint: 'Toujours la carte Nvidia' },
    { value: 'cpu', label: 'Processeur', hint: 'x264, plus lent' }
  ]

  return (
    <Modal open={settingsOpen} title="Réglages" onClose={() => setSettingsOpen(false)} width={600}>
      <div className="setting">
        <div className="setting-label">
          <strong>Dossier des recs</strong>
          <span>Là où OBS enregistre. Frag le surveille en continu.</span>
        </div>
        <button className="path-btn" onClick={() => pick('recsFolder', 'Dossier des recs OBS')}>
          <FolderOpen size={14} />
          <span>{settings.recsFolder ?? 'Choisir…'}</span>
        </button>
      </div>

      <div className="setting">
        <div className="setting-label">
          <strong>Dossier des clips</strong>
          <span>Par défaut : un sous-dossier « Clips » dans le dossier des recs.</span>
        </div>
        <div className="row gap-6">
          <button className="path-btn" onClick={() => pick('outputFolder', 'Dossier de sortie des clips')}>
            <FolderOpen size={14} />
            <span>{settings.outputFolder ?? 'Par défaut (…\\Clips)'}</span>
          </button>
          {settings.outputFolder && (
            <button className="icon-btn" title="Revenir au dossier par défaut" onClick={() => updateSettings({ outputFolder: null })}>
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="setting">
        <div className="setting-label">
          <strong>Encodeur</strong>
          <span>
            {encoders === null
              ? 'Détection en cours…'
              : encoders.nvenc
                ? 'NVENC détecté sur ta carte graphique.'
                : 'NVENC non détecté, export par le processeur.'}
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
          <strong>Arrière-plan</strong>
          <span>Frag reste dans la zone de notification pour lancer tes recs tout seul. Clic droit sur l’icône pour quitter.</span>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.closeToTray}
            onChange={(e) => void updateSettings({ closeToTray: e.target.checked })}
          />
          <span />
          Réduire dans la zone de notification en fermant
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) => void updateSettings({ launchAtLogin: e.target.checked })}
          />
          <span />
          Lancer Frag au démarrage de Windows (caché)
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.notifications}
            onChange={(e) => void updateSettings({ notifications: e.target.checked })}
          />
          <span />
          Notifications : fin de game, OBS pas lancé, exports terminés
        </label>
      </div>

      <HenrikSettings />
      <ObsSettingsSection />
      <AssetsStatus />
      <UpdateSettings />

      <p className="settings-foot">
        Tes clips, marqueurs et réglages sont sauvegardés automatiquement sur ton PC. Rien n’est envoyé en ligne.
      </p>
    </Modal>
  )
}
