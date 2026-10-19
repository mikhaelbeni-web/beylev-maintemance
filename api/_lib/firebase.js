// Acces serveur a Firebase (Admin SDK) partage par les fonctions api/.
// Le compte de service est lu dans FIREBASE_SERVICE_ACCOUNT (JSON brut ou base64),
// il contourne les regles Firestore : les fonctions marchent quelles que soient les regles publiees.
const crypto = require("crypto");
const admin = require("firebase-admin");

const COL = "app_data";
const USERS_KEY = "lv_users_v1";
const USERS_TRASH_KEY = "users_trash";
const USERS_BACKUPS_KEY = "users_backups";
// Email du compte Firebase : l'email reel de l'utilisateur (champ email de lv_users_v1) s'il est renseigne,
// sinon un email technique derive de l'identifiant (meme regle que public/index.html), qui ne recoit rien.
const AUTH_EMAIL_DOMAIN = "maintenance.beylev.com";
const USERNAME_RE = /^[a-z0-9._-]{2,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Cle web publique (deja dans public/index.html), utilisee pour verifier un mot de passe cote serveur.
const WEB_API_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyB7i6PnqFAdBuGufM04BKGYWwRT0P8GClc";

let serviceAccount = null;
/* Accepte le JSON brut (eventuellement entoure de guillemets ou d'espaces) ou sa version base64. */
function parseServiceAccount(raw) {
  const tryJson = t => { try { let v = JSON.parse(t); if (typeof v === "string") v = JSON.parse(v); return v && typeof v === "object" ? v : null; } catch (e) { return null; } };
  const t = String(raw).trim().replace(/^'([\s\S]*)'$/, "$1");
  const v = tryJson(t) || tryJson(Buffer.from(t, "base64").toString("utf8"));
  if (!v || !v.private_key || !v.client_email) throw Object.assign(new Error("FIREBASE_SERVICE_ACCOUNT illisible : collez le contenu complet du fichier JSON de la cle (de { a })"), { status: 500 });
  return v;
}
function getServiceAccount() {
  if (serviceAccount) return serviceAccount;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw Object.assign(new Error("FIREBASE_SERVICE_ACCOUNT manquante dans les variables Vercel"), { status: 500 });
  serviceAccount = parseServiceAccount(raw);
  return serviceAccount;
}

function app() {
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(getServiceAccount()) });
  return admin.app();
}
const db = () => app().firestore();
const auth = () => app().auth();

/* Format existant : doc { v: "<JSON>" } */
function parseSnap(snap) {
  if (!snap || !snap.exists) return null;
  const d = snap.data() || {};
  if (typeof d.v === "string") { try { return JSON.parse(d.v); } catch (e) { return null; } }
  return d.v === undefined ? null : d.v;
}
const docRef = k => db().collection(COL).doc(k);
async function getDoc(k) { return parseSnap(await docRef(k).get()); }
function setDoc(k, v) { return docRef(k).set({ v: JSON.stringify(v) }); }

const emailOf = username => `${String(username || "").trim().toLowerCase()}@${AUTH_EMAIL_DOMAIN}`;
const normEmail = e => String(e || "").trim().toLowerCase();
const authEmailOf = u => normEmail(u.email) || emailOf(u.username);
/* Utilisateur designe a la connexion par son identifiant ou par son email. */
function findByLogin(users, login) {
  const id = normEmail(login);
  if (!id) return null;
  return users.find(u => (u.username || "").toLowerCase() === id) || users.find(u => normEmail(u.email) === id) || null;
}

/* Verifie un mot de passe Firebase (API REST d'Auth, comme le ferait le navigateur). */
async function passwordOk(email, password) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${WEB_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: false })
  });
  return r.ok;
}

/* Rattache le compte Firebase a l'utilisateur, dans une transaction pour ne pas ecraser une modification concurrente. */
function attachAuthUid(userId, uid) {
  return db().runTransaction(async tx => {
    const ref = docRef(USERS_KEY);
    const list = parseSnap(await tx.get(ref)) || [];
    tx.set(ref, { v: JSON.stringify(list.map(x => x.id === userId ? { ...x, authUid: uid } : x)) });
  });
}
const canSettings = u => !!u && (u.role === "admin" || !!u.adminAccess);
const claimsOf = u => ({ appUserId: u.id, role: u.role, settings: canSettings(u) });
/* Ce qui peut sortir du serveur : jamais de mot de passe. */
const publicUser = ({ password, ...rest }) => ({ ...rest, legacyPassword: !!password });

function send(res, status, body) { res.status(status).json(body); }
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function body(req) { return (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) || {}; }

/* Verifie le jeton Firebase de l'en-tete Authorization et renvoie l'utilisateur de l'app (lu dans Firestore,
   donc le role est toujours a jour meme si le jeton date d'avant un changement de role). */
async function requireUser(req, { roles, settings } = {}) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) throw httpError(401, "Connexion requise");
  let decoded;
  try { decoded = await auth().verifyIdToken(token); }
  catch (e) { if (e.status) throw e; throw httpError(401, "Session expiree, reconnectez-vous"); }
  const users = (await getDoc(USERS_KEY)) || [];
  const user = users.find(u => u.authUid === decoded.uid);
  if (!user) throw httpError(403, "Compte non rattache a un utilisateur de l'application");
  if (roles && !roles.includes(user.role)) throw httpError(403, "Acces refuse");
  if (settings && !canSettings(user)) throw httpError(403, "Acces refuse");
  return { user, users, decoded };
}

/* Lien ICS par utilisateur : signe avec CALENDAR_SECRET, ou a defaut avec la cle du compte de service. */
function calendarToken(userId) {
  const secret = process.env.CALENDAR_SECRET || getServiceAccount().private_key;
  return crypto.createHmac("sha256", secret).update("calendar:" + userId).digest("base64url").slice(0, 32);
}
function calendarTokenOk(userId, k) {
  if (!userId || typeof k !== "string") return false;
  const a = Buffer.from(calendarToken(userId)), b = Buffer.from(k);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  admin, db, auth, getDoc, setDoc, docRef, parseSnap,
  USERS_KEY, USERS_TRASH_KEY, USERS_BACKUPS_KEY, AUTH_EMAIL_DOMAIN, USERNAME_RE, EMAIL_RE,
  emailOf, normEmail, authEmailOf, findByLogin, passwordOk, attachAuthUid, canSettings, claimsOf, publicUser, requireUser, calendarToken, calendarTokenOk,
  send, httpError, body
};
