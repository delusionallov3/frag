import { tr } from '@shared/i18n'
import { useApp } from '../store'
import { keyCap } from '../lib/keys'
import Modal from './Modal'

type Group = { title: string; items: [string[], string][] }

function groups(): Group[] {
  const shift = tr('Shift', 'Maj')
  return [
    {
      title: tr('Playback', 'Lecture'),
      items: [
        [[tr('Space', 'Espace')], tr('Play / pause', 'Lecture / pause')],
        [['←', '→'], tr('Frame by frame', 'Image par image')],
        [[shift, '← →'], tr('± 1 second', '± 1 seconde')],
        [['J', 'L'], tr('± 5 seconds', '± 5 secondes')],
        [['K'], 'Pause'],
        [['↑', '↓'], tr('Previous / next marker or clip edge', 'Marqueur ou bord de clip précédent / suivant')],
        [['N'], tr('Next kill (linked match)', 'Kill suivant (match lié)')],
        [[shift, 'N'], tr('Previous kill', 'Kill précédent')],
        [[',', keyCap('.')], tr('Previous / next moment (Review)', 'Passage précédent / suivant (Revoir)')],
        [[tr('Home', 'Début'), tr('End', 'Fin')], tr('Start / end of the video', 'Début / fin de la vidéo')]
      ]
    },
    {
      title: 'Clips',
      items: [
        [['C'], tr('New clip of the last 10 seconds', 'Nouveau clip des 10 dernières secondes')],
        [['I'], tr('Start of the selected clip (or new clip)', 'Début du clip sélectionné (ou nouveau clip)')],
        [['O'], tr('End of the selected clip (or new clip)', 'Fin du clip sélectionné (ou nouveau clip)')],
        [['Tab'], tr('Next clip', 'Clip suivant')],
        [[tr('Enter', 'Entrée')], tr('Play the selected clip', 'Lire le clip sélectionné')],
        [[keyCap('['), keyCap(']')], tr('Go to the start / end of the clip', 'Aller au début / à la fin du clip')],
        [['R'], tr('Loop the clip', 'Boucle sur le clip')],
        [['M'], tr('Drop a marker', 'Poser un marqueur')],
        [[shift, 'M'], tr('Delete the marker under the playhead', 'Supprimer le marqueur sous la tête de lecture')],
        [[tr('Del', 'Suppr')], tr('Delete the selected clip or marker', 'Supprimer le clip ou le marqueur sélectionné')],
        [[tr('Esc', 'Échap')], tr('Deselect, then go back', 'Désélectionner, puis retour')]
      ]
    },
    {
      title: tr('Export & view', 'Export & vue'),
      items: [
        [['E'], tr('Export the selected clip', 'Exporter le clip sélectionné')],
        [[shift, 'E'], tr('Export all checked clips', 'Exporter tous les clips cochés')],
        [['Ctrl', 'Z'], tr('Undo', 'Annuler')],
        [['Ctrl', shift, 'Z'], tr('Redo', 'Rétablir')],
        [['+', '−'], tr('Zoom the timeline', 'Zoom de la timeline')],
        [[keyCap('0')], tr('Fit all', 'Tout afficher')],
        [['Ctrl', tr('wheel', 'molette')], tr('Zoom at the cursor', 'Zoom à la souris')]
      ]
    }
  ]
}

export default function ShortcutsModal(): JSX.Element {
  const { shortcutsOpen, setShortcutsOpen, settings } = useApp()
  const layout = settings?.keyboardLayout === 'azerty' ? 'AZERTY' : 'QWERTY'
  return (
    <Modal open={shortcutsOpen} title={`${tr('Keyboard shortcuts', 'Raccourcis clavier')} · ${layout}`} onClose={() => setShortcutsOpen(false)} width={760}>
      <div className="shortcuts">
        {groups().map((g) => (
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
