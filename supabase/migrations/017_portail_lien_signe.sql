-- Anti-fraude du QR / lien du vendeur : le serveur signe (HMAC-SHA256, secret côté serveur) le trio « vendeur · nom de la boutique · téléphone » du lien.
-- Le portail demande au serveur si la signature est authentique : un lien modifié (autre numéro, autre nom) est reconnu et neutralisé.
-- Le compteur ci-dessous permet de « renouveler le QR » (QR perdu, copié ou détourné) : les anciens liens signés cessent d'être valables.

alter table public.pd_vendeurs add column if not exists lien_rev smallint not null default 0;
