// Import de taches Hostaway - proxy securise
// La cle API reste ici, jamais exposee au frontend
const HOSTAWAY_ACCOUNT_ID = "96311";
const HOSTAWAY_API_KEY = "038ea2e96cb0da25459f265ed2bf4b4346e1c3852fcd6976c99cf120010154f7";

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

async function fetchAllReservations(token, arrivalStart, arrivalEnd) {
  // Recupere TOUTES les reservations d'un coup, puis on les trie nous-memes
  // par listingMapId (le filtre par listing cote Hostaway s'est avere non fiable)
  let all = [];
  let offset = 0;
  const limit = 500;
  for (let page = 0; page < 10; page++) {
    const rd = await hostawayGet(
      `/reservations?arrivalStartDate=${arrivalStart}&arrivalEndDate=${arrivalEnd}&limit=${limit}&offset=${offset}`,
      token
    );
    const results = rd.result || [];
    all = all.concat(results);
    if (results.length < limit) break;
    offset += limit;
  }
  return all;
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

    // 3. Reservations des 120 prochains jours -> pour calculer la 1ere dispo
    //    Recuperees UNE FOIS pour tout le compte, puis regroupees par leur
    //    propre listingMapId. Si Hostaway refuse (permissions), on degrade
    //    proprement : les taches s'afficheront quand meme, juste sans date suggeree.
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date(Date.now() + 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const reservationsByListing = {};
    let reservationsError = null;
    try {
      const allReservations = await fetchAllReservations(token, today, future);
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
    if (reservationsError) payload.reservationsError = reservationsError;
    if (debug) payload.raw = { rawTasks, listings };
    res.status(200).json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
