-- Rapport quotidien des connexions pour le DG : réglage (une seule ligne) et planification horaire.
-- Les données (journal de connexion) viennent de sync_enreg (collection « connexions ») ; rien n'est copié ici.
create table if not exists public.rapport_dg (
  id            int primary key check (id = 1),
  actif         boolean not null default false,
  heure         text    not null default '11:00',
  emails        text[]  not null default '{}',
  derniere_date text,
  derniere_le   timestamptz
);
alter table public.rapport_dg enable row level security;
revoke all on public.rapport_dg from anon, authenticated;

-- Planification : la fonction « rapport-connexions » est appelée à chaque heure pleine ; elle n'envoie que si l'heure choisie est passée et qu'aucun envoi n'a eu lieu aujourd'hui.
-- À exécuter UNE fois, par l'administrateur, avec l'adresse du projet et la clé de planification (secret CRON_KEY de la fonction) :
--   select public.rapport_dg_planifier('https://<projet>.supabase.co/functions/v1/rapport-connexions', '<CRON_KEY>');
-- Nécessite les extensions pg_cron et pg_net (Database → Extensions dans Supabase).
create or replace function public.rapport_dg_planifier(p_url text, p_cle text) returns text
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_url !~ '^https://' or length(coalesce(p_cle, '')) < 16 then raise exception 'Adresse https et clé de 16 caractères au moins requises'; end if;
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  perform cron.unschedule('rapport-connexions') where exists (select 1 from cron.job where jobname = 'rapport-connexions');
  perform cron.schedule('rapport-connexions', '0 * * * *',
    format($f$select net.http_post(url := %L, headers := jsonb_build_object('content-type','application/json','x-cron-key', %L), body := '{"action":"cron"}'::jsonb)$f$, p_url, p_cle));
  return 'planifié : chaque heure pleine';
end $$;
revoke all on function public.rapport_dg_planifier(text, text) from public, anon, authenticated;
