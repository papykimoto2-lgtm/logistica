-- Demandes du portail public (commande de boutique, programmation de livraison, abonnement professionnel) transmises directement au bureau.
-- Le visiteur n'a aucun accès à la table : la fonction portail-demande (clé « service role ») contrôle, limite le débit et insère ;
-- le bureau relève les demandes avec la fonction portail-sync (clé d'administration) et les importe dans Distributions, puis les acquitte.

create table if not exists public.pd_demandes (
  id        bigint generated always as identity primary key,
  ref       text not null unique,                                  -- référence de la demande (celle affichée au client)
  type      text not null check (type in ('BOUTIQUE','LIVRAISON','ABONNEMENT')),
  message   text not null check (length(message) <= 6000),         -- le message complet, marqueur [TYPE:…] compris : même format que WhatsApp
  ip_hash   text not null,                                         -- empreinte salée de l'adresse du visiteur (limite de débit), jamais l'adresse
  cree_le   timestamptz not null default now(),
  traite    boolean not null default false,
  traite_le timestamptz
);
create index if not exists pd_demandes_attente on public.pd_demandes (id) where not traite;
create index if not exists pd_demandes_ip on public.pd_demandes (ip_hash, cree_le desc);

alter table public.pd_demandes enable row level security;
revoke all on public.pd_demandes from anon, authenticated;           -- aucune politique : seule la clé « service role » (fonctions) lit et écrit

-- Purge : les demandes traitées depuis plus de 30 jours disparaissent (elles contiennent des coordonnées de clients).
create or replace function public.purge_pd_demandes() returns void language sql security definer set search_path = public as
$$ delete from public.pd_demandes where traite and traite_le < now() - interval '30 days' $$;
revoke all on function public.purge_pd_demandes() from public, anon, authenticated;
