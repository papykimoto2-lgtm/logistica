/* Synchronisation entre postes ANGEL'S : logique pure, testée hors Supabase (voir tests/sync-serveur.js).

   Principe : chaque poste garde ses données dans son navigateur (rapide, utilisable hors ligne) et les synchronise avec le serveur, enregistrement par enregistrement.
   - « tirer » : le poste récupère tout ce qui a changé sur le serveur depuis son dernier curseur ;
   - « pousser » : le poste envoie ses modifications avec la révision qu'il connaissait. Si quelqu'un d'autre a modifié le même enregistrement entre-temps, la
     modification est REFUSÉE (la première enregistrée gagne) et la version du serveur est renvoyée : aucune modification n'en écrase une autre sans que personne ne le sache.
   Types : « enreg » (enregistrement à identifiant, avec contrôle de révision), « doc » (réglage ou objet entier, même contrôle), « seq » (compteurs : on garde le plus grand),
   « ajout » (journal d'audit : on ajoute, jamais de refus ni de suppression). */

import { egal } from "./pont.js";

export { CORS } from "./pont.js";

const rep = (status, body) => ({ status, body });
const err = (status, message) => rep(status, { ok: false, erreur: message });
const txt = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const APPS = ["distribution", "transport", "agro", "crm", "placement", "assurance"], KINDS = ["enreg", "doc", "seq", "ajout"];
export const TAILLE_MAX = 900000;            // octets par enregistrement
export const LOT_MAX = 400;                  // opérations par envoi

const fusionMax = (a, b) => {                // compteurs : plus grande valeur numérique, récursivement
  if (typeof a === "number" && typeof b === "number") return Math.max(a, b);
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const o = { ...a }; for (const k of Object.keys(b)) o[k] = k in a ? fusionMax(a[k], b[k]) : b[k]; return o;
  }
  return b === undefined ? a : b;
};

export async function traiterSync(db, cfg, req, cle, now = Date.now()) {
  if (!cfg.syncKey || !egal(cle, cfg.syncKey)) return err(401, "Clé de synchronisation invalide");
  const a = String(req.action || ""), app = txt(req.app, 20);
  if (a === "etat") {
    const n = {}; for (const x of APPS) n[x] = await db.compter(x);
    return rep(200, { ok: true, enregistrements: n, heure: new Date(now).toISOString() });
  }
  if (!APPS.includes(app)) return err(400, "Application inconnue");

  if (a === "tirer") {
    const depuis = Math.max(0, Math.floor(+req.depuis || 0)), lim = Math.min(500, Math.max(1, Math.floor(+req.limite || 300)));
    const lignes = await db.depuis(app, depuis, lim + 1), suite = lignes.length > lim, L = lignes.slice(0, lim);
    return rep(200, { ok: true, lignes: L.map((r) => ({ coll: r.coll, id: r.id, data: r.supprime ? null : r.data, rev: r.rev, supprime: !!r.supprime, par: r.par, seq: r.seq })), curseur: L.length ? L[L.length - 1].seq : depuis, suite });
  }

  if (a === "pousser") {
    const ops = (Array.isArray(req.ops) ? req.ops : []).slice(0, LOT_MAX), par = txt(req.par, 80);
    const clean = [];
    for (const o of ops) {
      const coll = txt(o.coll, 60), id = txt(o.id, 120), kind = KINDS.includes(o.kind) ? o.kind : "enreg";
      if (!coll || !id) continue; clean.push({ coll, id, kind, base: Math.max(0, Math.floor(+o.base || 0)), del: !!o.del, data: o.data });
    }
    const actuels = await db.lire(app, clean.map((o) => ({ coll: o.coll, id: o.id })));
    const cur = new Map(actuels.map((r) => [r.coll + "\u0000" + r.id, r]));
    const ecrire = [], appliques = [], rejets = [], trop = [];
    for (const o of clean) {
      const k = o.coll + "\u0000" + o.id, e = cur.get(k);
      const refuse = () => rejets.push({ coll: o.coll, id: o.id, serveur: e ? { data: e.supprime ? null : e.data, rev: e.rev, supprime: !!e.supprime, par: e.par } : { data: null, rev: 0, supprime: true, par: null } });
      if (!o.del && JSON.stringify(o.data === undefined ? null : o.data).length > TAILLE_MAX) { trop.push({ coll: o.coll, id: o.id }); continue; }
      if (o.kind === "ajout") {                      // journal : on ajoute une fois, jamais de suppression ni de refus
        if (o.del) continue; if (e && !e.supprime) { appliques.push({ coll: o.coll, id: o.id, rev: e.rev }); continue; }
        ecrire.push({ app, coll: o.coll, id: o.id, data: o.data, rev: 1, supprime: false, par }); appliques.push({ coll: o.coll, id: o.id, rev: 1 }); continue;
      }
      if (o.kind === "seq") {                        // compteurs : le plus grand l'emporte
        const data = fusionMax(e && !e.supprime ? e.data : undefined, o.data), rev = (e ? e.rev : 0) + 1;
        ecrire.push({ app, coll: o.coll, id: o.id, data, rev, supprime: false, par }); appliques.push({ coll: o.coll, id: o.id, rev, data }); continue;
      }
      const revServeur = e ? e.rev : 0;
      if (o.base !== revServeur) { refuse(); continue; }        // quelqu'un d'autre est passé avant : refus, la version du serveur est renvoyée
      if (o.del) { if (!e) continue; const rev = e.rev + 1; ecrire.push({ app, coll: o.coll, id: o.id, data: null, rev, supprime: true, par }); appliques.push({ coll: o.coll, id: o.id, rev }); continue; }
      if (e && !e.supprime && JSON.stringify(e.data) === JSON.stringify(o.data)) { appliques.push({ coll: o.coll, id: o.id, rev: e.rev }); continue; }   // déjà identique
      const rev = revServeur + 1; ecrire.push({ app, coll: o.coll, id: o.id, data: o.data, rev, supprime: false, par }); appliques.push({ coll: o.coll, id: o.id, rev });
    }
    if (ecrire.length) await db.ecrire(ecrire);
    return rep(200, { ok: true, appliques, rejets, trop });
  }
  return err(400, "Action inconnue");
}
