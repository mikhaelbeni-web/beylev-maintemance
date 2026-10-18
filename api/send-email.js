// Proxy Resend. La cle est lue dans la variable d environnement RESEND_API_KEY.
// Accepte { to, subject, html } ou l ancien format { to_email, to_name, subject, message, mission_* }.
const FROM_EMAIL = process.env.EMAIL_FROM || "gestion@beylev.com";
const MAX_RECIPIENTS = 10;

function legacyHtml(p) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto"><div style="background:#292f4c;color:white;padding:20px;border-radius:12px 12px 0 0"><h2 style="margin:0">${p.subject}</h2></div><div style="background:#f6f7fb;padding:20px;border-radius:0 0 12px 12px;border:1px solid #e6e9ef"><p>Bonjour <strong>${p.to_name || ""}</strong>,</p><p>${p.message || ""}</p><div style="background:white;border-left:4px solid #0073ea;border-radius:8px;padding:16px;margin:16px 0"><p style="margin:4px 0"><strong>Intervention :</strong> ${p.mission_title || ""}</p><p style="margin:4px 0"><strong>Date :</strong> ${p.mission_date || ""}</p><p style="margin:4px 0"><strong>Lieu :</strong> ${p.mission_location || ""}</p><p style="margin:4px 0"><strong>Assigne a :</strong> ${p.assigned_to || ""}</p><p style="margin:4px 0"><strong>Cree par :</strong> ${p.created_by || ""}</p><p style="margin:4px 0"><strong>Priorite :</strong> ${p.mission_priority || ""}</p>${p.mission_description && p.mission_description !== "—" ? `<p style="margin:4px 0"><strong>Description :</strong> ${p.mission_description}</p>` : ""}</div><a href="${p.app_url || ""}" style="display:inline-block;background:#0073ea;color:white;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:bold">Voir l'application</a><p style="color:#676879;font-size:12px;margin-top:20px">Maintenance Beylev</p></div></div>`;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const key = process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: "RESEND_API_KEY manquante dans les variables Vercel" });

  try {
    const p = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) || {};
    const rawTo = p.to !== undefined ? p.to : p.to_email;
    const to = (Array.isArray(rawTo) ? rawTo : [rawTo]).filter(x => typeof x === "string" && /.+@.+\..+/.test(x));
    if (!to.length || !p.subject) return res.status(400).json({ error: "Champs to et subject requis" });
    if (to.length > MAX_RECIPIENTS) return res.status(400).json({ error: "Trop de destinataires" });
    const html = p.html || legacyHtml(p);

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject: String(p.subject).slice(0, 200), html })
    });
    const data = await r.json().catch(() => ({}));
    res.status(r.ok ? 200 : 400).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
