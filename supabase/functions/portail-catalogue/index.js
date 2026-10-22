// GET /portail-catalogue (public, sans jeton : déployer avec --no-verify-jwt) : le portail lit le catalogue publié par le bureau (boutique, prestations, forfaits, photos).
import { CORS, lireCatalogue } from "../_shared/portail-demandes.js";
import { dbPortail } from "../_shared/serveur-portail.js";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS" } });
  if (req.method !== "GET") return new Response(JSON.stringify({ ok: false, erreur: "Méthode non autorisée" }), { status: 405, headers: { ...CORS, "Content-Type": "application/json" } });
  try { const r = await lireCatalogue(dbPortail()); return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...CORS, "Access-Control-Allow-Methods": "GET, OPTIONS", "Content-Type": "application/json", "Cache-Control": "public, max-age=30" } }); }
  catch (e) { return new Response(JSON.stringify({ ok: false, erreur: "Erreur serveur" }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }); }
});
