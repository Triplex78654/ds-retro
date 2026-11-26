# Serveur de ds-retro

Worker Cloudflare (`ds-retro-serveur`) avec deux Durable Objects :

- **Salle** : un salon par Activité lancée dans un vocal. Relaie l'écran de l'hôte et la manette partagée.
- **Coffre** : les sauvegardes de chaque joueur Discord (avec historique) et sa ludothèque privée (fichiers dans R2).
- **Registre** : place utilisée dans R2 par chacun (plafond 9,5 Go) et serveurs Discord autorisés.

Accès : le jeton doit venir de l'appli Discord de ds-retro. Sont acceptés le propriétaire de l'appli et les membres
des serveurs Discord où il a ouvert l'Activité (enregistrés automatiquement à sa première ouverture).

Publication automatique par GitHub Actions (`.github/workflows/serveur.yml`) à chaque modification de ce dossier.
Secrets GitHub nécessaires : `CLOUDFLARE_API_TOKEN`, `DISCORD_CLIENT_SECRET`.

Dans le portail Discord, le mapping d'URL `/api` pointe vers l'adresse `workers.dev` du Worker.

Test en local : `npm install`, puis `npx wrangler dev` avec un fichier `.dev.vars` contenant `DEV_SANS_AUTH=1`
(les jetons `dev:<id>[:<serveur>]` ne sont acceptés que sur localhost).
