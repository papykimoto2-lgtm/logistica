-- Preuve de livraison : scan des colis (jetons du QR, jamais lisibles par le livreur), signature (du livreur ou du client sur son propre téléphone), photo du colis remis, position GPS.
-- Aucun accès direct : seules les fonctions (service role) lisent et écrivent. Supprimées avec la mission (30 jours après la fin).

create table if not exists public.pg_colis (                       -- empreinte du jeton imprimé sur l'étiquette de chaque colis
  livraison_ref text not null references public.pg_missions(livraison_ref) on delete cascade,
  n             smallint not null check (n between 1 and 99),
  hash          text not null check (length(hash) = 64),
  primary key (livraison_ref, n)
);

create table if not exists public.pg_preuves (
  livraison_ref    text primary key references public.pg_missions(livraison_ref) on delete cascade,
  signature        text check (signature is null or (signature ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and length(signature) <= 80000)),
  photo            text check (photo is null or (photo ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$' and length(photo) <= 80000)),
  gps              jsonb,
  signature_client text check (signature_client is null or (signature_client ~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' and length(signature_client) <= 80000)),
  client_nom       text check (client_nom is null or length(client_nom) <= 80),
  client_gps       jsonb,
  client_signe_le  timestamptz,
  client_ip        text,                                            -- empreinte salée, jamais l'adresse
  cree_le          timestamptz not null default now()
);

create table if not exists public.pg_sign_jetons (                 -- lien de signature affiché en QR par le livreur : à usage unique, 15 minutes
  token_hash    text primary key check (length(token_hash) = 64),
  livraison_ref text not null references public.pg_missions(livraison_ref) on delete cascade,
  expire        timestamptz not null,
  utilise       boolean not null default false
);
create index if not exists pg_sign_jetons_ref on public.pg_sign_jetons (livraison_ref);

alter table public.pg_colis        enable row level security;
alter table public.pg_preuves      enable row level security;
alter table public.pg_sign_jetons  enable row level security;
revoke all on public.pg_colis, public.pg_preuves, public.pg_sign_jetons from anon, authenticated;
