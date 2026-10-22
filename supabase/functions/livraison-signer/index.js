// POST /livraison-signer (public, sans jeton Supabase : déployer avec --no-verify-jwt) : le client signe la réception de sa livraison sur son propre téléphone.
// Corps : { action: "voir" | "signer", t, nom?, signature?, gps? } — t est le jeton à usage unique du QR affiché par le livreur.
import { CORS, voirSignature, signerLivraison } from "../_shared/signature-client.js";
import { dbPasserelle } from "../_shared/serveur-passerelle.js";

const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J(405, { ok: false, erreur: "Méthode non autorisée" });
  let b; try { b = await req.json(); } catch { return J(400, { ok: false, erreur: "JSON invalide" }); }
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  try {
    const db = dbPasserelle(), r = b.action === "signer" ? await signerLivraison(db, { sel: Deno.env.get("PORTAIL_SEL") || Deno.env.get("ADMIN_KEY") || "" }, b, ip) : await voirSignature(db, b);
    return J(r.status, r.body);
  } catch (e) { return J(500, { ok: false, erreur: "Erreur serveur" }); }
});
