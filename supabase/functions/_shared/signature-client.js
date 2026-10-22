/* Signature du client sur SON téléphone : logique pure, testée hors Supabase (voir tests/livraison-preuve.js).

   Le livreur affiche un QR (lien à usage unique, 15 minutes, créé par mission-action « demande_signature »). Le client l'ouvre, voit sa commande (numéro, articles, montant : ni adresse,
   ni téléphone), saisit son nom et signe du doigt. La signature est rangée côté serveur ; le livreur la voit apparaître puis confirme la livraison avec le code du client. */

import { sha256hex } from "./pont.js";
import { empreinteJeton } from "./passerelle.js";

export { CORS } from "./pont.js";

const rep = (status, body) => ({ status, body });
const err = (status, message) => rep(status, { ok: false, erreur: message });
const PNG = /^data:image\/png;base64,[A-Za-z0-9+\/=]+$/, SIG_MAX = 80000;
const jetonDe = (t) => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);

async function lireJeton(db, req, now) {
  const t = jetonDe(req.t); if (t.length < 12) return { e: err(400, "Lien de signature illisible") };
  const h = await empreinteJeton(t), j = await db.jeton(h);
  if (!j || j.utilise || Date.parse(j.expire) < now) return { e: err(410, "Ce lien a expiré ou a déjà servi : demandez au livreur d'afficher un nouveau QR code") };
  const m = await db.mission(j.livraison_ref);
  if (!m || m.statut !== "en_cours") return { e: err(409, "Cette livraison n'est plus en cours") };
  return { h, j, m };
}

export async function voirSignature(db, req, now = Date.now()) {
  const r = await lireJeton(db, req, now); if (r.e) return r.e;
  const p = r.m.payload || {};
  return rep(200, { ok: true, numero: String(p.numero || r.m.commande_ref || "").slice(0, 40), org: String(p.org || "").slice(0, 80), montant: Math.round(+p.montant_attendu || 0),
    lignes: (Array.isArray(p.lignes) ? p.lignes : []).slice(0, 30).map((x) => ({ desig: String(x.desig || "").slice(0, 120), qte: Math.round(+x.qte || 0) })) });
}

export async function signerLivraison(db, cfg, req, ip, now = Date.now()) {
  const r = await lireJeton(db, req, now); if (r.e) return r.e;
  const nom = String(req.nom || "").trim().slice(0, 80), sig = typeof req.signature === "string" ? req.signature : "";
  if (nom.length < 2) return err(400, "Indiquez votre nom");
  if (!PNG.test(sig) || sig.length > SIG_MAX || sig.length < 400) return err(400, "Signez dans le cadre avec le doigt");
  const g = req.gps && typeof req.gps === "object" ? { lat: Number(req.gps.lat), lng: Number(req.gps.lng), precision: Math.round(Number(req.gps.precision) || 0) } : null, gps = g && Math.abs(g.lat) <= 90 && Math.abs(g.lng) <= 180 ? g : null;
  const h = await sha256hex("signature|" + String(cfg.sel || "") + "|" + String(ip || "inconnu"));
  await db.ecrirePreuve(r.j.livraison_ref, { signature_client: sig, client_nom: nom, client_gps: gps, client_signe_le: new Date(now).toISOString(), client_ip: h });
  await db.consommerJeton(r.h);
  return rep(200, { ok: true });
}
