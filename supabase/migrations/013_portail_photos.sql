-- Captures d'écran jointes par le client à sa commande du portail (ventes live : le vendeur demande une capture du produit).
-- Stockage temporaire : lues par le bureau ou le vendeur concerné (fonctions, service role), supprimées dès l'acquittement de la demande.

alter table public.pd_demandes add column if not exists nb_photos smallint not null default 0 check (nb_photos between 0 and 5);

create table if not exists public.pd_photos (
  id          bigserial primary key,
  demande_ref text not null,
  idx         smallint not null check (idx between 0 and 4),
  data        text not null check (data ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and length(data) <= 150000),
  cree_le     timestamptz not null default now(),
  unique (demande_ref, idx)
);
create index if not exists pd_photos_cree on public.pd_photos (cree_le);

alter table public.pd_photos enable row level security;
revoke all on public.pd_photos from anon, authenticated;
revoke all on sequence public.pd_photos_id_seq from anon, authenticated;

-- Purge de sécurité : captures de plus de 30 jours (demande jamais relevée)
create or replace function public.purge_pd_photos() returns void language sql security definer set search_path = public as
$$ delete from public.pd_photos where cree_le < now() - interval '30 days' $$;
revoke all on function public.purge_pd_photos() from public, anon, authenticated;
