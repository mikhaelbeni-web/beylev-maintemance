# Maintenance Beylev

Planning des interventions techniques, style monday.com, sans build (React 18 + Babel + Tailwind + Firestore compat 9.22.2, CDN jsDelivr).

```
public/index.html          application
public/manifest.json       PWA
api/_lib/firebase.js       Admin SDK (compte de service), verification du jeton Firebase, lien calendrier signe
api/auth-migrate.js        migration automatique d un compte vers Firebase Auth a sa premiere connexion
api/admin-users.js         gestion des utilisateurs (Reglages) : comptes Firebase, roles, corbeille
api/send-email.js          proxy Resend (utilisateur connecte)
api/calendar.js            flux ICS signe : /api/calendar?user=u3&k=... (lien dans Reglages)
api/healthcheck.js         cron quotidien : Firestore, comptes, Firebase Auth, app, Resend, sauvegarde des comptes, alerte email
api/hostaway-import.js     taches Hostaway "pending" (admin ou manager connecte)
firestore.rules            regles Firestore a publier en dernier (voir plus bas)
package.json               dependance firebase-admin des fonctions
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
| `FIREBASE_SERVICE_ACCOUNT` | oui | JSON de la cle du compte de service Firebase (brut ou base64) |
| `CALENDAR_SECRET` | non | secret de signature des liens calendrier (a defaut : cle du compte de service) |
| `CRON_SECRET` | non | si defini, seul le cron Vercel peut appeler `/api/healthcheck` |

Sans ces variables, les emails et l'import Hostaway renvoient une erreur explicite.

## Donnees Firestore (`app_data`, format inchange)

Chaque document contient `{ v: "<JSON>" }`.

- `lv_users_v1` : tableau des comptes
- `lv_missions_AAAA_MM` : `{ "AAAA-MM-JJ": [missions] }`, toujours ecrit dans le mois de la date de debut
- `users_trash`, `hostaway_handled_ids`, `hostaway_notifications`, `users_backups`
- `app_photos/{id}` : `{ b: "<base64>" }`, reference par `mission.photos[{ id }]`

Nouveaux champs optionnels sur une mission : `time`, `deletedAt`/`deletedBy` (corbeille 30 jours), `approvedBy`/`approvedAt`.

## Connexion (Firebase Auth)

- Connexion par identifiant + mot de passe. L identifiant `tech` correspond au compte Firebase `tech@maintenance.beylev.com` (email technique, aucun email n y est envoye).
- Les claims du jeton (`appUserId`, `role`, `settings`) sont poses par le serveur ; le role affiche dans l app reste celui de `lv_users_v1`.
- Premiere connexion apres le passage a Firebase Auth : si le mot de passe correspond a l ancien mot de passe stocke, `api/auth-migrate` cree le compte Firebase avec ce meme mot de passe. Les mots de passe maitres ne sont plus acceptes.
- Les anciens mots de passe restent dans Firestore pendant la transition (l ancienne version continue de marcher), puis un admin les efface depuis Reglages ("Supprimer les anciens mots de passe").

Ordre de mise en production :

1. Firebase : Authentication > Sign-in method > Email/Password active. Conseille : Authentication > Settings > User actions > decocher "Enable create (sign-up)".
2. Firebase : Parametres du projet > Comptes de service > Generer une cle privee ; copier le JSON dans `FIREBASE_SERVICE_ACCOUNT` (Production et Preview) sur Vercel.
3. Tester l apercu Vercel de la branche, puis fusionner.
4. Chacun se reconnecte une fois ; Reglages affiche qui est migre.
5. Reglages > "Supprimer les anciens mots de passe".
6. Publier `firestore.rules` dans Firestore > Regles.
