/* Adaptateur Supabase des demandes du portail (clé « service role » : jamais exposée au navigateur). */
import { createClient } from "jsr:@supabase/supabase-js@2";

export const cfgPortail = () => ({ adminKey: Deno.env.get("ADMIN_KEY"), sel: Deno.env.get("PORTAIL_SEL") || Deno.env.get("ADMIN_KEY") || "", limiteHeure: +(Deno.env.get("PORTAIL_LIMITE_HEURE") || 20), fileMax: +(Deno.env.get("PORTAIL_FILE_MAX") || 2000) });

export function dbPortail(sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } })) {
  const ok = (r) => { if (r.error) throw new Error(r.error.message); return r; };
  const t = () => sb.from("pd_demandes");
  const supprimerPhotos = async (refs) => { if (refs.length) ok(await sb.from("pd_photos").delete().in("demande_ref", refs)); };
  return {
    compterRecentes: async (h, depuis) => ok(await t().select("id", { count: "exact", head: true }).eq("ip_hash", h).gte("cree_le", depuis)).count || 0,
    enAttente: async () => ok(await t().select("id", { count: "exact", head: true }).eq("traite", false)).count || 0,
    existe: async (ref) => !!ok(await t().select("id").eq("ref", ref).maybeSingle()).data,
    inserer: async (row) => ok(await t().insert(row)),
    insererPhotos: async (ref, L) => ok(await sb.from("pd_photos").insert(L.map((data, idx) => ({ demande_ref: ref, idx, data })))),
    /* captures d'une demande non traitée ; le bureau ne voit pas celles d'un vendeur qui a une clé de relève, le vendeur seulement les siennes */
    photosDe: async (ref, v) => {
      const d = ok(await t().select("vendeur").eq("ref", ref).eq("traite", false).maybeSingle()).data;
      if (!d) return [];
      if (v ? d.vendeur !== v : d.vendeur && ok(await sb.from("pd_vendeurs").select("vendeur").eq("vendeur", d.vendeur).maybeSingle()).data) return [];
      return (ok(await sb.from("pd_photos").select("data").eq("demande_ref", ref).order("idx")).data || []).map((x) => x.data);
    },
    /* le bureau ne relève pas les demandes destinées à un vendeur qui a une clé de relève : elles ne sont lisibles que par lui */
    enAttenteListe: async (n) => {
      const reg = (ok(await sb.from("pd_vendeurs").select("vendeur")).data || []).map((x) => x.vendeur).filter((x) => /^[A-Za-z0-9_-]+$/.test(x));
      let q = t().select("id,ref,type,message,cree_le,nb_photos").eq("traite", false);
      if (reg.length) q = q.or(`vendeur.is.null,vendeur.not.in.(${reg.join(",")})`);
      return ok(await q.order("id").limit(n)).data || [];
    },
    compterScans: async (h, jour) => ok(await sb.from("pd_scans").select("id", { count: "exact", head: true }).eq("visiteur", h).eq("jour", jour)).count || 0,
    ajouterScan: async (row) => ok(await sb.from("pd_scans").upsert(row, { onConflict: "vendeur,jour,src,visiteur", ignoreDuplicates: true })),
    statsScans: async (v, depuis) => {
      const n = async (src) => ok(await sb.from("pd_scans").select("id", { count: "exact", head: true }).eq("vendeur", v).eq("src", src).gte("jour", depuis)).count || 0;
      return { qr: await n("qr"), lien: await n("lien"), live: await n("live") };
    },
    lienRev: async (v) => { const r = ok(await sb.from("pd_vendeurs").select("lien_rev").eq("vendeur", v).maybeSingle()).data; return r ? r.lien_rev : null; },
    renouvelerLien: async (v) => { const r = ok(await sb.from("pd_vendeurs").select("lien_rev").eq("vendeur", v).maybeSingle()).data, n = ((r && r.lien_rev) || 0) + 1; ok(await sb.from("pd_vendeurs").update({ lien_rev: n }).eq("vendeur", v)); return n; },
    lireLive: async (v) => ok(await sb.from("pd_lives").select("titre,produits,actif,maj_le").eq("vendeur", v).maybeSingle()).data,
    ecrireLive: async (row) => ok(await sb.from("pd_lives").upsert(row, { onConflict: "vendeur" })),
    ecrireCleVendeur: async (v, h) => ok(await sb.from("pd_vendeurs").upsert({ vendeur: v, cle_hash: h, cree_le: new Date().toISOString() }, { onConflict: "vendeur" })),
    empreinteVendeur: async (v) => { const r = ok(await sb.from("pd_vendeurs").select("cle_hash").eq("vendeur", v).maybeSingle()).data; return r ? r.cle_hash : null; },
    enAttenteVendeur: async (v, n) => ok(await t().select("id,ref,type,message,cree_le,nb_photos").eq("traite", false).eq("vendeur", v).order("id").limit(n)).data || [],
    acquitterVendeur: async (v, ids) => { const r = ok(await t().update({ traite: true, traite_le: new Date().toISOString() }).eq("vendeur", v).in("id", ids).select("ref")); await supprimerPhotos((r.data || []).map((x) => x.ref)); },
    ecrireCatalogue: async (c) => ok(await sb.from("portail_catalogue").upsert({ id: 1, boutique: c.boutique, photos: c.photos, maj_le: new Date().toISOString() }, { onConflict: "id" })),
    lireCatalogue: async () => ok(await sb.from("portail_catalogue").select("boutique,photos,maj_le").eq("id", 1).maybeSingle()).data,
    acquitter: async (ids) => { const r = ok(await t().update({ traite: true, traite_le: new Date().toISOString() }).in("id", ids).select("ref")); await supprimerPhotos((r.data || []).map((x) => x.ref)); },
  };
}
