-- Relève des demandes de clients PAR LE VENDEUR PARTENAIRE (lien de commande du vendeur) : chaque demande porte l'identifiant du vendeur visé ;
-- le bureau remet au vendeur une clé de relève (affichée une seule fois, seule son empreinte est conservée). Une demande destinée à un vendeur
-- qui a une clé n'est plus relevée par le bureau : elle ne peut être lue que par ce vendeur, avec sa clé.

alter table public.pd_demandes add column if not exists vendeur text check (vendeur is null or length(vendeur) <= 60);
create index if not exists pd_demandes_vendeur on public.pd_demandes (vendeur, id) where not traite;

create table if not exists public.pd_vendeurs (
  vendeur  text primary key check (length(vendeur) between 1 and 60),
  cle_hash text not null,                                           -- empreinte SHA-256 de la clé de relève (la clé elle-même n'est jamais stockée)
  cree_le  timestamptz not null default now()
);
alter table public.pd_vendeurs enable row level security;
revoke all on public.pd_vendeurs from anon, authenticated;          -- aucune politique : seule la clé « service role » (fonctions) lit et écrit
