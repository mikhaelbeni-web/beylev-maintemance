# Maintenance Beylev

Planning des interventions techniques, style monday.com, sans build (React 18 + Babel + Tailwind + Firestore compat 9.22.2, CDN jsDelivr).

```
public/index.html          application
public/manifest.json       PWA
api/_lib/firebase.js       Admin SDK (compte de service), verification du jeton Firebase, lien calendrier signe
api/auth-migrate.js        connexion par identifiant, migration a la 1re connexion, preparation du mot de passe oublie
api/admin-users.js         gestion des utilisateurs (Reglages) : comptes Firebase, roles, corbeille
api/send-email.js          proxy Resend (utilisateur connecte, destinataires limites aux emails de l equipe)
api/calendar.js            flux ICS signe : /api/calendar?user=u3&k=... (lien dans Reglages)
api/healthcheck.js         cron quotidien : Firestore, comptes, Firebase Auth, app, Resend, sauvegarde des comptes, alerte email
api/hostaway-import.js     taches Hostaway "pending", adresses des annonces, reservations groupees par listingMapId (admin ou manager connecte)
api/monday.js              lecture seule Monday : /api/monday?action=boards | items&board=ID (admin ou manager connecte)
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
| `MONDAY_API_TOKEN` | pour Monday | jeton personnel Monday (avatar > Developers > My access tokens) |
| `EMAIL_FROM` | non | `gestion@beylev.com` par defaut |
| `FIREBASE_SERVICE_ACCOUNT` | oui | JSON de la cle du compte de service Firebase (brut ou base64) |
| `CALENDAR_SECRET` | non | secret de signature des liens calendrier (a defaut : cle du compte de service) |
| `APP_URL` | non | adresse de l app testee par le diagnostic quotidien (`https://beylev-vercel.vercel.app` par defaut) |
| `CRON_SECRET` | non | si defini, seul le cron Vercel peut appeler `/api/healthcheck` |

Sans ces variables, les emails et l'import Hostaway renvoient une erreur explicite.

## Donnees Firestore (`app_data`, format inchange)

Chaque document contient `{ v: "<JSON>" }`.

- `lv_users_v1` : tableau des comptes
- `lv_missions_AAAA_MM` : `{ "AAAA-MM-JJ": [missions] }`, toujours ecrit dans le mois de la date de debut
- `lv_companies_v1` : `[{ id, name, addresses: ["adresse"] }]`, une adresse appartient a une seule societe ; le lien se fait sur le texte du champ `location` des missions (casse et accents ignores), les missions ne sont pas modifiees
- `monday_config` : tableau choisi, correspondance des colonnes, `auto` (import automatique des nouveaux elements a l ouverture puis toutes les 10 min) ; `monday_handled_ids` : elements Monday deja importes ou ignores ; une mission importee porte `mondayId`
- `users_trash`, `hostaway_handled_ids`, `hostaway_notifications`, `users_backups`
- `app_photos/{id}` : `{ b: "<base64>" }`, reference par `mission.photos[{ id }]`

Nouveaux champs optionnels sur une mission : `time`, `deletedAt`/`deletedBy` (corbeille 30 jours), `approvedBy`/`approvedAt`.

## Connexion (Firebase Auth)

- Connexion par email ou identifiant + mot de passe. Le compte Firebase porte l email reel de l utilisateur (champ Email de Reglages) ; sans email renseigne, il porte un email technique `identifiant@maintenance.beylev.com` qui ne recoit rien. Si l utilisateur tape son identifiant, `api/auth-migrate` retrouve l email du compte apres verification du mot de passe.
- Un admin modifie l email d un membre dans Reglages : le compte Firebase est mis a jour en meme temps (emails uniques).
- "Mot de passe oublie ?" sur l ecran de connexion : Firebase envoie le lien de reinitialisation a l email du compte. Si l utilisateur n est pas encore migre, `api/auth-migrate` cree d abord son compte (mot de passe aleatoire) ; son ancien mot de passe reste accepte tant qu il ne s est jamais connecte au nouveau compte.
- Les claims du jeton (`appUserId`, `role`, `settings`) sont poses par le serveur ; le role affiche dans l app reste celui de `lv_users_v1`.
- Premiere connexion apres le passage a Firebase Auth : si le mot de passe correspond a l ancien mot de passe stocke, `api/auth-migrate` cree le compte Firebase avec ce meme mot de passe. Les mots de passe maitres ne sont plus acceptes.
- Les anciens mots de passe restent dans Firestore pendant la transition (l ancienne version continue de marcher), puis un admin les efface depuis Reglages ("Supprimer les anciens mots de passe").

Ordre de mise en production :

1. Firebase : Authentication > Sign-in method > Email/Password active. Conseille : Authentication > Settings > User actions > decocher "Enable create (sign-up)".
2. Firebase : Parametres du projet > Comptes de service > Generer une cle privee ; copier le JSON dans `FIREBASE_SERVICE_ACCOUNT` (Production et Preview) sur Vercel.
3. Firebase : Authentication > Settings > Authorized domains : ajouter le domaine Vercel de l app (sinon le lien de reinitialisation ne propose pas de revenir a l app). Optionnel : Authentication > Templates > Reinitialisation du mot de passe, langue francaise et nom d expediteur.
4. Tester l apercu Vercel de la branche, puis fusionner.
5. Reglages : renseigner l email de chaque membre et enregistrer.
6. Chacun se reconnecte une fois (ou utilise "Mot de passe oublie ?") ; Reglages affiche qui est migre.
7. Reglages > "Supprimer les anciens mots de passe".
8. Publier `firestore.rules` dans Firestore > Regles.
