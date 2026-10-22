-- Pont téléphonique ANGEL'S : le livreur joint le client sans jamais voir son numéro.
-- Tables lisibles uniquement par les fonctions serveur (clé « service role ») : aucune politique = aucun accès public.

create table if not exists public.appel_tickets (
  id            uuid primary key default gen_random_uuid(),
  commande      text        not null,                 -- n° de commande (ex. CMD-2026-0042)
  livreur_id    text        not null,
  cle_hash      text        not null,                 -- SHA-256 de la clé d'appel du livreur (la clé elle-même n'est jamais stockée)
  livreur_tel   text        not null,
  client_tel    text        not null,
  client_nom    text,
  expire_at     timestamptz not null,
  clos          boolean     not null default false,   -- fermé à la livraison, à l'échec ou à l'annulation
  max_appels    int         not null default 4,
  cree_le       timestamptz not null default now(),
  unique (commande, livreur_id)
);

create table if not exists public.appel_journal (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid references public.appel_tickets(id) on delete set null,
  ts          timestamptz not null default now(),
  statut      text        not null,                   -- demande | livreur_decroche | relie | echec | refuse
  duree_s     int,
  erreur      text
);
create index if not exists appel_journal_ticket on public.appel_journal (ticket_id, ts desc);

alter table public.appel_tickets enable row level security;
alter table public.appel_journal enable row level security;
revoke all on public.appel_tickets, public.appel_journal from anon, authenticated;

-- Conservation limitée : les numéros disparaissent 7 jours après l'expiration du ticket (le journal garde seulement l'historique des appels sans numéro).
create or replace function public.appel_purger() returns void language sql security definer set search_path = public as $$
  delete from public.appel_tickets where expire_at < now() - interval '7 days';
$$;
revoke all on function public.appel_purger() from public, anon, authenticated;
-- À planifier si l'extension pg_cron est activée :  select cron.schedule('appel-purge','17 3 * * *','select public.appel_purger()');
