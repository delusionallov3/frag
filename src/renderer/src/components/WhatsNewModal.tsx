import { CHANGELOG } from '@shared/changelog'
import { getLang, locale, tr } from '@shared/i18n'
import { useApp } from '../store'
import Modal from './Modal'

const pick = (pair: [string, string]): string => (getLang() === 'fr' ? pair[1] : pair[0])

function releaseDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function WhatsNewModal(): JSX.Element | null {
  const { whatsNewOpen, setWhatsNewOpen, settings, updateSettings } = useApp()
  if (!settings) return null

  const close = (): void => {
    setWhatsNewOpen(false)
    if (settings.lastSeenVersion !== window.frag.version) void updateSettings({ lastSeenVersion: window.frag.version })
  }

  return (
    <Modal open={whatsNewOpen} title={tr('What’s new', 'Nouveautés')} onClose={close} width={560}>
      <div className="wn">
        {CHANGELOG.map((r, i) => (
          <section key={r.version} className={`wn-release ${r.version === window.frag.version ? 'is-current' : ''}`}>
            <header>
              <span className="wn-version">v{r.version}</span>
              <span className="wn-date">{releaseDate(r.date)}</span>
              {i === 0 && <span className="wn-badge">{tr('Latest', 'Dernière')}</span>}
            </header>
            <h3>{pick(r.title)}</h3>
            <ul>
              {r.items.map((it) => (
                <li key={it[0]}>{pick(it)}</li>
              ))}
            </ul>
          </section>
        ))}
        <button className="link-btn wn-all" onClick={() => window.frag.openExternal('https://github.com/delusionallov3/frag/releases')}>
          {tr('All releases on GitHub', 'Toutes les versions sur GitHub')}
        </button>
      </div>
    </Modal>
  )
}
