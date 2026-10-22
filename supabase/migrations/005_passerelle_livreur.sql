-- Passerelle livreur LOGISTICA : le livreur lit uniquement ses missions, SANS numéro de téléphone du client et SANS code de confirmation.
-- Le bureau publie les missions (fonction mission-sync) ; le livreur agit par la fonction mission-action ; aucune écriture directe.

create table if not exists public.pg_livreurs (
  livreur_ref text primary key,                                   -- identifiant du livreur dans l'application Distributions
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  nom         text not null,
  ident       text not null unique,                               -- identifiant de connexion (minuscules)
  actif       boolean not null default true,
  cree_le     timestamptz not null default now()
);

create table if not exists public.pg_missions (
  livraison_ref text primary key,                                 -- identifiant de la livraison dans l'application
  livreur_ref   text not null references public.pg_livreurs(livreur_ref) on delete cascade,
  commande_ref  text not null,
  statut        text not null,
  payload       jsonb not null,                                   -- projection sans numéro de téléphone ni code
  position      jsonb,
  position_le   timestamptz,
  maj_le        timestamptz not null default now()
);
create index if not exists pg_missions_livreur on public.pg_missions (livreur_ref, maj_le desc);

create table if not exists public.pg_codes (                       -- empreinte du code de livraison : jamais lisible par le livreur
  livraison_ref  text primary key references public.pg_missions(livraison_ref) on delete cascade,
  code_hash      text not null,
  essais         int  not null default 0,
  verrou_jusqua  timestamptz
);

create table if not exists public.pg_evenements (
  id            bigint generated always as identity primary key,
  livraison_ref text not null,
  livreur_ref   text not null,
  type          text not null check (type in ('accepter','refuser','prise_en_charge','demarrer','confirmer','echec','position','incident')),
  donnees       jsonb not null default '{}'::jsonb,
  cree_le       timestamptz not null default now(),
  traite        boolean not null default false
);
create index if not exists pg_evenements_attente on public.pg_evenements (traite, id);

alter table public.pg_livreurs   enable row level security;
alter table public.pg_missions   enable row level security;
alter table public.pg_codes      enable row level security;
alter table public.pg_evenements enable row level security;

revoke all on public.pg_livreurs, public.pg_missions, public.pg_codes, public.pg_evenements from anon, authenticated;
grant select on public.pg_livreurs to authenticated;
grant select (livraison_ref, livreur_ref, commande_ref, statut, payload, position, maj_le) on public.pg_missions to authenticated;

create policy pg_livreurs_moi on public.pg_livreurs for select to authenticated using (user_id = (select auth.uid()));
create policy pg_missions_miennes on public.pg_missions for select to authenticated
  using (livreur_ref in (select livreur_ref from public.pg_livreurs where user_id = (select auth.uid()) and actif));

-- Conservation limitée : missions terminées depuis plus de 30 jours et événements traités depuis plus de 30 jours.
create or replace function public.pg_purger() returns void language sql security definer set search_path = public as $$
  delete from public.pg_evenements where traite and cree_le < now() - interval '30 days';
  delete from public.pg_missions where statut in ('livree','echouee','refusee','annulee') and maj_le < now() - interval '30 days';
$$;
revoke all on function public.pg_purger() from public, anon, authenticated;
-- À planifier si pg_cron est activé :  select cron.schedule('pg-purge','23 3 * * *','select public.pg_purger()');
