# ds-retro

Console Nintendo DS jouable en Activité Discord, dans le salon vocal de ton serveur, sur PC et sur mobile.
Elle lit aussi les jeux Game Boy Advance, Game Boy et Game Boy Color (comme une DS Lite : le jeu GBA s'affiche sur l'écran du haut).

- Émulateur : [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) 4.2.3 (GPL-3), cœurs DeSmuME (DS) et mGBA (GBA, GB, GBC), hébergé dans `emulateur/` (version figée, rien chargé d'ailleurs).
- Tes jeux restent sur ton appareil, avec une copie privée dans ton cloud (visible par toi seul). Le bouton « + Catalogue » montre seulement leur nom aux membres du salon : ils y jouent sur ta console, à distance.
- Le dossier `catalogue/` est **public** : seulement des jeux libres (homebrew avec licence), jamais tes propres jeux.
- Accès réservé au propriétaire de l'appli Discord et aux membres des serveurs où il ouvre l'Activité.
- Police des écrans : Pixelify Sans (SIL Open Font License, voir `polices/`).
- Aucun jeu ni BIOS Nintendo n'est inclus.

Site : https://triplex78654.github.io/ds-retro/

## Organisation

| Dossier | Contenu |
| --- | --- |
| `index.html` | La console (structure HTML) |
| `console/styles/` | Styles, un fichier par partie (thèmes, console, menu, salon, décors, formats) |
| `console/js/` | Script, un fichier par partie ; rassemblés dans `console.js` |
| `serveur/` | Worker Cloudflare : salon, sauvegardes, cloud (voir `serveur/README.md`) |
| `tests/` | Scénarios de bout en bout, lancés par GitHub avant chaque publication (`tests/roms/` : petite ROM GBA écrite pour les tests) |
| `emulateur/` | EmulatorJS 4.2.3 et les cœurs DS et GBA |
| `catalogue/` | Jeux libres pour tout le monde |

Après une modification dans `console/js/`, lance `node outils-depot/assembler.mjs` pour mettre `console.js` à jour
(les tests le vérifient). Tests en local : `cd tests && npm install && npx playwright install chromium && node lancer.mjs`.
