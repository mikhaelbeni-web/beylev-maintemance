// Monday.com - proxy en LECTURE SEULE vers l API GraphQL (aucune mutation n est envoyee, voir gql)
// Le jeton est lu dans les variables d environnement Vercel, jamais expose au frontend
//   GET /api/monday?action=boards          -> tableaux et colonnes
//   GET /api/monday?action=items&board=ID  -> tous les elements du tableau
const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
const ITEM_FIELDS = "id name created_at updated_at group { title } column_values { id text type }";

async function gql(query, variables) {
  // Garde-fou : ce proxy ne sert qu a lire. Toute requete qui ne soit pas un "query" est refusee avant d appeler Monday.
  if (!/^\s*query\b/.test(query) || /\bmutation\b|\bsubscription\b/i.test(query)) throw Object.assign(new Error("Requete Monday refusee : lecture seule"), { status: 500 });
  if (!MONDAY_API_TOKEN) throw Object.assign(new Error("MONDAY_API_TOKEN manquante dans les variables Vercel"), { status: 500 });
  const r = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: MONDAY_API_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.errors || data.error_message) {
    const msg = (data.errors && data.errors.map((e) => e.message).join(" ; ")) || data.error_message || "HTTP " + r.status;
    throw Object.assign(new Error("Monday : " + msg), { status: r.status === 200 ? 502 : r.status });
  }
  return data.data;
}

const flatItem = (it) => ({
  id: String(it.id),
  name: it.name || "",
  group: (it.group && it.group.title) || "",
  createdAt: it.created_at || null,
  updatedAt: it.updated_at || null,
  values: Object.fromEntries((it.column_values || []).map((c) => [c.id, c.text || ""])),
});

async function boardItems(boardId) {
  const first = await gql(
    `query ($id: [ID!]) { boards(ids: $id) { id name columns { id title type } items_page(limit: 500) { cursor items { ${ITEM_FIELDS} } } } }`,
    { id: [String(boardId)] }
  );
  const board = (first.boards || [])[0];
  if (!board) throw Object.assign(new Error("Tableau Monday introuvable : " + boardId), { status: 404 });
  let items = board.items_page.items.map(flatItem);
  let cursor = board.items_page.cursor;
  for (let page = 0; cursor && page < 20; page++) {
    const next = await gql(`query ($c: String!) { next_items_page(limit: 500, cursor: $c) { cursor items { ${ITEM_FIELDS} } } }`, { c: cursor });
    items = items.concat(next.next_items_page.items.map(flatItem));
    cursor = next.next_items_page.cursor;
  }
  return { board: { id: String(board.id), name: board.name, columns: board.columns }, items };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Lecture seule : GET uniquement" });
  try {
    const action = req.query.action || "boards";
    if (action === "boards") {
      const d = await gql("query { boards(limit: 200, state: active) { id name columns { id title type } } }");
      return res.status(200).json({ boards: (d.boards || []).map((b) => ({ id: String(b.id), name: b.name, columns: b.columns })) });
    }
    if (action === "items") {
      if (!/^\d+$/.test(String(req.query.board || ""))) return res.status(400).json({ error: "Parametre board manquant" });
      return res.status(200).json(await boardItems(req.query.board));
    }
    return res.status(400).json({ error: "Action inconnue" });
  } catch (e) {
    console.error(e);
    return res.status(e.status && e.status >= 400 ? e.status : 500).json({ error: e.message });
  }
};
