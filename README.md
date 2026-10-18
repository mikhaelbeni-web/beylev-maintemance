# Maintenance Beylev

Planning des interventions techniques, style monday.com, sans build (React 18 + Babel + Tailwind + Firestore compat 9.22.2, CDN jsDelivr).

```
public/index.html          application
public/manifest.json       PWA
api/send-email.js          proxy Resend
api/calendar.js            flux ICS : /api/calendar?user=u3
api/healthcheck.js         cron quotidien : Firestore, comptes, app, Resend, sauvegarde des comptes, alerte email
api/hostaway-import.js     taches Hostaway "pending", adresses des annonces, reservations groupees par listingMapId
vercel.json                outputDirectory public + cron
```

## Variables d'environnement Vercel (obligatoires avant de deployer cette version)

Projet Vercel > Settings > Environment Variables (Production et Preview), puis redeployer :

| Variable | Obligatoire | Valeur |
|---|---|---|
| `RESEND_API_KEY` | oui | cle Resend (`re_...`) |
| `HOSTAWAY_CLIENT_SECRET` | oui | secret API Hostaway |
| `HOSTAWAY_ACCOUNT_ID` | non | `148614` par defaut |
| `EMAIL_FROM` | non | `gestion@beylev.com` par defaut |

Sans ces variables, les emails et l'import Hostaway renvoient une erreur explicite.

## Donnees Firestore (`app_data`, format inchange)

Chaque document contient `{ v: "<JSON>" }`.

- `lv_users_v1` : tableau des comptes
- `lv_missions_AAAA_MM` : `{ "AAAA-MM-JJ": [missions] }`, toujours ecrit dans le mois de la date de debut
- `lv_companies_v1` : `[{ id, name, addresses: ["adresse"] }]`, une adresse appartient a une seule societe ; le lien se fait sur le texte du champ `location` des missions (casse et accents ignores), les missions ne sont pas modifiees
- `users_trash`, `hostaway_handled_ids`, `hostaway_notifications`, `users_backups`
- `app_photos/{id}` : `{ b: "<base64>" }`, reference par `mission.photos[{ id }]`

Nouveaux champs optionnels sur une mission : `time`, `deletedAt`/`deletedBy` (corbeille 30 jours), `approvedBy`/`approvedAt`.
