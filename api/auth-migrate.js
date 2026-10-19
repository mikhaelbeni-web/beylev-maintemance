// Aide a la connexion Firebase Auth, appelee sans jeton depuis l'ecran de connexion.
//
// POST { username, password } (username = identifiant ou email), appele quand la connexion directe a echoue :
//   - utilisateur pas encore migre : si le mot de passe correspond a l'ancien mot de passe stocke dans lv_users_v1,
//     on cree le compte Firebase (email reel s'il est renseigne, sinon email technique) avec ce meme mot de passe ;
//   - utilisateur deja migre qui tape son identifiant alors que son compte Firebase porte son email reel :
//     on verifie le mot de passe aupres de Firebase.
//   Dans les deux cas on renvoie { email } : l'email avec lequel le navigateur se connecte ensuite.
//   L'ancien mot de passe reste dans Firestore tant que l'admin n'a pas clique sur "Supprimer les anciens mots
//   de passe" dans Reglages : l'ancienne version de l'app continue donc de marcher pendant la transition.
//   Les mots de passe maitres ne sont plus acceptes.
//
// POST { action: "prepareReset", email } ("Mot de passe oublie") : si un utilisateur a cet email et n'a pas encore
//   de compte Firebase, on le cree (mot de passe aleatoire) pour que Firebase puisse envoyer le lien de
//   reinitialisation. Reponse toujours identique, pour ne pas reveler quels emails existent.
const crypto = require("crypto");
const fb = require("./_lib/firebase");

/* Compte cree par prepareReset et jamais utilise : l'ancien mot de passe peut encore servir a migrer. */
const neverSignedIn = r => !(r.metadata && r.metadata.lastSignInTime);

async function login(res, p) {
  const refused = () => fb.send(res, 401, { error: "Identifiant ou mot de passe incorrect" });
  const password = typeof p.password === "string" ? p.password : "";
  const users = (await fb.getDoc(fb.USERS_KEY)) || [];
  const u = fb.findByLogin(users, p.username);
  if (!u || !password) return refused();
  const legacyOk = !!u.password && u.password === password;

  if (u.authUid) {
    let record;
    try { record = await fb.auth().getUser(u.authUid); }
    catch (e) { if (e.code === "auth/user-not-found") return refused(); throw e; }
    if (record.disabled) return fb.send(res, 403, { error: "Ce compte est désactivé." });
    if (legacyOk && neverSignedIn(record)) {
      await fb.auth().updateUser(record.uid, { password });
      return fb.send(res, 200, { ok: true, email: record.email });
    }
    if (await fb.passwordOk(record.email, password)) return fb.send(res, 200, { ok: true, email: record.email });
    return refused();
  }

  if (!legacyOk) return refused();
  const username = (u.username || "").toLowerCase();
  if (!fb.USERNAME_RE.test(username)) return fb.send(res, 400, { error: "Identifiant invalide pour le nouveau systeme (lettres, chiffres, . _ - uniquement) : un administrateur doit le modifier dans Reglages" });
  if (password.length < 6) return fb.send(res, 400, { error: "Mot de passe trop court pour le nouveau systeme : un administrateur doit en definir un nouveau dans Reglages" });

  const email = fb.authEmailOf(u);
  let record;
  try {
    record = await fb.auth().getUserByEmail(email);
    // Compte cree a la main dans la console : l'ancien mot de passe prouve l'identite, on l'aligne.
    record = await fb.auth().updateUser(record.uid, { password, displayName: u.name || username, disabled: false });
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    record = await fb.auth().createUser({ email, password, displayName: u.name || username });
  }
  await fb.auth().setCustomUserClaims(record.uid, fb.claimsOf(u));
  await fb.attachAuthUid(u.id, record.uid);
  fb.send(res, 200, { ok: true, email });
}

async function prepareReset(res, p) {
  const email = fb.normEmail(p.email);
  const users = (await fb.getDoc(fb.USERS_KEY)) || [];
  const u = email && fb.EMAIL_RE.test(email) ? users.find(x => fb.normEmail(x.email) === email) : null;
  if (u && !u.authUid) {
    let record;
    try { record = await fb.auth().getUserByEmail(email); }
    catch (e) {
      if (e.code !== "auth/user-not-found") throw e;
      record = await fb.auth().createUser({ email, password: crypto.randomBytes(24).toString("base64url"), displayName: u.name || u.username });
    }
    await fb.auth().setCustomUserClaims(record.uid, fb.claimsOf(u));
    await fb.attachAuthUid(u.id, record.uid);
  } else if (u && u.authUid) {
    // Email modifie dans la base sans passer par Reglages : on realigne le compte Firebase.
    const record = await fb.auth().getUser(u.authUid).catch(() => null);
    if (record && record.email !== email) await fb.auth().updateUser(u.authUid, { email }).catch(e => console.error("prepareReset email", e.code));
  }
  fb.send(res, 200, { ok: true });
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return fb.send(res, 405, { error: "Method Not Allowed" });
  try {
    const p = fb.body(req);
    if (p.action === "prepareReset") return await prepareReset(res, p);
    return await login(res, p);
  } catch (e) {
    console.error("auth-migrate", e);
    fb.send(res, e.status || 500, { error: e.message });
  }
};
