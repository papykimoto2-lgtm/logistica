// POST /appel-pont : le livreur demande l'appel du client ({commande, livreur_id, cle}). Le serveur sonne chez le livreur puis le relie au client.
import { CORS, traiterAppel } from "../_shared/pont.js";
import { cfg, db } from "../_shared/serveur.js";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Méthode non autorisée", { status: 405, headers: CORS });
  let b; try { b = await req.json(); } catch { return new Response(JSON.stringify({ ok: false, erreur: "JSON invalide" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }); }
  const r = await traiterAppel(db(), cfg(), b, fetch);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
});
