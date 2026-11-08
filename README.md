# Frag

Découpe tes recs Valorant en clips, vite et proprement. Tout tourne en local, rien n'est envoyé en ligne.

## Lancer l'app

Il faut [Node.js](https://nodejs.org) (version 20 ou plus).

```bash
npm install
npm run dev
```

`npm install` télécharge aussi Electron et FFmpeg, rien d'autre à installer.

Pour fabriquer un installeur Windows avec l'icône de Frag (`release/Frag-Setup-0.1.0.exe`) :

```bash
npm run dist
```

L'icône est dans `build/icon.ico` (remplace-la par la tienne si tu veux, en gardant le même nom). Pour changer le numéro de version, modifie `version` dans `package.json`. Tes réglages, clips et matchs liés restent dans `%APPDATA%\Frag` : la version installée les retrouve.

## Comment ça marche

1. Au premier lancement, choisis le dossier où OBS enregistre tes games. Frag le surveille et chaque nouvelle rec apparaît toute seule quand tu arrêtes l'enregistrement.
2. Ouvre une rec, regarde ta game. Au moment d'une action, appuie sur **C** : ça crée un clip des 10 dernières secondes.
3. Ajuste avec **I** (début) / **O** (fin), ou en tirant les bords du clip sur la timeline.
4. **Maj + E** exporte tous les clips cochés. Ils arrivent dans `<dossier des recs>\Clips`.

Les clips et marqueurs sont sauvegardés automatiquement : tu peux fermer et revenir plus tard.

## Lier une rec à son match (HenrikDev)

1. Onglet **Match** dans l'éditeur : colle ta clé API HenrikDev (gratuite sur https://api.henrikdev.xyz/dashboard/) et ton Riot ID.
2. Frag compare l'heure de début de la rec (le nom du fichier OBS) avec ton historique et lie automatiquement le bon match. Sinon, choisis-le dans la liste ou colle un match ID.
3. **Cale la synchro**, au choix :
   - **Sur un kill** (le plus précis) : mets la vidéo pile à l'image où un kill apparaît dans le killfeed, choisis ce kill dans la liste (l'aperçu ressemble au killfeed du jeu) et clique « Caler tout le match sur ce kill ».
   - **Début de round** : mets la vidéo quand les barrières tombent (chrono à 1:40), choisis le round, « Le round commence ici ».
   Chaque calage recale tout le match et remplace le précédent. Ajuste ensuite au besoin avec ±0,1 s / ±1 s.
4. Tes kills (losanges rouges), tes morts et les plants apparaissent sur la timeline. `N` / `Maj + N` pour sauter de kill en kill.
5. **Clips auto** : choisis 1K+, 2K+ ou 3K+, active les clutchs, règle les secondes avant / après, et Frag crée les clips nommés (`R7 · 3K · Vandal`, `R12 · ACE · Clutch 1v4`…).

Les visuels (agents, maps, armes, rangs) viennent de [valorant-api.com](https://valorant-api.com) et sont gardés en cache sur ton PC.

Pas envie de caler à la main ? **Caler automatiquement** analyse le killfeed (en haut à droite de l'écran) et fait correspondre chaque nouvelle ligne avec les kills du match. Si l'app n'est pas sûre d'elle, elle n'applique rien et te le dit.

## Enregistrement auto (OBS)

Réglages → **Enregistrement auto** : Frag lance l'enregistrement d'OBS quand ta game commence et l'arrête quand tu reviens au menu, puis lie la rec à son match dès que HenrikDev le connaît (en général 1 à 5 minutes après la fin).

1. Dans OBS : **Outils → Paramètres du serveur WebSocket**, coche « Activer le serveur WebSocket », puis « Afficher les informations de connexion » pour copier le mot de passe.
2. Dans Frag : active l'option, colle le mot de passe, **Tester la connexion**. Si OBS enregistre ailleurs que ton dossier de recs, Frag propose de l'utiliser.
3. Choisis quand démarrer (chargement de la game ou sélection d'agent) et quand arrêter.

Pendant la game, Frag note chaque fin de round (le score lu sur le client Riot) : la rec arrive avec un marqueur par round, elle est renommée `2026-11-07 16-47-31 · Ascent · Swiftplay · 5-3.mp4`, et une fois liée au match elle est calée toute seule sur ces fins de round (à une seconde près environ ; « Caler automatiquement » ou un kill pour être à l'image près).

Frag lit l'état de Valorant sur le client Riot de ton PC (menus / sélection d'agent / en game), rien ne sort en ligne. Il ne touche pas à un enregistrement lancé à la main et ne filme pas le stand de tir. L'état s'affiche en haut à droite (« OBS prêt », « REC 12:34 »…).

## En arrière-plan

Fermer la fenêtre ne quitte pas Frag : il reste dans la zone de notification (près de l'horloge) pour que l'enregistrement auto continue. Clic sur l'icône pour rouvrir la fenêtre, clic droit pour l'état de l'enregistrement, les dossiers des recs et des clips, ou **Quitter**. Pendant une rec, l'icône prend un point rouge.

Frag t'envoie une notification Windows quand :

- Valorant est lancé mais pas OBS (clic pour lancer OBS) ;
- une rec vient d'être liée à son match (clic pour l'ouvrir) ;
- la file d'export est terminée (clic pour ouvrir le dossier).

Dans les réglages, section **Arrière-plan** : garder ou non Frag dans la zone de notification en fermant, le lancer (caché) au démarrage de Windows, couper les notifications. Relancer Frag alors qu'il tourne déjà réaffiche simplement la fenêtre.

## Recs courtes et recs de test

Une rec plus courte que le seuil choisi dans les réglages (5 min par défaut), ou qui ne filme qu'une petite partie du match, n'est jamais liée toute seule : tu peux toujours la lier à la main. Dans la bibliothèque, tu peux masquer les recs courtes, et l'icône corbeille (au survol d'une rec) l'envoie dans la corbeille de Windows. Si deux recs sont liées au même match, les Stats ne le comptent qu'une fois.

## Revoir tes games pour progresser

Onglet **Revoir** dans l'éditeur (match lié) : des playlists qui enchaînent automatiquement les passages à revoir.

- **Mes morts** : chaque mort, de 6 s avant à 2 s après
- **Premières morts** : tu es le premier à tomber dans le round
- **Non tradées** : personne n'a tué ton tueur dans les 3 s
- **Clutchs ratés** : seul en vie face à au moins un ennemi, round perdu
- **Avantage perdu** : ton équipe a fait le first blood mais a perdu le round

Sur chaque passage, tague l'erreur (« Peek seul », « Mauvais placement », « Pas d'utilitaire »…) et écris ce que tu aurais dû faire. `,` / `.` pour passer au précédent / suivant.

## Stats

Onglet **Stats** en haut : victoires, K/D, ADR, headshots, courbe de ton K/D game après game, duels d'ouverture, morts non tradées, clutchs, tableaux par agent et par map, et tes erreurs les plus fréquentes d'après tes tags.

## Montage

Bouton **Montage** dans la bibliothèque : choisis des clips de n'importe quelles recs, mets-les dans l'ordre, choisis la transition (coupe sèche, fondu court ou long) et des cartons titres en option, puis exporte.

### Clé et quota HenrikDev

Dans les réglages : la clé est testée avant d'être enregistrée, le quota de requêtes par minute est réglable (30 pour une clé Basic, 90 Advanced, plus pour les offres Premium) et Frag ne le dépasse jamais. Chaque Riot ID ajouté est vérifié auprès de Riot (PUUID, région, niveau).

## Raccourcis

| Touche | Action |
| --- | --- |
| Espace | Lecture / pause |
| ← / → | Image par image |
| Maj + ← / → | ± 1 s |
| J / L | ± 5 s |
| ↑ / ↓ | Marqueur ou bord de clip précédent / suivant |
| N / Maj + N | Kill suivant / précédent (match lié) |
| , / . | Passage précédent / suivant (onglet Revoir) |
| C | Nouveau clip des 10 dernières secondes |
| I / O | Début / fin du clip sélectionné (crée un clip si aucun n'est sélectionné) |
| Tab | Clip suivant |
| Entrée | Lire le clip sélectionné |
| R | Boucle sur le clip |
| M | Poser un marqueur |
| Maj + M | Supprimer le marqueur sous la tête de lecture |
| Suppr | Supprimer le clip ou le marqueur sélectionné (clic droit sur un marqueur marche aussi) |
| E / Maj + E | Exporter le clip sélectionné / tous les clips cochés |
| Ctrl + Z | Annuler |
| + / − / 0 | Zoom timeline / tout afficher (ou Ctrl + molette) |
| Échap | Désélectionner, puis retour à la bibliothèque |

## Export

- **Précise · NVENC** : coupe à l'image près, réencodée sur la carte graphique (H.264). Si NVENC n'est pas dispo, l'app bascule seule sur le processeur.
- **Instantanée** : aucun réencodage, qualité d'origine, quasi instantané. La coupe se cale sur l'image clé la plus proche, donc le début peut bouger d'une ou deux secondes.
- **Audio** : garder toutes les pistes séparées, seulement la piste 1, ou tout mixer en une seule piste (pratique pour Discord).

## Structure

```
src/main       processus Electron : fichiers, FFmpeg, file d'export
src/preload    pont sécurisé entre l'interface et le système
src/renderer   interface React (bibliothèque, éditeur, timeline)
src/shared     types partagés
```

Les données de l'app (réglages, clips, cache des vignettes) sont dans `%APPDATA%\Frag`.
