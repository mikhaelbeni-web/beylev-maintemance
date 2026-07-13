// Import de taches Hostaway - proxy securise
// La cle API reste ici, jamais exposee au frontend
const HOSTAWAY_ACCOUNT_ID = "148614";
const HOSTAWAY_API_KEY = "88301144c67ad5eb23684c475a30607171e7268df9243fe88d5c3857035770be";

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
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
  if (!r.ok) throw new Error("Authentification Hostaway echouee - HTTP " + r.status);
  const data = await r.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in ? data.expires_in * 1000 - 60000 : 15 * 60000);
  return cachedToken;
}

async function hostawayGet(path, token) {
  const r = await fetch("https://api.hostaway.com/v1" + path, {
    headers: { Authorization: "Bearer " + token, "Cache-control": "no-cache" },
  });
  if (!r.ok) throw new Error("Hostaway " + path + " -> HTTP " + r.status);
  return r.json();
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  try {
    const token = await getToken();
    const debug = req.query.debug === "1";

    // 1. TOUTES les taches, peu importe leur statut Hostaway (a faire/accepte/en cours/termine)
    //    -> volontaire: Hostaway categorise parfois mal, on ne veut rien louper
    const tasksData = await hostawayGet("/tasks?limit=250", token);
    const rawTasks = tasksData.result || [];

    // 2. Les annonces pour retrouver le nom de l'unite associee a chaque tache
    const listingsData = await hostawayGet("/listings?limit=250", token);
    const listings = {};
    (listingsData.result || []).forEach((l) => {
      listings[l.id] = l.name || l.internalListingName || l.address || "Annonce " + l.id;
    });

    // 3. Reservations des 120 prochains jours par unite -> pour calculer la 1ere dispo
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const listingIds = [...new Set(rawTasks.map((t) => t.listingMapId).filter(Boolean))];
    const reservationsByListing = {};
    await Promise.all(
      listingIds.map(async (lid) => {
        try {
          const rd = await hostawayGet(
            `/reservations?listingMapId=${lid}&arrivalStartDate=${today}&arrivalEndDate=${future}&limit=150`,
            token
          );
          reservationsByListing[lid] = (rd.result || [])
            .filter((r) => r.status !== "cancelled")
            .map((r) => ({
              start: (r.arrivalDate || "").slice(0, 10),
              end: (r.departureDate || "").slice(0, 10),
            }))
            .filter((r) => r.start && r.end);
        } catch (e) {
          reservationsByListing[lid] = [];
        }
      })
    );

    // 4. Mise en forme - on garde TOUT, sans filtrer par statut
    const tasks = rawTasks.map((t) => ({
      id: String(t.id),
      title: t.title || t.name || "Tache sans titre",
      description: t.description || "",
      hostawayStatus: t.status || "",
      listingId: t.listingMapId || null,
      listingName: t.listingMapId ? listings[t.listingMapId] || null : null,
      createdAt: t.insertedOn || t.createdOn || null,
      attachments: (t.attachments || t.files || [])
        .map((a) => (typeof a === "string" ? a : a.url || a.fileUrl || null))
        .filter(Boolean),
    }));

    const payload = { tasks, reservations: reservationsByListing, count: tasks.length };
    if (debug) payload.raw = { rawTasks, listings };
    res.status(200).json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
