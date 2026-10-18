// Gestion des utilisateurs depuis Reglages (admin ou manager avec acces aux reglages).
// Toute ecriture de lv_users_v1 passe par ici pour garder les comptes Firebase (email, mot de passe,
// role dans les claims, activation) alignes sur la liste de l'application.
// Actions (POST { action, ... }) :
//   list                -> utilisateurs sans mots de passe + liens calendrier signes
//   sync     { users }  -> enregistre la liste ; newPassword optionnel par utilisateur
//   delete   { id }     -> corbeille + compte Firebase desactive
//   restore  { id, deletedAt } -> sortie de corbeille + compte reactive
//   purgeLegacyPasswords -> supprime les anciens mots de passe en clair (lv_users_v1, corbeille, sauvegardes)
const fb = require("./_lib/firebase");

const ROLES = ["admin", "manager", "tech"];
const EDITABLE = ["username", "name", "email", "role", "color", "initials", "adminAccess"];

function calendarLinks(req, users) {
  const origin = `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const out = {};
  users.forEach(u => { out[u.id] = `${origin}/api/calendar?user=${encodeURIComponent(u.id)}&k=${fb.calendarToken(u.id)}`; });
  return out;
}

async function updateAuthUser(u, changes) {
  if (!u.authUid) return;
  try { await fb.auth().updateUser(u.authUid, changes); }
  catch (e) { if (e.code !== "auth/user-not-found") throw e; }
}

/* Cree ou met a jour le compte Firebase d'un utilisateur et renvoie son uid. */
async function ensureAuthUser(u, password) {
  const email = fb.emailOf(u.username);
  if (u.authUid) {
    try { await fb.auth().updateUser(u.authUid, { email, password, displayName: u.name, disabled: false }); return u.authUid; }
    catch (e) { if (e.code !== "auth/user-not-found") throw e; }
  }
  try {
    const existing = await fb.auth().getUserByEmail(email);
    await fb.auth().updateUser(existing.uid, { password, displayName: u.name, disabled: false });
    return existing.uid;
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    return (await fb.auth().createUser({ email, password, displayName: u.name })).uid;
  }
}

async function sync(req, me, current, incoming) {
  if (!Array.isArray(incoming) || !incoming.length) throw fb.httpError(400, "Liste vide");
  const byId = Object.fromEntries(current.map(u => [u.id, u]));
  const missing = current.filter(u => !incoming.some(x => x.id === u.id));
  if (missing.length) throw fb.httpError(409, "La liste a change entre-temps, rechargez la page");

  const next = incoming.map(x => {
    const prev = byId[x.id] || {};
    const u = { ...prev };
    EDITABLE.forEach(k => { if (x[k] !== undefined) u[k] = x[k]; });
    u.id = String(x.id);
    u.username = String(u.username || "").trim().toLowerCase();
    if (u.role !== "manager") delete u.adminAccess;
    return { u, prev, newPassword: typeof x.newPassword === "string" && x.newPassword ? x.newPassword : null };
  });

  const names = next.map(n => n.u.username);
  if (names.some(n => !fb.USERNAME_RE.test(n))) throw fb.httpError(400, "Identifiant invalide : 2 a 40 caracteres, lettres minuscules, chiffres, . _ -");
  if (new Set(names).size !== names.length) throw fb.httpError(400, "Deux utilisateurs ont le meme identifiant");
  if (next.some(n => !ROLES.includes(n.u.role))) throw fb.httpError(400, "Role inconnu");
  if (!next.some(n => n.u.role === "admin")) throw fb.httpError(400, "Il doit rester au moins un administrateur");
  for (const n of next) {
    if (n.newPassword && n.newPassword.length < 6) throw fb.httpError(400, `Mot de passe de ${n.u.name || n.u.username} : 6 caracteres minimum`);
    if (!n.u.authUid && !n.u.password && !n.newPassword) throw fb.httpError(400, `${n.u.name || n.u.username} : mot de passe requis`);
  }

  for (const n of next) {
    const { u, prev, newPassword } = n;
    if (newPassword) u.authUid = await ensureAuthUser(u, newPassword);
    else if (u.authUid && (prev.username !== u.username || prev.name !== u.name)) await updateAuthUser(u, { email: fb.emailOf(u.username), displayName: u.name });
    if (u.authUid) {
      await fb.auth().setCustomUserClaims(u.authUid, fb.claimsOf(u));
      const lostRights = prev.authUid && ((prev.role === "admin" && u.role !== "admin") || (fb.canSettings(prev) && !fb.canSettings(u)) || (prev.role !== "tech" && u.role === "tech"));
      if (lostRights) await fb.auth().revokeRefreshTokens(u.authUid);
    }
  }
  const list = next.map(n => n.u);
  await fb.setDoc(fb.USERS_KEY, list);
  return list;
}

async function remove(me, users, id) {
  const u = users.find(x => x.id === id);
  if (!u) throw fb.httpError(404, "Utilisateur introuvable");
  if (u.id === me.id) throw fb.httpError(400, "Impossible de supprimer son propre compte");
  if (u.role === "admin" && !users.some(x => x.id !== id && x.role === "admin")) throw fb.httpError(400, "Impossible de supprimer le dernier administrateur");
  const trash = (await fb.getDoc(fb.USERS_TRASH_KEY)) || [];
  await fb.setDoc(fb.USERS_TRASH_KEY, [...trash, { ...u, deletedAt: new Date().toISOString(), deletedBy: me.id }]);
  await fb.setDoc(fb.USERS_KEY, users.filter(x => x.id !== id));
  if (u.authUid) { await updateAuthUser(u, { disabled: true }); await fb.auth().revokeRefreshTokens(u.authUid).catch(() => {}); }
}

async function restore(users, id, deletedAt) {
  const trash = (await fb.getDoc(fb.USERS_TRASH_KEY)) || [];
  const t = trash.find(x => x.id === id && String(x.deletedAt) === String(deletedAt));
  if (!t) throw fb.httpError(404, "Introuvable dans la corbeille");
  if (users.some(x => x.username === t.username || x.id === t.id)) throw fb.httpError(409, "Un utilisateur actif a deja cet identifiant");
  const { deletedAt: _d, deletedBy: _b, ...u } = t;
  await fb.setDoc(fb.USERS_KEY, [...users, u]);
  await fb.setDoc(fb.USERS_TRASH_KEY, trash.filter(x => x !== t));
  if (u.authUid) { await updateAuthUser(u, { disabled: false }); await fb.auth().setCustomUserClaims(u.authUid, fb.claimsOf(u)).catch(() => {}); }
}

const stripMigrated = list => (Array.isArray(list) ? list : []).map(u => (u && u.authUid ? (({ password, ...r }) => r)(u) : u));

async function purgeLegacyPasswords(users) {
  await fb.setDoc(fb.USERS_KEY, stripMigrated(users));
  const trash = await fb.getDoc(fb.USERS_TRASH_KEY);
  if (Array.isArray(trash)) await fb.setDoc(fb.USERS_TRASH_KEY, trash.map(({ password, ...r }) => r));
  // Les sauvegardes quotidiennes contiennent d'anciennes copies des mots de passe : on les retire toutes.
  const backups = await fb.getDoc(fb.USERS_BACKUPS_KEY);
  if (Array.isArray(backups)) await fb.setDoc(fb.USERS_BACKUPS_KEY, backups.map(b => ({ ...b, users: (b.users || []).map(({ password, ...r }) => r) })));
  return users.filter(u => !u.authUid).map(u => u.username);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return fb.send(res, 405, { error: "Method Not Allowed" });
  try {
    const { user: me, users } = await fb.requireUser(req, { settings: true });
    const p = fb.body(req);
    let list = users, extra = {};
    if (p.action === "list") { /* lecture seule */ }
    else if (p.action === "sync") list = await sync(req, me, users, p.users);
    else if (p.action === "delete") { await remove(me, users, p.id); list = users.filter(x => x.id !== p.id); }
    else if (p.action === "restore") { await restore(users, p.id, p.deletedAt); list = (await fb.getDoc(fb.USERS_KEY)) || []; }
    else if (p.action === "purgeLegacyPasswords") {
      if (me.role !== "admin") throw fb.httpError(403, "Reserve aux administrateurs");
      extra.notMigrated = await purgeLegacyPasswords(users);
      list = stripMigrated(users);
    }
    else throw fb.httpError(400, "Action inconnue");
    fb.send(res, 200, { ok: true, users: list.map(fb.publicUser), calendars: calendarLinks(req, list), ...extra });
  } catch (e) {
    if (!e.status) console.error("admin-users", e);
    fb.send(res, e.status || 500, { error: e.message });
  }
};
