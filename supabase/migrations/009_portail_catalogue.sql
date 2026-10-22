-- Catalogue public du portail (boutique, prestations, forfaits et leurs photos) publié par le bureau : les visiteurs le lisent sans republier le portail.
-- Une seule ligne. Écriture : fonction portail-sync (clé d'administration). Lecture publique : fonction portail-catalogue. Aucun accès direct à la table.

create table if not exists public.portail_catalogue (
  id       smallint primary key check (id = 1),
  boutique text  not null default '',                    -- jeton de la boutique (mêmes données que le lien de boutique : prix, stock, zones, comptes Mobile Money publics)
  photos   jsonb not null default '{}'::jsonb,           -- { code : "data:image/jpeg;base64,…" }
  maj_le   timestamptz not null default now()
);
alter table public.portail_catalogue enable row level security;
revoke all on public.portail_catalogue from anon, authenticated;
