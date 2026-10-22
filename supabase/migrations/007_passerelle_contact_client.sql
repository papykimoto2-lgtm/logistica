alter table pg_evenements drop constraint if exists pg_evenements_type_check;
alter table pg_evenements add constraint pg_evenements_type_check check (type in ('accepter','refuser','prise_en_charge','demarrer','confirmer','echec','position','incident','arrive','rappel_client'));
