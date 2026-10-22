-- LOGISTICA : fonctions de purge (conservation limitée des données personnelles).
-- À coller dans Supabase → SQL Editor → Run (projet LOGISTICA).
create or replace function public.pg_purger() returns void language sql security definer set search_path = public as $$
  delete from public.pg_evenements where traite and cree_le < now() - interval '30 days';
  delete from public.pg_missions where statut in ('livree','echouee','refusee','annulee') and maj_le < now() - interval '30 days';
$$;
create or replace function public.purge_pd_demandes() returns void language sql security definer set search_path = public as
$$ delete from public.pd_demandes where traite and traite_le < now() - interval '30 days' $$;
create or replace function public.purge_pd_photos() returns void language sql security definer set search_path = public as
$$ delete from public.pd_photos where cree_le < now() - interval '30 days' $$;
create or replace function public.purge_pd_scans() returns void language sql security definer set search_path = public as
$$ delete from public.pd_scans where jour < current_date - 90 $$;
revoke all on function public.pg_purger(), public.purge_pd_demandes(), public.purge_pd_photos(), public.purge_pd_scans() from public, anon, authenticated;
