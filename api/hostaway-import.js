// Import de taches Hostaway - proxy securise
// Le secret est lu dans les variables d environnement Vercel, jamais expose au frontend
const fb = require("./_lib/firebase");
const HOSTAWAY_ACCOUNT_ID = process.env.HOSTAWAY_ACCOUNT_ID || "148614";
const HOSTAWAY_API_KEY = process.env.HOSTAWAY_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (!HOSTAWAY_API_KEY) throw Object.assign(new Error("HOSTAWAY_CLIENT_SECRET manquante dans les variables Vercel"), { status: 500 });
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const r = await fetch("https://api.hostaway.com/v1/accessTokens", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-control": "no-cache" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: HOSTAWAY_ACCOUNT_ID,
      client_secret: HOSTAWAY_API_KEY,
      scope: "general",
    }),
  });
  if (!r.ok) throw Object.assign(new Error("Authentification Hostaway echouee - HTTP " + r.status), { status: r.status });
  const data = await r.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in ? data.expires_in * 1000 - 60000 : 15 * 60000);
  return cachedToken;
}

async function hostawayGet(path, token) {
  const r = await fetch("https://api.hostaway.com/v1" + path, {
    headers: { Authorization: "Bearer " + token, "Cache-control": "no-cache" },
  });
  if (!r.ok) throw Object.assign(new Error("Hostaway " + path + " -> HTTP " + r.status), { status: r.status });
  return r.json();
}

/* Lit toutes les pages d'une liste Hostaway (au plus maxPages pages de `limit`).
   Arret aussi si une page ne rapporte rien de nouveau (offset ignore par l'API : pas de doublons). */
async function hostawayAll(path, token, limit, maxPages = 10) {
  const sep = path.includes("?") ? "&" : "?";
  const byId = new Map();
  for (let page = 0; page < maxPages; page++) {
    const results = (await hostawayGet(`${path}${sep}limit=${limit}&offset=${page * limit}`, token)).result || [];
    const before = byId.size;
    results.forEach((x, i) => byId.set(x && x.id != null ? String(x.id) : `${page}-${i}`, x));
    if (results.length < limit || byId.size === before) break;
  }
  return [...byId.values()];
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await fb.requireUser(req, { roles: ["admin", "manager"] });
    const token = await getToken();
    const debug = req.query.debug === "1";

    // 1. Toutes les pages de taches (une seule page de 250 laissait passer les nouvelles taches
    //    des que le compte en cumulait plus), puis seulement le statut "pending" (= colonne "A faire")
    const allRawTasks = await hostawayAll("/tasks", token, 250, 20);
    const rawTasks = allRawTasks.filter((t) => t.status === "pending");

    // 2. Les annonces pour retrouver l'adresse complete associee a chaque tache
    const listings = {};
    (await hostawayAll("/listings", token, 250)).forEach((l) => {
      const parts = [l.address, l.city, l.zipcode].filter(Boolean);
      const fullAddress = parts.join(", ");
      listings[l.id] = {
        name: l.name || l.internalListingName || "Annonce " + l.id,
        address: fullAddress || null,
      };
    });

    // 3. Reservations en cours et des 120 prochains jours -> pour calculer la 1ere dispo
    //    Recuperees UNE FOIS pour tout le compte, puis regroupees par leur
    //    propre listingMapId. Si Hostaway refuse (permissions), on degrade
    //    proprement : les taches s'afficheront quand meme, juste sans date suggeree.
    // Les arrivees des 60 derniers jours sont incluses : un client deja dans les lieux aujourd'hui occupe l'appartement.
    const since = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const future = new Date(Date.now() + 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const reservationsByListing = {};
    let reservationsError = null;
    try {
      // Toutes les reservations du compte, regroupees ici par listingMapId (le filtre par annonce cote Hostaway s'est avere non fiable)
      const allReservations = await hostawayAll(`/reservations?arrivalStartDate=${since}&arrivalEndDate=${future}`, token, 500);
      allReservations
        .filter((r) => r.status !== "cancelled")
        .forEach((r) => {
          const lid = r.listingMapId;
          if (!lid) return;
          const start = (r.arrivalDate || "").slice(0, 10);
          const end = (r.departureDate || "").slice(0, 10);
          if (!start || !end) return;
          if (!reservationsByListing[lid]) reservationsByListing[lid] = [];
          reservationsByListing[lid].push({ start, end });
        });
    } catch (e) {
      reservationsError = e.message;
    }

    // 4. Mise en forme
    const tasks = rawTasks.map((t) => ({
      id: String(t.id),
      title: t.title || t.name || "Tache sans titre",
      description: t.description || "",
      hostawayStatus: t.status || "",
      listingId: t.listingMapId || null,
      listingName: t.listingMapId ? (listings[t.listingMapId]?.name || null) : null,
      listingAddress: t.listingMapId ? (listings[t.listingMapId]?.address || null) : null,
      createdAt: t.insertedOn || t.createdOn || null,
      attachments: (t.attachments || t.files || [])
        .map((a) => (typeof a === "string" ? a : a.url || a.fileUrl || null))
        .filter(Boolean),
    }));

    const payload = { tasks, reservations: reservationsByListing, count: tasks.length };
    if (reservationsError) payload.reservationsError = reservationsError;
    if (debug) payload.raw = { rawTasks, allRawTasks, listings };
    res.status(200).json(payload);
  } catch (e) {
    res.status([401, 403].includes(e.status) ? e.status : 500).json({ error: e.message });
  }
};
