import { useEffect, useState } from 'react'
import { Check, X, Loader2, ExternalLink, ShieldCheck, AlertTriangle, RefreshCw, Star, UserPlus } from '../lib/icons'
import type { KeyTest, RateInfo, RiotAccount } from '@shared/types'
import { tr } from '@shared/i18n'
import { useApp } from '../store'
import { assetUrl } from '../lib/assets'

const REGION_LABEL: Record<string, string> = {
  eu: 'EU',
  na: 'NA',
  ap: 'AP',
  kr: 'KR',
  latam: 'LATAM',
  br: 'BR'
}

const presets = (): { value: number; label: string; hint: string }[] => [
  { value: 30, label: '30', hint: tr('Basic key (free)', 'Clé Basic (gratuite)') },
  { value: 90, label: '90', hint: tr('Advanced key (free, on request)', 'Clé Advanced (gratuite, sur demande)') },
  { value: 130, label: '130', hint: 'Premium Tier 1' },
  { value: 200, label: '200', hint: 'Premium Tier 2' },
  { value: 300, label: '300', hint: 'Premium Tier 3' }
]

/* ------------------------------------------------------------------ API key */

export function KeyField({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const { settings } = useApp()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<KeyTest | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!settings) return null

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    const res = await window.frag.setHenrikKey(key.trim())
    setBusy(false)
    useApp.setState({ settings: res.settings })
    if (res.ok) {
      setResult(res.test)
      setKey('')
    } else setError(res.error ?? tr('Key rejected.', 'Clé refusée.'))
  }

  const testStored = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    const t = await window.frag.testStoredKey()
    setBusy(false)
    if (t.ok) setResult(t)
    else setError(t.error ?? tr('Key rejected.', 'Clé refusée.'))
  }

  const remove = async (): Promise<void> => {
    const res = await window.frag.setHenrikKey(null)
    useApp.setState({ settings: res.settings })
    setResult(null)
    setError(null)
  }

  return (
    <div className="hk">
      <div className="hk-label">
        <span>{tr('HenrikDev API key', 'Clé API HenrikDev')}</span>
        <button className="link-btn inline-link" onClick={() => window.frag.openExternal('https://api.henrikdev.xyz/dashboard/')}>
          {tr('Get a key', 'Obtenir une clé')} <ExternalLink size={10} />
        </button>
      </div>

      {settings.hasHenrikKey && !compact && (
        <div className="hk-stored">
          <ShieldCheck size={14} />
          <span>{tr('Key saved, encrypted on this PC', 'Clé enregistrée, chiffrée sur ce PC')}</span>
          <button className="btn btn-ghost btn-sm" onClick={testStored} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            {tr('Test', 'Tester')}
          </button>
          <button className="icon-btn" title={tr('Remove key', 'Supprimer la clé')} onClick={remove}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="row gap-6">
        <input
          className="input"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && key.trim()) void save()
          }}
          placeholder={settings.hasHenrikKey ? tr('Replace with another key…', 'Remplacer par une autre clé…') : 'HDEV-xxxxxxxx-xxxx-…'}
          spellCheck={false}
        />
        <button className={`btn ${compact ? 'btn-primary' : 'btn-ghost'} btn-sm`} disabled={!key.trim() || busy} onClick={save}>
          {busy && key ? <Loader2 size={13} className="spin" /> : <Check size={13} />}
          {tr('Test and save', 'Tester et enregistrer')}
        </button>
      </div>

      {error && (
        <div className="hk-msg is-err">
          <AlertTriangle size={13} />
          <span>{error}</span>
        </div>
      )}
      {result?.ok && (
        <div className="hk-msg is-ok">
          <Check size={13} />
          <span>
            {tr('Valid key', 'Clé valide')}
            {result.limit
              ? tr(` · detected quota: ${result.limit} requests per window`, ` · quota détecté : ${result.limit} requêtes par fenêtre`)
              : ''}
            {result.remaining !== null ? tr(` · ${result.remaining} left`, ` · ${result.remaining} restantes`) : ''}
          </span>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Quota */

export function RateField(): JSX.Element | null {
  const { settings, updateSettings } = useApp()
  const PRESETS = presets()
  const [info, setInfo] = useState<RateInfo | null>(null)
  const [custom, setCustom] = useState('')

  useEffect(() => {
    let alive = true
    const tick = (): void => {
      window.frag.rateInfo().then((i) => alive && setInfo(i))
    }
    tick()
    const t = setInterval(tick, 1500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  if (!settings) return null
  const isPreset = PRESETS.some((p) => p.value === settings.rateLimit)
  const used = info?.usedLastMinute ?? 0
  const pct = Math.min(100, (used / Math.max(1, settings.rateLimit)) * 100)

  return (
    <div className="hk">
      <div className="hk-label">
        <span>{tr('Allowed requests per minute', 'Requêtes par minute autorisées')}</span>
        {info?.detectedLimit ? (
          <span className="hk-detected">
            {tr('Detected on your key:', 'Détecté sur ta clé :')} {info.detectedLimit}
          </span>
        ) : null}
      </div>
      <div className="row gap-6 hk-rate">
        <div className="segmented">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              className={settings.rateLimit === p.value ? 'is-on' : ''}
              title={p.hint}
              onClick={() => updateSettings({ rateLimit: p.value })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          className={`input input-num ${!isPreset ? 'is-on' : ''}`}
          type="number"
          min={1}
          max={1000}
          placeholder={tr('Other', 'Autre')}
          value={!isPreset ? settings.rateLimit : custom}
          onChange={(e) => {
            setCustom(e.target.value)
            const n = Math.round(Number(e.target.value))
            if (n >= 1 && n <= 1000) void updateSettings({ rateLimit: n })
          }}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
      <div className="hk-usage">
        <div className="bar">
          <div style={{ width: `${pct}%` }} className={pct >= 100 ? 'is-full' : ''} />
        </div>
        <span>
          {used} / {settings.rateLimit} {tr('in the last minute', 'sur la dernière minute')}
          {info?.waitingUntil ? tr(' · waiting for quota…', ' · en attente du quota…') : ''}
        </span>
      </div>
      <p className="hk-note">
        {tr(
          'Frag never goes over this number: extra requests wait their turn. Free Basic key = 30, Advanced = 90.',
          'Frag ne dépasse jamais ce nombre : les requêtes en trop attendent leur tour. Clé Basic gratuite = 30, Advanced = 90.'
        )}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ Verified Riot accounts */

function Avatar({ card }: { card: string | null }): JSX.Element {
  const [failed, setFailed] = useState(false)
  if (!card || failed) return <div className="acc-avatar is-empty" />
  return (
    <img
      className="acc-avatar"
      src={assetUrl(`https://media.valorant-api.com/playercards/${card}/smallart.png`) ?? ''}
      alt=""
      onError={() => setFailed(true)}
      draggable={false}
    />
  )
}

export function AccountsField({ compact = false }: { compact?: boolean }): JSX.Element | null {
  const { settings, updateSettings } = useApp()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (!settings) return null
  const accounts = settings.accounts
  const valid = /^[^#]{3,16}#[^#]{2,5}$/.test(input.trim())

  /** Replaces the account if it already exists (same PUUID or Riot ID), otherwise appends it */
  const upsert = (acc: RiotAccount): RiotAccount[] => {
    const idx = accounts.findIndex(
      (a) => (acc.puuid && a.puuid === acc.puuid) || a.riotId.toLowerCase() === acc.riotId.toLowerCase()
    )
    if (idx >= 0) return accounts.map((a, i) => (i === idx ? acc : a))
    return [...accounts, acc]
  }

  const add = async (): Promise<void> => {
    if (!valid) return
    setBusy('add')
    setError(null)
    const res = await window.frag.verifyAccount(input.trim())
    setBusy(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    await updateSettings({ accounts: upsert(res.data) })
    setInput('')
  }

  const reverify = async (a: RiotAccount): Promise<void> => {
    setBusy(a.riotId)
    setError(null)
    const res = await window.frag.verifyAccount(a.riotId)
    setBusy(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    await updateSettings({ accounts: accounts.map((x) => (x === a ? res.data : x)) })
  }

  const noKey = !settings.hasHenrikKey

  return (
    <div className="hk">
      <div className="hk-label">
        <span>{compact ? tr('Your Riot account', 'Ton compte Riot') : tr('Riot accounts', 'Comptes Riot')}</span>
        {!compact && accounts.length > 1 && (
          <span className="hk-detected">{tr('Star = default account', 'L’étoile = compte par défaut')}</span>
        )}
      </div>

      {accounts.length > 0 && (
        <div className="accs">
          {accounts.map((a, i) => (
            <div key={a.riotId} className={`acc ${i === 0 ? 'is-main' : ''}`}>
              <Avatar card={a.card} />
              <div className="acc-main">
                <div className="acc-name">{a.riotId}</div>
                <div className="acc-sub">
                  {a.verified ? (
                    <>
                      <span className="acc-ok">
                        <Check size={11} /> {tr('verified', 'vérifié')}
                      </span>
                      <span>{REGION_LABEL[a.region] ?? a.region}</span>
                      {a.level !== null && <span>{tr('lvl', 'niv.')} {a.level}</span>}
                    </>
                  ) : (
                    <span className="acc-warn">{tr('not verified', 'non vérifié')}</span>
                  )}
                </div>
              </div>
              {!a.verified && (
                <button className="btn btn-ghost btn-sm" disabled={noKey || busy !== null} onClick={() => reverify(a)}>
                  {busy === a.riotId ? <Loader2 size={13} className="spin" /> : null}
                  {tr('Verify', 'Vérifier')}
                </button>
              )}
              {!compact && (
                <>
                  <button
                    className={`icon-btn ${i === 0 ? 'is-star' : ''}`}
                    title={i === 0 ? tr('Default account', 'Compte par défaut') : tr('Make default', 'Utiliser par défaut')}
                    onClick={() => updateSettings({ accounts: [a, ...accounts.filter((x) => x !== a)] })}
                  >
                    <Star size={13} fill={i === 0 ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    className="icon-btn"
                    title={tr('Remove', 'Retirer')}
                    onClick={() => updateSettings({ accounts: accounts.filter((x) => x !== a) })}
                  >
                    <X size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {(!compact || accounts.length === 0) && (
        <div className="row gap-6">
          <input
            className="input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') void add()
            }}
            placeholder={tr('Name#TAG', 'Pseudo#TAG')}
            spellCheck={false}
            disabled={noKey}
          />
          <button className="btn btn-ghost btn-sm" disabled={!valid || busy !== null || noKey} onClick={add}>
            {busy === 'add' ? <Loader2 size={13} className="spin" /> : <UserPlus size={13} />}
            {tr('Verify and add', 'Vérifier et ajouter')}
          </button>
        </div>
      )}
      {noKey && (
        <p className="hk-note">
          {tr('Save a valid key first to verify your accounts.', 'Enregistre d’abord une clé valide pour vérifier tes comptes.')}
        </p>
      )}
      {input && !valid && !noKey && (
        <p className="hk-note">
          {tr('Expected format: Name#TAG (3 to 16 characters, then 2 to 5).', 'Format attendu : Pseudo#TAG (3 à 16 caractères, puis 2 à 5).')}
        </p>
      )}
      {error && (
        <div className="hk-msg is-err">
          <AlertTriangle size={13} />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
