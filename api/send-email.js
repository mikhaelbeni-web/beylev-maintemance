// Proxy Resend. La cle est lue dans la variable d environnement RESEND_API_KEY.
// Accepte { to, subject, html }.
// Reserve aux utilisateurs connectes (jeton Firebase verifie), et seulement vers les emails de l equipe
// (comptes de l app et adresse de gestion) : sinon un compte pourrait envoyer n importe quoi a n importe qui au nom de Beylev.
const fb = require("./_lib/firebase");
const FROM_EMAIL = process.env.EMAIL_FROM || "gestion@beylev.com";
const GESTION_EMAIL = "gestion@beylev.com";
const MAX_RECIPIENTS = 10;

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: "RESEND_API_KEY manquante dans les variables Vercel" });

  try {
    const { users } = await fb.requireUser(req);
    const p = fb.body(req);
    const allowed = new Set([FROM_EMAIL, GESTION_EMAIL, ...users.map(u => u.email)].map(fb.normEmail).filter(Boolean));
    const to = [...new Set((Array.isArray(p.to) ? p.to : [p.to]).map(fb.normEmail))].filter(x => fb.EMAIL_RE.test(x));
    if (!to.length || !p.subject || typeof p.html !== "string") return res.status(400).json({ error: "Champs to, subject et html requis" });
    if (to.length > MAX_RECIPIENTS) return res.status(400).json({ error: "Trop de destinataires" });
    if (to.some(x => !allowed.has(x))) return res.status(403).json({ error: "Destinataire hors de l equipe" });

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject: String(p.subject).slice(0, 200), html: p.html })
    });
    const data = await r.json().catch(() => ({}));
    res.status(r.ok ? 200 : 502).json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
