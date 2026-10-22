-- Synchronisation entre postes LOGISTICA : un enregistrement = une ligne (application, collection, identifiant).
-- Accès réservé à la fonction « sync » (clé service) : aucun droit pour les navigateurs.

create sequence if not exists public.sync_seq;

create table if not exists public.sync_enreg (
  app      text not null check (app in ('distribution','transport','agro')),
  coll     text not null,
  id       text not null,
  data     jsonb,
  rev      int  not null default 1,
  supprime boolean not null default false,
  par      text,
  maj      timestamptz not null default now(),
  seq      bigint not null default nextval('public.sync_seq'),
  primary key (app, coll, id)
);
create index if not exists sync_enreg_seq on public.sync_enreg (app, seq);

create or replace function public.sync_enreg_horodater() returns trigger language plpgsql set search_path = public as $$
begin
  new.seq := nextval('public.sync_seq');
  new.maj := now();
  return new;
end $$;

drop trigger if exists sync_enreg_horodater on public.sync_enreg;
create trigger sync_enreg_horodater before insert or update on public.sync_enreg for each row execute function public.sync_enreg_horodater();

alter table public.sync_enreg enable row level security;
revoke all on public.sync_enreg from anon, authenticated;
revoke all on sequence public.sync_seq from anon, authenticated;
