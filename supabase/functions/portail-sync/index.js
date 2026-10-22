// POST /portail-sync (en-tête x-admin-key) : le bureau relève les demandes du portail en attente (action « lister ») puis les acquitte (action « acquitter »).
import { CORS, traiterBureau } from "../_shared/portail-demandes.js";
import { dbPortail, cfgPortail } from "../_shared/serveur-portail.js";

const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J(405, { ok: false, erreur: "Méthode non autorisée" });
  let b; try { b = await req.json(); } catch { return J(400, { ok: false, erreur: "JSON invalide" }); }
  try { const r = await traiterBureau(dbPortail(), cfgPortail(), b, req.headers.get("x-admin-key")); return J(r.status, r.body); }
  catch (e) { return J(500, { ok: false, erreur: "Erreur serveur" }); }
});
