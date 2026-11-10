-- ============================================================
--  Zeste 🍋 — RETOUR ARRIÈRE de sql/zeste-or-catalogue.sql
--  Retire les fiches ajoutées et les colonnes pays / annees / source.
--  REFUSÉ si un achat utilise déjà une des nouvelles fiches : aucun achat
--  n'est jamais supprimé ni modifié par ce script.
-- ============================================================

do $$
declare n int;
begin
  select count(*) into n from zeste.or_lots where type in ('pesos50', 'dollars20', 'krugerrand1', 'dollars10', 'maple1', 'philharmonique1', 'eagle1', 'mark20', 'lire20', 'belge20', 'dollars5', 'demi_souverain', 'pesos20', 'pesos10', 'britannia1', 'buffalo1', 'libertad1', 'kangourou1', 'panda30', 'francs5_fr', 'francs40_fr', 'francs50_fr', 'francs100_fr', 'vreneli10', 'vreneli100', 'helvetia20', 'pesetas20', 'pesetas25', 'drachmes20', 'florins8', 'florins4', 'couronnes20_at', 'couronnes10_at', 'couronnes100_at', 'ducat1_at', 'ducats4_at', 'korona20_hu', 'mark10', 'florins10_nl', 'kroner20_dk', 'kroner10_dk', 'kronor20_se', 'kroner20_no', 'roubles5', 'roubles10', 'chervonets', 'kurush100', 'livres2_gb', 'livres5_gb', 'libra_pe', 'dollars10_1795', 'dollars3', 'dollars2_5', 'dollars1', 'eagle_demi', 'eagle_quart', 'eagle_dixieme', 'pesos5', 'pesos2_5', 'pesos2', 'pesos100_cl', 'pesos50_cl', 'pesos20_cl', 'krugerrand_demi', 'krugerrand_quart', 'krugerrand_dixieme', 'maple_demi', 'maple_quart', 'maple_dixieme', 'philharmonique_demi', 'philharmonique_quart', 'philharmonique_dixieme', 'panda1oz');
  if n > 0 then
    raise exception 'Retour arrière refusé : % achat(s) utilisent une fiche ajoutée par le catalogue', n;
  end if;
end $$;

delete from zeste.or_types where code in ('pesos50', 'dollars20', 'krugerrand1', 'dollars10', 'maple1', 'philharmonique1', 'eagle1', 'mark20', 'lire20', 'belge20', 'dollars5', 'demi_souverain', 'pesos20', 'pesos10', 'britannia1', 'buffalo1', 'libertad1', 'kangourou1', 'panda30', 'francs5_fr', 'francs40_fr', 'francs50_fr', 'francs100_fr', 'vreneli10', 'vreneli100', 'helvetia20', 'pesetas20', 'pesetas25', 'drachmes20', 'florins8', 'florins4', 'couronnes20_at', 'couronnes10_at', 'couronnes100_at', 'ducat1_at', 'ducats4_at', 'korona20_hu', 'mark10', 'florins10_nl', 'kroner20_dk', 'kroner10_dk', 'kronor20_se', 'kroner20_no', 'roubles5', 'roubles10', 'chervonets', 'kurush100', 'livres2_gb', 'livres5_gb', 'libra_pe', 'dollars10_1795', 'dollars3', 'dollars2_5', 'dollars1', 'eagle_demi', 'eagle_quart', 'eagle_dixieme', 'pesos5', 'pesos2_5', 'pesos2', 'pesos100_cl', 'pesos50_cl', 'pesos20_cl', 'krugerrand_demi', 'krugerrand_quart', 'krugerrand_dixieme', 'maple_demi', 'maple_quart', 'maple_dixieme', 'philharmonique_demi', 'philharmonique_quart', 'philharmonique_dixieme', 'panda1oz');
alter table zeste.or_types drop column if exists pays;
alter table zeste.or_types drop column if exists annees;
alter table zeste.or_types drop column if exists source;
