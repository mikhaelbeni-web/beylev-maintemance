// Migration en douceur vers Firebase Auth.
// A la premiere connexion d'un utilisateur qui n'a pas encore de compte Firebase, l'app envoie ici
// son identifiant et son ancien mot de passe. S'il correspond a celui stocke dans lv_users_v1, on cree
// le compte Firebase avec ce meme mot de passe et on le rattache (authUid + claims).
// L'ancien mot de passe reste dans Firestore tant que l'admin n'a pas clique sur
// "Supprimer les anciens mots de passe" dans Reglages : l'ancienne version de l'app continue donc de marcher
// pendant la transition. Les mots de passe maitres ne sont plus acceptes.
const fb = require("./_lib/firebase");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return fb.send(res, 405, { error: "Method Not Allowed" });
  const refused = () => fb.send(res, 401, { error: "Identifiant ou mot de passe incorrect" });
  try {
    const p = fb.body(req);
    const username = String(p.username || "").trim().toLowerCase();
    const password = typeof p.password === "string" ? p.password : "";
    if (!username || !password) return refused();

    const users = (await fb.getDoc(fb.USERS_KEY)) || [];
    const u = users.find(x => (x.username || "").toLowerCase() === username);
    // Deja migre : seul le mot de passe Firebase compte desormais.
    if (!u || u.authUid || !u.password || u.password !== password) return refused();
    if (!fb.USERNAME_RE.test(username)) return fb.send(res, 400, { error: "Identifiant invalide pour le nouveau systeme (lettres, chiffres, . _ - uniquement) : un administrateur doit le modifier dans Reglages" });
    if (password.length < 6) return fb.send(res, 400, { error: "Mot de passe trop court pour le nouveau systeme : un administrateur doit en definir un nouveau dans Reglages" });

    const email = fb.emailOf(username);
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

    // Rattachement dans une transaction pour ne pas ecraser une modification concurrente de la liste.
    await fb.db().runTransaction(async tx => {
      const ref = fb.docRef(fb.USERS_KEY);
      const list = fb.parseSnap(await tx.get(ref)) || [];
      tx.set(ref, { v: JSON.stringify(list.map(x => x.id === u.id ? { ...x, authUid: record.uid } : x)) });
    });
    fb.send(res, 200, { ok: true });
  } catch (e) {
    console.error("auth-migrate", e);
    fb.send(res, e.status || 500, { error: e.message });
  }
};
