/* Adaptateur Supabase du rapport quotidien des connexions (clé « service role » : jamais exposée au navigateur) et envoi d'e-mail (Resend). */
import { createClient } from "jsr:@supabase/supabase-js@2";
import { APPS } from "./rapport-connexions.js";

export const cfgRapport = () => ({ syncKey: Deno.env.get("SYNC_KEY"), cronKey: Deno.env.get("CRON_KEY") });

export function dbRapport(sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false, autoRefreshToken: false } })) {
  const ok = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  return {
    lireCfg: async () => ok(await sb.from("rapport_dg").select("actif,heure,emails,derniere_date,derniere_le").eq("id", 1).maybeSingle()),
    ecrireCfg: async (p) => ok(await sb.from("rapport_dg").upsert({ id: 1, ...p }, { onConflict: "id" })),
    /* journal de connexion et comptes de chaque application, tels que synchronisés par les postes */
    sources: async (depuis) => {
      const out = [];
      for (const app of APPS) {
        const cx = ok(await sb.from("sync_enreg").select("data").eq("app", app).eq("coll", "connexions").eq("supprime", false).gte("maj", depuis).limit(20000)) || [];
        const us = ok(await sb.from("sync_enreg").select("data").eq("app", app).eq("coll", "users").eq("supprime", false).limit(2000)) || [];
        out.push({ app, connexions: cx.map((r) => r.data).filter(Boolean), users: us.map((r) => r.data).filter(Boolean).map((u) => ({ id: u.id, nom: u.nom, role: u.role, actif: u.actif })) });
      }
      return out;
    },
  };
}

/* Resend (https://resend.com) : secrets RESEND_API_KEY et RAPPORT_DE (ex. « ANGEL'S GROUP <rapport@votre-domaine.com> »). Sans domaine vérifié, Resend n'envoie qu'à l'adresse du compte. */
export async function envoyerMail({ a, sujet, html, texte }) {
  const cle = Deno.env.get("RESEND_API_KEY"); if (!cle) throw new Error("Service d'e-mail non configuré (secret RESEND_API_KEY absent)");
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + cle }, body: JSON.stringify({ from: Deno.env.get("RAPPORT_DE") || "ANGEL'S GROUP <onboarding@resend.dev>", to: a, subject: sujet, html, text: texte }) });
  if (!r.ok) throw new Error("Envoi refusé par le service d'e-mail (" + r.status + ")");
}
