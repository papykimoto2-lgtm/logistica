// POST /push-envoyer (en-tête x-admin-key) : le bureau envoie une notification push à un livreur { livreur_ref, titre, corps, tag, url }.
// Secrets : ADMIN_KEY (celui de la passerelle), VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT. Déploiement : --no-verify-jwt (protégé par ADMIN_KEY).
import { CORS } from "../_shared/pont.js";
import { traiterEnvoi } from "../_shared/push.js";
import { dbPush, cfgPush, emetteurWebPush } from "../_shared/serveur-push.js";

const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J(405, { ok: false, erreur: "Méthode non autorisée" });
  let b; try { b = await req.json(); } catch { return J(400, { ok: false, erreur: "JSON invalide" }); }
  try { const r = await traiterEnvoi(dbPush(), cfgPush(), b, req.headers.get("x-admin-key"), await emetteurWebPush()); return J(r.status, r.body); }
  catch (e) { return J(500, { ok: false, erreur: "Erreur serveur : " + String(e && e.message || e).slice(0, 120) }); }
});
