# Mettre ds-retro dans Discord (Activité)

Le code est prêt : la page détecte toute seule quand elle tourne dans Discord.
Il reste à créer l'application Discord et à la régler. Tout se fait sur
https://discord.com/developers/applications

## 1. Créer l'application
1. **New Application**, nom : `DS Rétro`, accepte les conditions.
2. Page **General Information** : copie l'**Application ID**.
3. Colle-le dans `config.js` de ce dépôt (`discordApplicationId: "..."`) ou envoie-le à Claude.
   Ne copie jamais le **Client Secret** dans ce dépôt : il est public.

## 2. Activer l'Activité
1. Menu **Activities** > **Getting Started** : active les Activités pour l'appli.
2. Menu **Activities** > **URL Mappings** :

| Prefix | Target |
|---|---|
| `/` (Root Mapping) | `triplex78654.github.io/ds-retro` |
| `/emulatorjs` | `cdn.emulatorjs.org` |

La deuxième ligne est obligatoire : Discord bloque tout site non déclaré, et l'émulateur se charge depuis cdn.emulatorjs.org.

## 3. Installer l'appli sur ton serveur
1. Menu **Installation** : coche **Guild Install**, scope `applications.commands`.
2. Ouvre le lien d'installation et ajoute l'appli à ton serveur.
3. Tant que l'appli n'est pas vérifiée, seuls toi et les membres de l'équipe de l'appli (menu **App Testers**) peuvent lancer l'Activité.

## 4. Lancer
Rejoins un salon vocal > icône **Activités** (fusée) > **DS Rétro**.

## Limites connues
- Le fichier du jeu se choisit sur l'appareil de chaque joueur (rien n'est hébergé).
- Sur le Discord mobile, le choix de fichier dépend du téléphone.
