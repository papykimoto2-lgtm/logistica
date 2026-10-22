// POST /portail-vendeur (public, sans jeton Supabase : déployer avec --no-verify-jwt) : un vendeur partenaire relève SES demandes de clients.
// Corps : { vendeur, cle, action: "lister" | "acquitter", ids? } — la clé de relève est remise au vendeur par le bureau (portail-sync, action cle_vendeur).
import { CORS, traiterVendeur } from "../_shared/portail-demandes.js";
import { dbPortail, cfgPortail } from "../_shared/serveur-portail.js";

const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J(405, { ok: false, erreur: "Méthode non autorisée" });
  let b; try { b = await req.json(); } catch { return J(400, { ok: false, erreur: "JSON invalide" }); }
  try { const r = await traiterVendeur(dbPortail(), b, cfgPortail()); return J(r.status, r.body); }
  catch (e) { return J(500, { ok: false, erreur: "Erreur serveur" }); }
});
