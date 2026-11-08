import { useApp } from '../store'
import Modal from './Modal'

const GROUPS: { title: string; items: [string[], string][] }[] = [
  {
    title: 'Lecture',
    items: [
      [['Espace'], 'Lecture / pause'],
      [['←', '→'], 'Image par image'],
      [['Maj', '← →'], '± 1 seconde'],
      [['J', 'L'], '± 5 secondes'],
      [['K'], 'Pause'],
      [['↑', '↓'], 'Marqueur ou bord de clip précédent / suivant'],
      [['N'], 'Kill suivant (match lié)'],
      [[',', '.'], 'Passage précédent / suivant (Revoir)'],
      [['Maj', 'N'], 'Kill précédent'],
      [['Début', 'Fin'], 'Début / fin de la vidéo']
    ]
  },
  {
    title: 'Clips',
    items: [
      [['C'], 'Nouveau clip des 10 dernières secondes'],
      [['I'], 'Début du clip sélectionné (ou nouveau clip)'],
      [['O'], 'Fin du clip sélectionné (ou nouveau clip)'],
      [['Tab'], 'Clip suivant'],
      [['Entrée'], 'Lire le clip sélectionné'],
      [['[', ']'], 'Aller au début / à la fin du clip'],
      [['R'], 'Boucle sur le clip'],
      [['M'], 'Poser un marqueur'],
      [['Maj', 'M'], 'Supprimer le marqueur sous la tête de lecture'],
      [['Suppr'], 'Supprimer le clip ou le marqueur sélectionné'],
      [['Échap'], 'Désélectionner, puis retour']
    ]
  },
  {
    title: 'Export & vue',
    items: [
      [['E'], 'Exporter le clip sélectionné'],
      [['Maj', 'E'], 'Exporter tous les clips cochés'],
      [['Ctrl', 'Z'], 'Annuler'],
      [['Ctrl', 'Maj', 'Z'], 'Rétablir'],
      [['+', '−'], 'Zoom de la timeline'],
      [['0'], 'Tout afficher'],
      [['Ctrl', 'molette'], 'Zoom à la souris']
    ]
  }
]

export default function ShortcutsModal(): JSX.Element {
  const { shortcutsOpen, setShortcutsOpen } = useApp()
  return (
    <Modal open={shortcutsOpen} title="Raccourcis clavier" onClose={() => setShortcutsOpen(false)} width={760}>
      <div className="shortcuts">
        {GROUPS.map((g) => (
          <div key={g.title} className="shortcut-group">
            <h3>{g.title}</h3>
            {g.items.map(([keys, label]) => (
              <div key={label} className="shortcut">
                <span>{label}</span>
                <span className="keys">
                  {keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}
