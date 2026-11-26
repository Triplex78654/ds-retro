# Catalogue de ds-retro

Les jeux de ce dossier apparaissent dans l'onglet **Catalogue** de la console, pour tout le monde.

## Ajouter un jeu

1. Sur GitHub, ouvre ce dossier `catalogue`, puis **Add file → Upload files**.
2. Dépose le fichier du jeu (`.nds`, `.zip` ou `.7z`, 25 Mo maximum par l'interface web), puis **Commit changes**.
3. C'est tout : la liste `jeux.json` se met à jour toute seule en une minute environ.

## Jeu de plus de 25 Mo

La page web de GitHub refuse les fichiers de plus de 25 Mo. Découpe le jeu en morceaux :

1. Avec 7-Zip : clic droit sur le jeu, **7-Zip → Ajouter à l'archive…**, format **7z**,
   et dans **Découper en volumes**, écris `24M`. Tu obtiens `Jeu.7z.001`, `Jeu.7z.002`…
2. Envoie tous les morceaux dans ce dossier (tu peux les glisser ensemble).
3. La console les recolle toute seule au téléchargement : le jeu n'apparaît qu'une fois dans le catalogue.

Pour une belle fiche (genre, nombre de joueurs, auteur…), complète l'entrée du jeu dans `jeux.json`.
Les champs que tu ajoutes sont conservés aux mises à jour suivantes.

## Quels jeux ?

Ce dépôt et le site sont **publics** : n'importe qui peut télécharger ce qui est ici.
Ne mets que des jeux que tu as le droit de partager (homebrews sous licence libre, créations perso).
Les jeux du commerce restent dans « Tes cartouches », sur ton appareil.

Mets la licence de chaque jeu dans `licences/`.

## Jeux inclus

- **Space Impakto DS** par Relminator (Richard Eric M. Lope), licence MIT — https://github.com/relminator/SpaceImpakto-DS
