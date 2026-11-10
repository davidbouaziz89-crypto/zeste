-- ============================================================
--  Zeste 🍋 — Onglet Or : catalogue de pièces enrichi (81 fiches)
--  À appliquer APRÈS sql/zeste-or.sql. Rejouable sans effet de bord.
--
--  • Ajoute à zeste.or_types le pays, les années d'émission et la source
--    de vérification de chaque fiche.
--  • Ajoute les nouvelles pièces (pesos mexicains, dollars américains,
--    pièces européennes, pièces d'investissement modernes…). Les 8 fiches
--    existantes gardent leur code et leurs poids : aucun achat n'est modifié
--    (chaque achat garde de toute façon ses propres poids, copiés à la saisie).
--  • Pour une fiche connue, le serveur IMPOSE ces poids à l'enregistrement
--    d'un achat (zeste_or_lot_enregistrer) : rien n'est saisi à la main.
--
--  Poids : poids légaux / officiels (Monnaies émettrices, Numista).
--  Pièces d'investissement « 1 once » : contenu en or fin GARANTI par la
--  Monnaie (31,1035 g), le poids brut étant celui publié par la Monnaie.
--  DOIT rester identique à OR_TYPES dans index.html (tests/or/calculs.test.mjs).
--  Retour arrière : sql/zeste-or-catalogue-retour.sql
-- ============================================================

alter table zeste.or_types add column if not exists pays   text;
alter table zeste.or_types add column if not exists annees text;
alter table zeste.or_types add column if not exists source text;

insert into zeste.or_types (code, nom, poids_brut_g, titre_millieme, poids_fin_g, saisie_libre, ordre, pays, annees, source) values
  ('napoleon20', 'Napoléon 20 francs', 6.4516, 900.00, 5.8064, false, 10, 'France', '1803-1914', null),
  ('pesos50', '50 pesos Centenario', 41.6666, 900.00, 37.4999, false, 12, 'Mexique', '1921-1947 (+ refrappes)', null),
  ('souverain', 'Souverain britannique', 7.9881, 916.67, 7.3224, false, 14, 'Royaume-Uni', '1817-', null),
  ('dollars20', '20 dollars Double Eagle (Liberty, Saint-Gaudens)', 33.4370, 900.00, 30.0933, false, 16, 'États-Unis', '1850-1933', null),
  ('vreneli20', '20 francs suisse (Vreneli)', 6.4516, 900.00, 5.8064, false, 18, 'Suisse', '1897-1949', null),
  ('krugerrand1', 'Krugerrand 1 once', 33.9305, 916.67, 31.1035, false, 20, 'Afrique du Sud', '1967-', null),
  ('dollars10', '10 dollars Eagle (Liberty, Indian Head)', 16.7185, 900.00, 15.0466, false, 22, 'États-Unis', '1838-1933', null),
  ('marianne_coq', 'Marianne Coq 20 francs', 6.4516, 900.00, 5.8064, false, 24, 'France', '1899-1914', null),
  ('francs10', '10 francs or', 3.2258, 900.00, 2.9032, false, 26, 'France', '1850-1914', null),
  ('maple1', 'Maple Leaf 1 once (or 999,9)', 31.1035, 999.90, 31.1035, false, 28, 'Canada', '1982-', null),
  ('philharmonique1', 'Philharmonique de Vienne 1 once', 31.1035, 999.90, 31.1035, false, 30, 'Autriche', '1989-', null),
  ('eagle1', 'American Eagle 1 once (50 $)', 33.9310, 916.67, 31.1035, false, 32, 'États-Unis', '1986-', null),
  ('mark20', '20 marks (Empire)', 7.9650, 900.00, 7.1685, false, 34, 'Allemagne', '1871-1915', null),
  ('lire20', '20 lires (Victor-Emmanuel II, Humbert Ier)', 6.4516, 900.00, 5.8064, false, 36, 'Italie', '1861-1912', null),
  ('belge20', '20 francs belges (Léopold Ier/II, Albert Ier)', 6.4516, 900.00, 5.8064, false, 38, 'Belgique', '1865-1914', null),
  ('dollars5', '5 dollars Half Eagle (Liberty, Indian Head)', 8.3592, 900.00, 7.5233, false, 40, 'États-Unis', '1839-1929', null),
  ('demi_souverain', 'Demi-souverain', 3.9940, 916.67, 3.6612, false, 42, 'Royaume-Uni', '1817-', null),
  ('pesos20', '20 pesos (calendrier aztèque)', 16.6666, 900.00, 15.0000, false, 44, 'Mexique', '1917-1959', null),
  ('pesos10', '10 pesos Hidalgo', 8.3333, 900.00, 7.5000, false, 46, 'Mexique', '1905-1959', null),
  ('britannia1', 'Britannia 1 once (or 999,9)', 31.1035, 999.90, 31.1035, false, 50, 'Royaume-Uni', '2013-', null),
  ('buffalo1', 'American Buffalo 1 once (50 $)', 31.1080, 999.90, 31.1035, false, 52, 'États-Unis', '2006-', null),
  ('libertad1', 'Libertad 1 once (or 999)', 31.1035, 999.00, 31.1035, false, 54, 'Mexique', '1991-', null),
  ('kangourou1', 'Kangourou (Nugget) 1 once', 31.1035, 999.90, 31.1035, false, 56, 'Australie', '1986-', null),
  ('panda30', 'Panda 30 g', 30.0000, 999.00, 29.9700, false, 58, 'Chine', '2016-', null),
  ('louis_xvi', 'Louis d''or Louis XVI au buste (1785-1792)', 7.6490, 917.00, 7.0141, false, 60, 'France', '1785-1792', null),
  ('francs5_fr', '5 francs or Napoléon III', 1.6129, 900.00, 1.4516, false, 120, 'France', '1854-1869', null),
  ('francs40_fr', '40 francs or', 12.9032, 900.00, 11.6129, false, 122, 'France', '1803-1839', null),
  ('francs50_fr', '50 francs or (Napoléon III, Génie)', 16.1290, 900.00, 14.5161, false, 124, 'France', '1855-1904', null),
  ('francs100_fr', '100 francs or (Napoléon III, Génie) — hors 100 F « Bazor » 1929-1936', 32.2581, 900.00, 29.0323, false, 126, 'France', '1855-1914', null),
  ('vreneli10', '10 francs Vreneli', 3.2258, 900.00, 2.9032, false, 128, 'Suisse', '1911-1922', null),
  ('vreneli100', '100 francs Vreneli', 32.2581, 900.00, 29.0323, false, 130, 'Suisse', '1925', null),
  ('helvetia20', '20 francs Helvetia', 6.4516, 900.00, 5.8064, false, 132, 'Suisse', '1883-1896', null),
  ('pesetas20', '20 pesetas (Alphonse XIII)', 6.4516, 900.00, 5.8064, false, 134, 'Espagne', '1887-1904', null),
  ('pesetas25', '25 pesetas (Alphonse XII)', 8.0645, 900.00, 7.2581, false, 136, 'Espagne', '1876-1885', null),
  ('drachmes20', '20 drachmes', 6.4516, 900.00, 5.8064, false, 138, 'Grèce', '1876-1884', null),
  ('florins8', '8 florins / 20 francs', 6.4516, 900.00, 5.8064, false, 140, 'Autriche-Hongrie', '1870-1892', null),
  ('florins4', '4 florins / 10 francs', 3.2258, 900.00, 2.9032, false, 142, 'Autriche-Hongrie', '1870-1892', null),
  ('couronnes20_at', '20 couronnes (François-Joseph)', 6.7751, 900.00, 6.0976, false, 144, 'Autriche', '1892-1916', null),
  ('couronnes10_at', '10 couronnes (François-Joseph)', 3.3875, 900.00, 3.0488, false, 146, 'Autriche', '1892-1912', null),
  ('couronnes100_at', '100 couronnes (François-Joseph, refrappe 1915)', 33.8753, 900.00, 30.4878, false, 148, 'Autriche', '1908-1915', null),
  ('ducat1_at', '1 ducat (refrappe 1915)', 3.4909, 986.00, 3.4420, false, 150, 'Autriche', '1872-1915', null),
  ('ducats4_at', '4 ducats (refrappe 1915)', 13.9636, 986.00, 13.7681, false, 152, 'Autriche', '1872-1915', null),
  ('korona20_hu', '20 korona', 6.7751, 900.00, 6.0976, false, 154, 'Hongrie', '1892-1916', null),
  ('mark10', '10 marks (Empire)', 3.9825, 900.00, 3.5843, false, 156, 'Allemagne', '1872-1914', null),
  ('florins10_nl', '10 florins', 6.7290, 900.00, 6.0561, false, 158, 'Pays-Bas', '1875-1933', null),
  ('kroner20_dk', '20 couronnes', 8.9606, 900.00, 8.0645, false, 160, 'Danemark', '1873-1931', null),
  ('kroner10_dk', '10 couronnes', 4.4803, 900.00, 4.0323, false, 162, 'Danemark', '1873-1917', null),
  ('kronor20_se', '20 couronnes', 8.9606, 900.00, 8.0645, false, 164, 'Suède', '1873-1925', null),
  ('kroner20_no', '20 couronnes', 8.9606, 900.00, 8.0645, false, 166, 'Norvège', '1874-1910', null),
  ('roubles5', '5 roubles Nicolas II', 4.3013, 900.00, 3.8712, false, 168, 'Russie', '1897-1911', null),
  ('roubles10', '10 roubles Nicolas II', 8.6026, 900.00, 7.7423, false, 170, 'Russie', '1898-1911', null),
  ('chervonets', 'Tchervonets (10 roubles)', 8.6026, 900.00, 7.7423, false, 172, 'URSS', '1923, 1975-1982', null),
  ('kurush100', '100 kurush (piastres)', 7.2160, 916.67, 6.6147, false, 174, 'Turquie', '1923-', null),
  ('livres2_gb', '2 livres (double souverain)', 15.9761, 916.67, 14.6448, false, 176, 'Royaume-Uni', '1820-', null),
  ('livres5_gb', '5 livres (quintuple souverain)', 39.9403, 916.67, 36.6119, false, 178, 'Royaume-Uni', '1820-', null),
  ('libra_pe', '1 libra', 7.9881, 916.67, 7.3224, false, 180, 'Pérou', '1898-1969', null),
  ('dollars10_1795', '10 dollars Eagle Capped Bust', 17.4960, 916.67, 16.0378, false, 182, 'États-Unis', '1795-1804', null),
  ('dollars3', '3 dollars Indian Princess', 5.0155, 900.00, 4.5140, false, 184, 'États-Unis', '1854-1889', null),
  ('dollars2_5', '2,5 dollars Quarter Eagle (Liberty, Indian Head)', 4.1796, 900.00, 3.7616, false, 186, 'États-Unis', '1840-1929', null),
  ('dollars1', '1 dollar or', 1.6718, 900.00, 1.5046, false, 188, 'États-Unis', '1849-1889', null),
  ('eagle_demi', 'American Eagle 1/2 once (25 $)', 16.9660, 916.67, 15.5517, false, 190, 'États-Unis', '1986-', null),
  ('eagle_quart', 'American Eagle 1/4 once (10 $)', 8.4830, 916.67, 7.7759, false, 192, 'États-Unis', '1986-', null),
  ('eagle_dixieme', 'American Eagle 1/10 once (5 $)', 3.3930, 916.67, 3.1103, false, 194, 'États-Unis', '1986-', null),
  ('pesos5', '5 pesos Hidalgo', 4.1666, 900.00, 3.7500, false, 196, 'Mexique', '1905-1955', null),
  ('pesos2_5', '2,5 pesos Hidalgo', 2.0833, 900.00, 1.8750, false, 198, 'Mexique', '1918-1948', null),
  ('pesos2', '2 pesos', 1.6666, 900.00, 1.5000, false, 200, 'Mexique', '1919-1945', null),
  ('pesos100_cl', '100 pesos', 20.3397, 900.00, 18.3057, false, 202, 'Chili', '1926-1980', null),
  ('pesos50_cl', '50 pesos', 10.1698, 900.00, 9.1528, false, 204, 'Chili', '1926-1962', null),
  ('pesos20_cl', '20 pesos', 4.0679, 900.00, 3.6611, false, 206, 'Chili', '1926-1980', null),
  ('krugerrand_demi', 'Krugerrand 1/2 once', 16.9653, 916.67, 15.5517, false, 208, 'Afrique du Sud', '1980-', null),
  ('krugerrand_quart', 'Krugerrand 1/4 once', 8.4826, 916.67, 7.7759, false, 210, 'Afrique du Sud', '1980-', null),
  ('krugerrand_dixieme', 'Krugerrand 1/10 once', 3.3931, 916.67, 3.1103, false, 212, 'Afrique du Sud', '1980-', null),
  ('maple_demi', 'Maple Leaf 1/2 once', 15.5517, 999.90, 15.5517, false, 214, 'Canada', '1982-', null),
  ('maple_quart', 'Maple Leaf 1/4 once', 7.7759, 999.90, 7.7759, false, 216, 'Canada', '1982-', null),
  ('maple_dixieme', 'Maple Leaf 1/10 once', 3.1103, 999.90, 3.1103, false, 218, 'Canada', '1982-', null),
  ('philharmonique_demi', 'Philharmonique 1/2 once', 15.5517, 999.90, 15.5517, false, 220, 'Autriche', '1989-', null),
  ('philharmonique_quart', 'Philharmonique 1/4 once', 7.7759, 999.90, 7.7759, false, 222, 'Autriche', '1989-', null),
  ('philharmonique_dixieme', 'Philharmonique 1/10 once', 3.1103, 999.90, 3.1103, false, 224, 'Autriche', '1991-', null),
  ('panda1oz', 'Panda 1 once', 31.1035, 999.00, 31.1035, false, 226, 'Chine', '1982-2015', null),
  ('louis_autre', 'Louis d''or historique — autre type', null,   null,   null,   true, 890, 'France', '1640-1792', null),
  ('autre', 'Autre pièce', null,   null,   null,   true, 999, null, null, null)
on conflict (code) do update set
  nom = excluded.nom, poids_brut_g = excluded.poids_brut_g, titre_millieme = excluded.titre_millieme,
  poids_fin_g = excluded.poids_fin_g, saisie_libre = excluded.saisie_libre, ordre = excluded.ordre,
  pays = excluded.pays, annees = excluded.annees, source = excluded.source;
