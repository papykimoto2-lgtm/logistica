/* Adaptateur Supabase de la synchronisation entre postes (clé « service role » : jamais exposée au navigateur). */
import { createClient } from "jsr:@supabase/supabase-js@2";

export const cfgSync = () => ({ syncKey: Deno.env.get("SYNC_KEY") });

export function dbSync(sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } })) {
  const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    compter: async (app) => { const r = await sb.from("sync_enreg").select("id", { count: "exact", head: true }).eq("app", app).eq("supprime", false); if (r.error) throw new Error(r.error.message); return r.count || 0; },
    depuis: async (app, depuis, n) => ok(await sb.from("sync_enreg").select("coll,id,data,rev,supprime,par,seq").eq("app", app).gt("seq", depuis).order("seq").limit(n)) || [],
    lire: async (app, cles) => {
      const par = new Map(); for (const c of cles) { if (!par.has(c.coll)) par.set(c.coll, []); par.get(c.coll).push(c.id); }
      const out = [];
      for (const [coll, ids] of par) for (let i = 0; i < ids.length; i += 150) out.push(...(ok(await sb.from("sync_enreg").select("coll,id,data,rev,supprime,par").eq("app", app).eq("coll", coll).in("id", ids.slice(i, i + 150))) || []));
      return out;
    },
    ecrire: async (lignes) => { for (let i = 0; i < lignes.length; i += 100) ok(await sb.from("sync_enreg").upsert(lignes.slice(i, i + 100), { onConflict: "app,coll,id" })); },
  };
}
