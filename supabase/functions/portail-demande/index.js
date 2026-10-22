// POST /portail-demande (public, sans jeton : déployer avec --no-verify-jwt) : le portail transmet une demande de client au bureau.
// Corps : { message } — le même message que sur WhatsApp, avec son marqueur. Contrôle de taille et de format, limite de débit par visiteur, dédoublonnage.
import { CORS, recevoir } from "../_shared/portail-demandes.js";
import { dbPortail, cfgPortail } from "../_shared/serveur-portail.js";

const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J(405, { ok: false, erreur: "Méthode non autorisée" });
  let b; try { b = await req.json(); } catch { return J(400, { ok: false, erreur: "JSON invalide" }); }
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  try { const r = await recevoir(dbPortail(), cfgPortail(), b, ip); return J(r.status, r.body); }
  catch (e) { return J(500, { ok: false, erreur: "Erreur serveur" }); }
});
