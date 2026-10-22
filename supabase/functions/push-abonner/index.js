// POST /push-abonner (jeton du livreur, vérifié ici) : enregistre / supprime l'abonnement push du téléphone. Actions : abonner · desabonner · etat.
import { CORS } from "../_shared/pont.js";
import { traiterAbonnement } from "../_shared/push.js";
import { client, dbPush } from "../_shared/serveur-push.js";

const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info" } });
  if (req.method !== "POST") return J(405, { ok: false, erreur: "Méthode non autorisée" });
  let b; try { b = await req.json(); } catch { return J(400, { ok: false, erreur: "JSON invalide" }); }
  const sb = client(), jeton = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const u = jeton ? await sb.auth.getUser(jeton) : null;
  try { const r = await traiterAbonnement(dbPush(sb), b, u && u.data && u.data.user ? u.data.user.id : null, req.headers.get("user-agent") || ""); return J(r.status, r.body); }
  catch (e) { return J(500, { ok: false, erreur: "Erreur serveur" }); }
});
