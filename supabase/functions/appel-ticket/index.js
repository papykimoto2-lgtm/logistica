// POST /appel-ticket  (en-tête x-admin-key) : le bureau enregistre ({commande, livreur_id, cle, livreur_tel, client_tel, client_nom, expire_h})
// ou ferme ({action:"clore", commande, livreur_id}) l'autorisation d'appel d'une mission.
import { CORS, traiterTicket, traiterCloture } from "../_shared/pont.js";
import { cfg, db } from "../_shared/serveur.js";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("Méthode non autorisée", { status: 405, headers: CORS });
  let b; try { b = await req.json(); } catch { return new Response(JSON.stringify({ ok: false, erreur: "JSON invalide" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }); }
  const k = req.headers.get("x-admin-key");
  const r = b.action === "clore" ? await traiterCloture(db(), cfg(), b, k) : await traiterTicket(db(), cfg(), b, k);
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...CORS, "Content-Type": "application/json" } });
});
