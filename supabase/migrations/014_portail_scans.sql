-- Suivi des visites du lien / QR code de commande d'un vendeur partenaire (seulement les vendeurs qui ont une clé de relève).
-- Une ligne par visiteur, par jour, par source (qr | lien) : l'empreinte du visiteur est salée, jamais l'adresse IP. Lecture réservée aux fonctions.

create table if not exists public.pd_scans (
  id        bigserial primary key,
  vendeur   text not null check (vendeur ~ '^[A-Za-z0-9_-]{1,60}$'),
  jour      date not null default current_date,
  src       text not null check (src in ('qr', 'lien')),
  visiteur  text not null check (length(visiteur) = 64),
  unique (vendeur, jour, src, visiteur)
);
create index if not exists pd_scans_vendeur_jour on public.pd_scans (vendeur, jour);
create index if not exists pd_scans_visiteur_jour on public.pd_scans (visiteur, jour);

alter table public.pd_scans enable row level security;
revoke all on public.pd_scans from anon, authenticated;
revoke all on sequence public.pd_scans_id_seq from anon, authenticated;

create or replace function public.purge_pd_scans() returns void language sql security definer set search_path = public as
$$ delete from public.pd_scans where jour < current_date - 90 $$;
revoke all on function public.purge_pd_scans() from public, anon, authenticated;
