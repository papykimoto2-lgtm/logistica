-- Mode Live du vendeur partenaire : pendant une vente en direct (TikTok, Facebook…), le vendeur publie la liste des produits du live ;
-- le client qui scanne le QR du live les voit sur le portail, choisit ses articles et envoie sa commande (avec ses captures d'écran).
-- Un seul live par vendeur (remplacé à chaque publication) ; lecture publique seulement tant qu'il est actif ; écriture réservée au vendeur qui présente sa clé de relève.

create table if not exists public.pd_lives (
  vendeur   text primary key check (vendeur ~ '^[A-Za-z0-9_-]{1,60}$'),
  titre     text not null check (length(titre) <= 80),
  produits  jsonb not null default '[]'::jsonb check (jsonb_typeof(produits) = 'array' and jsonb_array_length(produits) <= 60),
  actif     boolean not null default true,
  maj_le    timestamptz not null default now()
);
alter table public.pd_lives enable row level security;
revoke all on public.pd_lives from anon, authenticated;

-- les visites du lien du live sont comptées à part
alter table public.pd_scans drop constraint if exists pd_scans_src_check;
alter table public.pd_scans add constraint pd_scans_src_check check (src in ('qr', 'lien', 'live'));
