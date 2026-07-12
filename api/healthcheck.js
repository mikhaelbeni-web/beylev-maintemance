// Healthcheck automatique - execute tous les jours a 8h (Cron Vercel)
// Verifie Firestore + Resend + integrite utilisateurs + backup quotidien
// Envoie alerte email UNIQUEMENT si probleme detecte

const RESEND_API_KEY = "re_JZgydhox_8XtWDrfwRFAQDcjWwxAXXz5g";
const FROM_EMAIL     = "gestion@beylev.com";
const ALERT_EMAIL    = "gestion@beylev.com";
const PROJECT_ID     = "planning-maintenance-9a3c4";
const API_KEY        = "AIzaSyB7i6PnqFAdBuGuFM84BKGYWwRT0P8GClc";
const APP_URL        = "https://beylev-vercel.vercel.app";

async function getDoc(docId) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/app_data/${docId}?key=${API_KEY}`;
  const r = await fetch(url);
  if (r.status === 403) throw new Error("REGLES FIRESTORE EXPIREES - republier sur console.firebase.google.com");
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Firestore HTTP " + r.status);
  const data = await r.json();
  if (!data.fields?.v?.stringValue) return null;
  return JSON.parse(data.fields.v.stringValue);
}

async function setDoc(docId, obj) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/app_data/${docId}?key=${API_KEY}`;
  await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { v: { stringValue: JSON.stringify(obj) } } })
  });
}

async function checkFirestore() {
  const users = await getDoc("lv_users_v1");
  if (!users || !Array.isArray(users)) throw new Error("Donnee utilisateurs corrompue ou absente");
  if (users.length === 0) throw new Error("Liste utilisateurs vide - possible corruption");
  return `${users.length} utilisateurs OK`;
}

async function checkUserIntegrity() {
  const users = await getDoc("lv_users_v1");
  const errors = [];
  const requiredUsernames = ["laetitia", "mikhael", "tech"];
  for (const req of requiredUsernames) {
    const u = users.find(x => x.username === req);
    if (!u) errors.push(`Compte "${req}" manquant`);
    else {
      if (!u.password || u.password.trim() === "") errors.push(`Compte "${req}" a un mot de passe vide`);
      if (!u.name || u.name.trim() === "") errors.push(`Compte "${req}" a un nom vide`);
    }
  }
  const admins = users.filter(u => u.role === "admin");
  if (admins.length === 0) errors.push("AUCUN administrateur - personne ne peut plus valider les interventions");
  if (errors.length > 0) throw new Error(errors.join(" | "));
  return `Integrite comptes OK (${users.length} users, ${admins.length} admin(s))`;
}

async function backupUsers() {
  const users = await getDoc("lv_users_v1");
  if (!users) return "Rien a sauvegarder";
  const backups = await getDoc("users_backups") || [];
  const today = new Date().toISOString().slice(0, 10);
  const existingToday = backups.find(b => b.date === today);
  if (existingToday) return "Backup du jour deja fait";
  backups.push({ date: today, users, createdAt: new Date().toISOString() });
  // Garde les 30 derniers backups
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const recent = backups.filter(b => new Date(b.createdAt).getTime() > cutoff);
  await setDoc("users_backups", recent);
  return `Backup cree (${recent.length} backups conservés)`;
}

async function checkAppReachable() {
  const r = await fetch(APP_URL, { method: "GET" });
  if (!r.ok) throw new Error(`Application inaccessible - HTTP ${r.status}`);
  const html = await r.text();
  if (!html.includes("Beylev") && !html.includes("root")) throw new Error("Application repond mais contenu inattendu");
  return "App accessible";
}

async function checkResend() {
  const r = await fetch("https://api.resend.com/domains", {
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}` }
  });
  if (r.status === 401) throw new Error("Cle API Resend invalide ou expiree");
  if (!r.ok) throw new Error("Resend inaccessible - HTTP " + r.status);
  const data = await r.json();
  const beylevDomain = (data.data || []).find(d => d.name === "beylev.com");
  if (!beylevDomain) throw new Error("Domaine beylev.com introuvable sur Resend");
  if (beylevDomain.status !== "verified") throw new Error(`Domaine beylev.com non verifie (statut: ${beylevDomain.status})`);
  return "Resend OK, domaine verifie";
}

async function sendAlert(failures) {
  const rows = failures.map(f => `<tr><td style="padding:8px;border:1px solid #e2e8f0;font-weight:bold;color:#dc2626">${f.service}</td><td style="padding:8px;border:1px solid #e2e8f0">${f.error}</td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
    <div style="background:#dc2626;color:white;padding:20px;border-radius:12px 12px 0 0">
      <h2 style="margin:0">ALERTE - Panne detectee sur Beylev Maintenance</h2>
    </div>
    <div style="background:#f8fafc;padding:20px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0">
      <p>L'autodiagnostic quotidien a detecte <strong>${failures.length} probleme(s)</strong> :</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead><tr style="background:#f1f5f9"><th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Service</th><th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Erreur</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:16px"><strong>Actions recommandees :</strong></p>
      <ul style="margin:8px 0 16px 20px;padding:0">
        <li>Si "REGLES FIRESTORE EXPIREES" : console.firebase.google.com -> Firestore -> Regles -> republier</li>
        <li>Si "Compte manquant" ou "mot de passe vide" : verifier dans Reglages, restaurer depuis la corbeille si besoin</li>
        <li>Si "AUCUN administrateur" : URGENT - restaurer un compte admin depuis la corbeille</li>
        <li>Si "Resend" : verifier resend.com</li>
      </ul>
      <a href="${APP_URL}" style="display:inline-block;background:#6366f1;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Ouvrir l'application</a>
      <p style="color:#94a3b8;font-size:12px;margin-top:20px">Autodiagnostic Beylev Maintenance - ${new Date().toLocaleString("fr-FR",{timeZone:"Europe/Paris"})}</p>
    </div>
  </div>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [ALERT_EMAIL],
      subject: `[ALERTE] ${failures.length} probleme(s) - Beylev Maintenance`,
      html
    })
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const results = { checked_at: new Date().toISOString(), tests: {}, failures: [] };

  const tests = [
    { name: "Firestore", fn: checkFirestore },
    { name: "Integrite comptes", fn: checkUserIntegrity },
    { name: "App accessible", fn: checkAppReachable },
    { name: "Resend + domaine email", fn: checkResend },
    { name: "Backup quotidien", fn: backupUsers },
  ];

  for (const t of tests) {
    try {
      results.tests[t.name] = { ok: true, message: await t.fn() };
    } catch (e) {
      results.tests[t.name] = { ok: false, error: e.message };
      // Le backup n'est pas critique, on n'alerte pas si c'est juste ca
      if (t.name !== "Backup quotidien") {
        results.failures.push({ service: t.name, error: e.message });
      }
    }
  }

  if (results.failures.length > 0) {
    try { await sendAlert(results.failures); results.alert_sent = true; }
    catch (e) { results.alert_sent = false; results.alert_error = e.message; }
  } else {
    results.all_ok = true;
  }

  res.status(200).json(results);
};
