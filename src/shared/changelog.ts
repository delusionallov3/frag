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
    version: '0.4.0',
    date: '2026-11-08',
    title: ['Match recaps with motion design', 'Des résumés de match en motion design'],
    items: [
      [
        'Match panel → Match recap: a video of your best rounds with a match intro, transitions that name each round, a title on every highlight and a zoom on each kill.',
        'Panneau Match → Résumé du match : une vidéo de tes meilleurs rounds avec une intro du match, des transitions qui annoncent chaque round, un titre sur chaque temps fort et un zoom sur chaque kill.'
      ],
      [
        'Three styles (Clean, Broadcast, Kinetic) and a colour, with a live preview. Every part can be turned on or off.',
        'Trois styles (Clean, Broadcast, Kinetic) et une couleur, avec un aperçu en direct. Chaque élément s’active ou se désactive.'
      ],
      [
        'A scoreboard with all ten players: agent, rank, K/D/A and ACS, after the intro or at the end.',
        'Un tableau des dix joueurs : agent, rang, K/D/A et ACS, après l’intro ou à la fin.'
      ],
      ['The Montage window gets a Motion option that uses the same style.', 'La fenêtre Montage gagne une option Motion qui reprend le même style.']
    ]
  },
  {
    version: '0.3.1',
    date: '2026-11-08',
    title: ['A new coat of icons', 'De nouvelles icônes'],
    items: [
      [
        'Every icon in the app now comes from one set, Phosphor: rounder, easier to read at small sizes.',
        'Toutes les icônes de l’app viennent maintenant d’un seul jeu, Phosphor : plus rondes, plus lisibles en petit.'
      ],
      ['The title bar shows the app icon itself instead of a bare F.', 'La barre de titre affiche l’icône de l’app au lieu d’un F tout seul.'],
      [
        'After an update, the What’s new button names itself until you open it.',
        'Après une mise à jour, le bouton Nouveautés s’affiche en toutes lettres jusqu’à ce que tu l’ouvres.'
      ]
    ]
  },
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
