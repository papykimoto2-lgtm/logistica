// POST /rapport-connexions : rapport quotidien des connexions pour le DG.
// Actions : lire · regler · tester (en-tête x-sync-key) ; cron (en-tête x-cron-key, appelée chaque heure par la planification — voir supabase/README.md).
import { CORS, traiter } from "../_shared/rapport-connexions.js";
import { dbRapport, cfgRapport, envoyerMail } from "../_shared/serveur-rapport.js";

const ENT = { ...CORS, "Access-Control-Allow-Headers": "content-type, x-sync-key, x-cron-key" };
const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...ENT, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: ENT });
  if (req.method !== "POST") return J(405, { ok: false, erreur: "Méthode non autorisée" });
  let b; try { b = await req.json(); } catch { return J(400, { ok: false, erreur: "JSON invalide" }); }
  try { const r = await traiter(dbRapport(), cfgRapport(), b, { sync: req.headers.get("x-sync-key"), cron: req.headers.get("x-cron-key") }, envoyerMail); return J(r.status, r.body); }
  catch (e) { return J(500, { ok: false, erreur: String(e && e.message || "Erreur serveur").slice(0, 160) }); }
});
