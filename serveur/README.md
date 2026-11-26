# Serveur de ds-retro

Worker Cloudflare (`ds-retro-serveur`) avec deux Durable Objects :

- **Salle** : un salon par Activité lancée dans un vocal. Relaie l'écran de l'hôte et la manette partagée.
- **Coffre** : les sauvegardes de chaque joueur Discord, jeu par jeu.

Publication automatique par GitHub Actions (`.github/workflows/serveur.yml`) à chaque modification de ce dossier.
Secrets GitHub nécessaires : `CLOUDFLARE_API_TOKEN`, `DISCORD_CLIENT_SECRET`.

Dans le portail Discord, le mapping d'URL `/api` pointe vers `ds-retro-serveur.estamveille2026.workers.dev`.

Test en local : `npm install`, puis `npx wrangler dev` avec un fichier `.dev.vars` contenant `DEV_SANS_AUTH=1`.
