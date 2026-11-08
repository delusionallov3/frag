import { useEffect, useState } from 'react'
import { AlertTriangle, Check, FolderOpen, Loader2, PlugZap, ShieldCheck, X } from '../lib/icons'
import type { ObsSettings, ObsTest } from '@shared/types'
import { tr } from '@shared/i18n'
import { useApp } from '../store'

const STOP_DELAYS = [0, 5, 10, 20]
const SHORT_MINUTES = [1, 3, 5, 10]

function sameFolder(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase()
  return !!a && !!b && norm(a) === norm(b)
}

/** Settings: drive OBS from Valorant's state */
export function ObsSettingsSection(): JSX.Element | null {
  const { settings, updateSettings, autoRec } = useApp()
  const [host, setHost] = useState(settings?.obs.host ?? '127.0.0.1')
  const [port, setPort] = useState(String(settings?.obs.port ?? 4455))
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<ObsTest | null>(null)

  useEffect(() => {
    if (!settings) return
    setHost(settings.obs.host)
    setPort(String(settings.obs.port))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.obs.host, settings?.obs.port])

  if (!settings) return null
  const obs = settings.obs
  const patch = (p: Partial<ObsSettings>): Promise<void> => updateSettings({ obs: { ...obs, ...p } })

  const saveAddress = async (): Promise<void> => {
    const n = Number(port)
    const h = host.trim() || '127.0.0.1'
    if (h !== obs.host || (n > 0 && n < 65536 && n !== obs.port)) {
      await patch({ host: h, port: n > 0 && n < 65536 ? n : obs.port })
    }
  }

  const runTest = async (): Promise<void> => {
    setBusy(true)
    setTest(null)
    await saveAddress()
    const n = Number(port) || obs.port
    const typed = password.trim()
    const t = await window.frag.obsTest(host.trim() || '127.0.0.1', n, typed || null)
    if (t.ok && typed) {
      useApp.setState({ settings: await window.frag.setObsPassword(typed) })
      setPassword('')
    }
    setBusy(false)
    setTest(t)
  }

  const forget = async (): Promise<void> => {
    useApp.setState({ settings: await window.frag.setObsPassword(null) })
    setTest(null)
  }

  const live =
    autoRec?.enabled && autoRec.obs === 'ready'
      ? `${tr('Connected', 'Connecté')}${autoRec.obsVersion ? ` (OBS WebSocket ${autoRec.obsVersion})` : ''}`
      : autoRec?.enabled && autoRec.obsError
        ? autoRec.obsError
        : null

  return (
    <>
      <div className="setting">
        <div className="setting-head">
          <div className="setting-label">
            <strong>{tr('Auto-record', 'Enregistrement auto')}</strong>
            <span>
              {tr(
                'OBS starts recording when your game begins and stops when you’re back in the menus. The recording is then linked to its match automatically.',
                'OBS démarre quand ta game commence et s’arrête quand tu reviens au menu. La rec est ensuite liée toute seule à son match.'
              )}
            </span>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={obs.enabled} onChange={(e) => void patch({ enabled: e.target.checked })} />
            <span />
          </label>
        </div>

        {obs.enabled && (
          <div className="obs">
            {live && (
              <div className={`hk-msg ${autoRec?.obs === 'ready' ? 'is-ok' : 'is-warn'}`}>
                {autoRec?.obs === 'ready' ? <Check size={13} /> : <AlertTriangle size={13} />}
                <span>
                  {live}
                  {autoRec?.last ? ` · ${autoRec.last}` : ''}
                </span>
              </div>
            )}

            <div className="obs-addr">
              <div className="field">
                <label>{tr('Address', 'Adresse')}</label>
                <input
                  className="input"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  onBlur={() => void saveAddress()}
                  onKeyDown={(e) => e.stopPropagation()}
                  spellCheck={false}
                />
              </div>
              <div className="field">
                <label>Port</label>
                <input
                  className="input"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  onBlur={() => void saveAddress()}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
            </div>

            {settings.hasObsPassword && (
              <div className="hk-stored">
                <ShieldCheck size={14} />
                <span>{tr('Password saved, encrypted on this PC', 'Mot de passe enregistré, chiffré sur ce PC')}</span>
                <button className="icon-btn" title={tr('Forget password', 'Oublier le mot de passe')} onClick={forget}>
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="row gap-6">
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') void runTest()
                }}
                placeholder={
                  settings.hasObsPassword
                    ? tr('Replace password…', 'Remplacer le mot de passe…')
                    : tr('WebSocket server password', 'Mot de passe du serveur WebSocket')
                }
                spellCheck={false}
              />
              <button className="btn btn-ghost btn-sm" onClick={runTest} disabled={busy}>
                {busy ? <Loader2 size={13} className="spin" /> : <PlugZap size={13} />}
                {tr('Test connection', 'Tester la connexion')}
              </button>
            </div>

            {test && !test.ok && (
              <div className="hk-msg is-err">
                <AlertTriangle size={13} />
                <span>{test.error}</span>
              </div>
            )}
            {test?.ok && (
              <div className="hk-msg is-ok">
                <Check size={13} />
                <span>
                  {tr(`OBS ${test.version} is responding`, `OBS ${test.version} répond`)}
                  {test.recordDirectory ? ` · ${tr('records to', 'enregistre dans')} ${test.recordDirectory}` : ''}
                </span>
              </div>
            )}
            {test?.ok && test.recordDirectory && !sameFolder(test.recordDirectory, settings.recsFolder) && (
              <button
                className="btn btn-ghost btn-sm obs-use-dir"
                onClick={() => void updateSettings({ recsFolder: test.recordDirectory! })}
              >
                <FolderOpen size={13} />
                {tr('Use this folder for Frag’s recordings', 'Utiliser ce dossier pour les recs de Frag')}
              </button>
            )}

            <p className="obs-help">
              {tr(
                'In OBS: Tools → WebSocket Server Settings → tick “Enable WebSocket server”. Copy the password with “Show Connect Info”.',
                'Dans OBS : Outils → Paramètres du serveur WebSocket → coche « Activer le serveur WebSocket ». Le mot de passe se copie avec « Afficher les informations de connexion ».'
              )}
            </p>

            <div className="obs-grid">
              <span>{tr('Start', 'Démarrer')}</span>
              <div className="segmented">
                <button className={obs.startOn === 'ingame' ? 'is-on' : ''} onClick={() => void patch({ startOn: 'ingame' })}>
                  {tr('When the game loads', 'Au chargement de la game')}
                </button>
                <button className={obs.startOn === 'pregame' ? 'is-on' : ''} onClick={() => void patch({ startOn: 'pregame' })}>
                  {tr('At agent select', 'Dès la sélection d’agent')}
                </button>
              </div>
              <span>{tr('Stop', 'Arrêter')}</span>
              <div className="segmented">
                {STOP_DELAYS.map((d) => (
                  <button key={d} className={obs.stopDelay === d ? 'is-on' : ''} onClick={() => void patch({ stopDelay: d })}>
                    {d === 0 ? tr('Back in menus', 'Au retour au menu') : tr(`${d} s later`, `${d} s après`)}
                  </button>
                ))}
              </div>
            </div>

            <label className="toggle">
              <input type="checkbox" checked={obs.autoLink} onChange={(e) => void patch({ autoLink: e.target.checked })} />
              <span />
              {tr('Link the recording to its match after the game', 'Lier la rec à son match après la game')}
              {settings.hasHenrikKey ? '' : tr(' (needs a HenrikDev key)', ' (il faut une clé HenrikDev)')}
            </label>
            <label className="toggle">
              <input type="checkbox" checked={obs.renameRecs} onChange={(e) => void patch({ renameRecs: e.target.checked })} />
              <span />
              {tr('Rename the recording at the end (map · mode · score)', 'Renommer la rec à la fin (map · mode · score)')}
            </label>
            <p className="obs-help">
              {tr(
                'During the game, Frag notes the end of every round: it drops markers in the recording and syncs it on its own once linked to the match. It never touches a recording you started yourself, and skips the Range.',
                'Pendant la game, Frag note chaque fin de round : ça pose des marqueurs dans la rec et la cale toute seule une fois liée au match. Il ne touche pas à un enregistrement que tu as lancé toi-même, et ne filme pas le stand de tir.'
              )}
            </p>
          </div>
        )}
      </div>

      <div className="setting">
        <div className="setting-label">
          <strong>{tr('Short recordings', 'Recs courtes')}</strong>
          <span>
            {tr(
              'Below this length, a recording is never linked to a match automatically (test recordings). You can still link it by hand, or hide it in the library.',
              'En dessous de cette durée, une rec n’est jamais liée toute seule à un match (recs de test). Tu peux toujours la lier à la main, ou la masquer dans la bibliothèque.'
            )}
          </span>
        </div>
        <div className="segmented">
          {SHORT_MINUTES.map((m) => (
            <button
              key={m}
              className={settings.minLinkMinutes === m ? 'is-on' : ''}
              onClick={() => void updateSettings({ minLinkMinutes: m })}
            >
              {tr(`Under ${m} min`, `Moins de ${m} min`)}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
