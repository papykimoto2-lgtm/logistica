// POST /mission-sync (en-tête x-admin-key) : le bureau publie les missions (sans numéros), relève et acquitte les événements des livreurs,
// crée / réinitialise / bloque les comptes livreurs. Actions : publier · evenements · acquitter · compte-creer · compte-reset · compte-actif.
import { CORS, traiterSync } from "../_shared/passerelle.js";
import { dbPasserelle, cfgPasserelle } from "../_shared/serveur-passerelle.js";

const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J(405, { ok: false, erreur: "Méthode non autorisée" });
  let b; try { b = await req.json(); } catch { return J(400, { ok: false, erreur: "JSON invalide" }); }
  try { const r = await traiterSync(dbPasserelle(), cfgPasserelle(), b, req.headers.get("x-admin-key")); return J(r.status, r.body); }
  catch (e) { return J(500, { ok: false, erreur: "Erreur serveur" }); }
});
