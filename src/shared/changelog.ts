/**
 * What's new, newest first. Shown in the app after an update and linked from the title bar.
 * Each line is [English, Français].
 */

export interface Release {
  version: string
  /** YYYY-MM-DD */
  date: string
  title: [string, string]
  items: [string, string][]
}

export const CHANGELOG: Release[] = [
  {
    version: '0.3.0',
    date: '2026-11-08',
    title: ['Frag speaks English', 'Frag parle anglais'],
    items: [
      [
        'The whole app is now in English by default. Prefer French? Settings → Language.',
        'Toute l’app est maintenant en anglais par défaut. Tu préfères le français ? Réglages → Langue.'
      ],
      [
        'New Keyboard setting: QWERTY by default, AZERTY adapts the symbol shortcuts (à for fit, ; for next, ( ) for clip edges).',
        'Nouveau réglage Clavier : QWERTY par défaut, AZERTY adapte les raccourcis à symboles (à pour tout afficher, ; pour suivant, ( ) pour les bords du clip).'
      ],
      ['This “What’s new” window, opened after each update.', 'Cette fenêtre « Nouveautés », ouverte après chaque mise à jour.']
    ]
  },
  {
    version: '0.2.0',
    date: '2026-11-08',
    title: ['Automatic updates', 'Mises à jour automatiques'],
    items: [
      [
        'Frag checks GitHub for new versions, downloads them in the background and installs them when you quit.',
        'Frag vérifie les nouvelles versions sur GitHub, les télécharge en arrière-plan et les installe quand tu quittes.'
      ],
      [
        'Windows notifications: Valorant open without OBS (one click starts OBS), recording linked to its match, exports done.',
        'Notifications Windows : Valorant ouvert sans OBS (un clic lance OBS), rec liée à son match, exports terminés.'
      ],
      [
        'Frag lives in the system tray: red dot while recording, quick access to your folders.',
        'Frag vit dans la zone de notification : point rouge pendant une rec, accès rapide à tes dossiers.'
      ],
      ['Optional start with Windows, hidden.', 'Lancement avec Windows en option, caché.']
    ]
  },
  {
    version: '0.1.0',
    date: '2026-11-07',
    title: ['First release', 'Première version'],
    items: [
      ['Cut your Valorant recordings into clips with a few keys, exported with NVENC.', 'Découpe tes recs Valorant en clips en quelques touches, export NVENC.'],
      [
        'Link recordings to their match through HenrikDev: kills on the timeline, auto clips, killfeed sync.',
        'Liaison des recs à leur match via HenrikDev : kills sur la timeline, clips auto, calage sur le killfeed.'
      ],
      ['OBS auto-record that follows your games.', 'Enregistrement auto avec OBS qui suit tes games.'],
      ['Review tab, Stats page and montage maker.', 'Onglet Revoir, page Stats et montage.']
    ]
  }
]
