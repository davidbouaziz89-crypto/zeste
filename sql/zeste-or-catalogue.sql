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
  ('napoleon20', 'Napoléon 20 francs', 6.4516, 900.00, 5.8064, false, 10, 'France', '1803-1914', 'https://en.numista.com/catalogue/pieces6718.html'),
  ('pesos50', '50 pesos mexicains Centenario', 41.6667, 900.00, 37.5000, false, 12, 'Mexique', '1921-1947 (+ refrappes)', 'https://en.numista.com/catalogue/pieces15038.html'),
  ('souverain', 'Souverain britannique', 7.9881, 916.67, 7.3224, false, 14, 'Royaume-Uni', '1817-', 'https://www.royalmint.com/collect/archive/2022/2022-five-coin-gold-proof-set/'),
  ('dollars20', '20 dollars américains Double Eagle (Liberty, Saint-Gaudens)', 33.4362, 900.00, 30.0926, false, 16, 'États-Unis', '1850-1933', 'https://en.numista.com/catalogue/pieces23129.html'),
  ('vreneli20', '20 francs suisse (Vreneli)', 6.4516, 900.00, 5.8064, false, 18, 'Suisse', '1897-1949', 'https://en.numista.com/catalogue/pieces7497.html'),
  ('krugerrand1', 'Krugerrand 1 once', 33.9300, 916.67, 31.1035, false, 20, 'Afrique du Sud', '1967-', 'https://www.samint.co.za/2026-range/'),
  ('dollars10', '10 dollars américains Eagle (Liberty, Indian Head)', 16.7181, 900.00, 15.0463, false, 22, 'États-Unis', '1838-1933', 'https://en.numista.com/catalogue/pieces23124.html'),
  ('marianne_coq', 'Marianne Coq 20 francs', 6.4516, 900.00, 5.8064, false, 24, 'France', '1899-1914', 'https://en.numista.com/catalogue/pieces2230.html'),
  ('francs10', '10 francs or', 3.2258, 900.00, 2.9032, false, 26, 'France', '1850-1914', 'https://en.numista.com/catalogue/pieces6929.html'),
  ('maple1', 'Maple Leaf 1 once (or 999,9)', 31.1100, 999.90, 31.1035, false, 28, 'Canada', '1982-', 'https://www.mint.ca/en/shop/coins/2025/2025-gml-1-oz-9999-pure-gold-coin-bullion'),
  ('philharmonique1', 'Philharmonique de Vienne 1 once', 31.1035, 999.90, 31.1035, false, 30, 'Autriche', '1989-', 'https://en.numista.com/catalogue/pieces23519.html'),
  ('eagle1', 'American Eagle 1 once (50 $)', 33.9310, 916.67, 31.1035, false, 32, 'États-Unis', '1986-', 'https://www.usmint.gov/coins-precious-metal-coins/bullion-coin-programs/'),
  ('mark20', '20 marks allemands (Empire)', 7.9650, 900.00, 7.1685, false, 34, 'Allemagne', '1871-1915', 'https://en.numista.com/catalogue/pieces21444.html'),
  ('lire20', '20 lires italiennes (Victor-Emmanuel II, Humbert Ier)', 6.4516, 900.00, 5.8064, false, 36, 'Italie', '1861-1897', 'https://en.numista.com/catalogue/pieces17714.html'),
  ('belge20', '20 francs belges (Léopold Ier/II, Albert Ier)', 6.4516, 900.00, 5.8064, false, 38, 'Belgique', '1865-1914', 'https://en.numista.com/catalogue/pieces7499.html'),
  ('dollars5', '5 dollars américains Half Eagle (Liberty, Indian Head)', 8.3591, 900.00, 7.5232, false, 40, 'États-Unis', '1839-1929', 'https://en.numista.com/catalogue/pieces18809.html'),
  ('demi_souverain', 'Demi-souverain', 3.9940, 916.67, 3.6612, false, 42, 'Royaume-Uni', '1817-', 'https://www.royalmint.com/collect/archive/2022/2022-five-coin-gold-proof-set/'),
  ('pesos20', '20 pesos mexicains (calendrier aztèque)', 16.6667, 900.00, 15.0000, false, 44, 'Mexique', '1917-1959', 'https://en.numista.com/catalogue/pieces15037.html'),
  ('pesos10', '10 pesos mexicains Hidalgo', 8.3333, 900.00, 7.5000, false, 46, 'Mexique', '1905-1959', 'https://en.numista.com/catalogue/pieces26767.html'),
  ('britannia1', 'Britannia 1 once (or 999,9)', 31.2100, 999.90, 31.1035, false, 50, 'Royaume-Uni', '2013-', 'https://www.royalmint.com/collect/archive/britannia-2018-one-ounce-gold-bullion-coin/'),
  ('buffalo1', 'American Buffalo 1 once (50 $)', 31.1080, 999.90, 31.1035, false, 52, 'États-Unis', '2006-', 'https://usmint.gov/?p=4908'),
  ('libertad1', 'Libertad 1 once (or 999)', 31.1035, 999.00, 31.1035, false, 54, 'Mexique', '1991-', 'https://www.cmm.gob.mx/cmtienda/libertad-oro-proof-1oz.html'),
  ('kangourou1', 'Kangourou (Nugget) 1 once', 31.1070, 999.90, 31.1035, false, 56, 'Australie', '1986-', 'https://www.perthmint.com/shop/bullion/bullion-coins/Australian-kangaroo-2022-1oz-gold-bullion-coin/'),
  ('panda30', 'Panda 30 g', 30.0000, 999.00, 30.0000, false, 58, 'Chine', '2016-', 'https://m.thepaper.cn/newsDetail_forward_29120220'),
  ('louis_xvi', 'Louis d''or Louis XVI au buste (1785-1792)', 7.6490, 917.00, 7.0141, false, 60, 'France', '1785-1792', 'https://en.numista.com/catalogue/pieces10936.html'),
  ('francs5_fr', '5 francs or Napoléon III', 1.6129, 900.00, 1.4516, false, 120, 'France', '1854-1869', 'https://en.numista.com/catalogue/pieces5308.html'),
  ('francs40_fr', '40 francs or', 12.9032, 900.00, 11.6129, false, 122, 'France', '1803-1839', 'https://en.numista.com/catalogue/pieces17713.html'),
  ('francs50_fr', '50 francs or (Napoléon III, Génie)', 16.1290, 900.00, 14.5161, false, 124, 'France', '1855-1904', 'https://en.numista.com/catalogue/pieces11340.html'),
  ('francs100_fr', '100 francs or (Napoléon III, Génie) — hors 100 F « Bazor » 1929-1936', 32.2581, 900.00, 29.0323, false, 126, 'France', '1855-1914', 'https://en.numista.com/catalogue/pieces18182.html'),
  ('vreneli10', '10 francs Vreneli', 3.2258, 900.00, 2.9032, false, 128, 'Suisse', '1911-1922', 'https://en.numista.com/catalogue/pieces3950.html'),
  ('vreneli100', '100 francs Vreneli', 32.2581, 900.00, 29.0323, false, 130, 'Suisse', '1925', 'https://en.numista.com/catalogue/pieces23261.html'),
  ('helvetia20', '20 francs Helvetia', 6.4516, 900.00, 5.8064, false, 132, 'Suisse', '1883-1896', 'https://en.numista.com/catalogue/pieces20901.html'),
  ('pesetas20', '20 pesetas espagnoles (Alphonse XIII)', 6.4516, 900.00, 5.8064, false, 134, 'Espagne', '1887-1904', 'https://en.numista.com/catalogue/pieces17586.html'),
  ('pesetas25', '25 pesetas espagnoles (Alphonse XII)', 8.0645, 900.00, 7.2581, false, 136, 'Espagne', '1876-1885', 'https://en.numista.com/catalogue/pieces14830.html'),
  ('drachmes20', '20 drachmes grecques', 6.4516, 900.00, 5.8064, false, 138, 'Grèce', '1876-1884', 'https://en.numista.com/catalogue/pieces26036.html'),
  ('florins8', '8 florins / 20 francs', 6.4516, 900.00, 5.8064, false, 140, 'Autriche-Hongrie', '1870-1892', 'https://en.numista.com/catalogue/pieces17723.html'),
  ('florins4', '4 florins / 10 francs', 3.2258, 900.00, 2.9032, false, 142, 'Autriche-Hongrie', '1870-1892', 'https://en.numista.com/catalogue/pieces23664.html'),
  ('couronnes20_at', '20 couronnes autrichiennes (François-Joseph)', 6.7751, 900.00, 6.0976, false, 144, 'Autriche', '1892-1916', 'https://en.numista.com/catalogue/pieces28374.html'),
  ('couronnes10_at', '10 couronnes autrichiennes (François-Joseph)', 3.3875, 900.00, 3.0488, false, 146, 'Autriche', '1896-1912', 'https://en.numista.com/catalogue/pieces20870.html'),
  ('couronnes100_at', '100 couronnes autrichiennes (François-Joseph, refrappe 1915)', 33.8753, 900.00, 30.4878, false, 148, 'Autriche', '1908-1915', 'https://en.numista.com/catalogue/pieces15147.html'),
  ('ducat1_at', '1 ducat (refrappe 1915)', 3.4909, 986.00, 3.4420, false, 150, 'Autriche', '1872-1915', 'https://www.muenzeoesterreich.com/en/products/1-ducat-gold-coin'),
  ('ducats4_at', '4 ducats (refrappe 1915)', 13.9636, 986.00, 13.7681, false, 152, 'Autriche', '1872-1915', 'https://www.muenzeoesterreich.com/en/invest/investment-coins/ducats'),
  ('korona20_hu', '20 korona hongroises', 6.7751, 900.00, 6.0976, false, 154, 'Hongrie', '1892-1916', 'https://en.numista.com/catalogue/pieces33163.html'),
  ('mark10', '10 marks allemands (Empire)', 3.9825, 900.00, 3.5843, false, 156, 'Allemagne', '1872-1914', 'https://en.numista.com/catalogue/pieces32033.html'),
  ('florins10_nl', '10 florins néerlandais', 6.7290, 900.00, 6.0561, false, 158, 'Pays-Bas', '1875-1933', 'https://en.numista.com/catalogue/pieces26721.html'),
  ('kroner20_dk', '20 couronnes danoises', 8.9606, 900.00, 8.0645, false, 160, 'Danemark', '1873-1931', 'https://en.numista.com/catalogue/pieces25627.html'),
  ('kroner10_dk', '10 couronnes danoises', 4.4803, 900.00, 4.0323, false, 162, 'Danemark', '1873-1917', 'https://en.numista.com/catalogue/pieces39996.html'),
  ('kronor20_se', '20 couronnes suédoises', 8.9606, 900.00, 8.0645, false, 164, 'Suède', '1873-1925', 'https://en.numista.com/catalogue/pieces37778.html'),
  ('kroner20_no', '20 couronnes norvégiennes', 8.9606, 900.00, 8.0645, false, 166, 'Norvège', '1874-1910', 'https://en.numista.com/catalogue/pieces38994.html'),
  ('roubles5', '5 roubles Nicolas II', 4.3013, 900.00, 3.8712, false, 168, 'Russie', '1897-1911', 'https://en.numista.com/catalogue/pieces20953.html'),
  ('roubles10', '10 roubles Nicolas II', 8.6026, 900.00, 7.7423, false, 170, 'Russie', '1898-1911', 'https://en.numista.com/catalogue/pieces18722.html'),
  ('chervonets', 'Tchervonets (10 roubles)', 8.6026, 900.00, 7.7423, false, 172, 'URSS', '1923, 1975-1982', 'https://en.numista.com/catalogue/pieces26865.html'),
  ('kurush100', '100 kurush (piastres)', 7.2160, 916.67, 6.6147, false, 174, 'Turquie', '1923-', 'https://en.numista.com/catalogue/pieces169120.html'),
  ('livres2_gb', '2 livres (double souverain)', 15.9761, 916.67, 14.6448, false, 176, 'Royaume-Uni', '1820-', 'https://www.royalmint.com/collect/archive/2022/2022-five-coin-gold-proof-set/'),
  ('livres5_gb', '5 livres (quintuple souverain)', 39.9403, 916.67, 36.6119, false, 178, 'Royaume-Uni', '1820-', 'https://www.royalmint.com/collect/archive/2022/2022-five-coin-gold-proof-set/'),
  ('libra_pe', '1 libra péruvienne', 7.9881, 916.67, 7.3224, false, 180, 'Pérou', '1898-1969', 'https://en.numista.com/catalogue/pieces46644.html'),
  ('dollars10_1795', '10 dollars américains Eagle Capped Bust', 17.4957, 916.67, 16.0377, false, 182, 'États-Unis', '1795-1804', 'https://en.numista.com/catalogue/pieces25382.html'),
  ('dollars3', '3 dollars américains Indian Princess', 5.0154, 900.00, 4.5139, false, 184, 'États-Unis', '1854-1889', 'https://en.numista.com/catalogue/pieces23121.html'),
  ('dollars2_5', '2,5 dollars américains Quarter Eagle (Liberty, Indian Head)', 4.1795, 900.00, 3.7616, false, 186, 'États-Unis', '1840-1929', 'https://en.numista.com/catalogue/pieces13432.html'),
  ('dollars1', '1 dollar américain or', 1.6718, 900.00, 1.5046, false, 188, 'États-Unis', '1849-1889', 'https://en.numista.com/catalogue/pieces23120.html'),
  ('eagle_demi', 'American Eagle 1/2 once (25 $)', 16.9660, 916.67, 15.5517, false, 190, 'États-Unis', '1986-', 'https://www.usmint.gov/coins-precious-metal-coins/bullion-coin-programs/'),
  ('eagle_quart', 'American Eagle 1/4 once (10 $)', 8.4830, 916.67, 7.7759, false, 192, 'États-Unis', '1986-', 'https://www.usmint.gov/coins-precious-metal-coins/bullion-coin-programs/'),
  ('eagle_dixieme', 'American Eagle 1/10 once (5 $)', 3.3930, 916.67, 3.1103, false, 194, 'États-Unis', '1986-', 'https://www.usmint.gov/coins-precious-metal-coins/bullion-coin-programs/'),
  ('pesos5', '5 pesos mexicains Hidalgo', 4.1667, 900.00, 3.7500, false, 196, 'Mexique', '1905-1955', 'https://en.numista.com/catalogue/pieces28708.html'),
  ('pesos2_5', '2,5 pesos mexicains Hidalgo', 2.0833, 900.00, 1.8750, false, 198, 'Mexique', '1918-1948', 'https://en.numista.com/catalogue/pieces18813.html'),
  ('pesos2', '2 pesos mexicains', 1.6667, 900.00, 1.5000, false, 200, 'Mexique', '1919-1948', 'https://en.numista.com/catalogue/pieces13933.html'),
  ('pesos100_cl', '100 pesos chiliens', 20.3397, 900.00, 18.3057, false, 202, 'Chili', '1926-1980', 'https://en.numista.com/catalogue/pieces34942.html'),
  ('pesos50_cl', '50 pesos chiliens', 10.1698, 900.00, 9.1528, false, 204, 'Chili', '1926-1974', 'https://en.numista.com/catalogue/pieces34943.html'),
  ('pesos20_cl', '20 pesos chiliens', 4.0679, 900.00, 3.6611, false, 206, 'Chili', '1926-1980', 'https://en.numista.com/catalogue/pieces34945.html'),
  ('krugerrand_demi', 'Krugerrand 1/2 once', 16.9650, 916.67, 15.5517, false, 208, 'Afrique du Sud', '1980-', 'https://www.samint.co.za/2026-range/'),
  ('krugerrand_quart', 'Krugerrand 1/4 once', 8.4820, 916.67, 7.7759, false, 210, 'Afrique du Sud', '1980-', 'https://www.samint.co.za/2026-range/'),
  ('krugerrand_dixieme', 'Krugerrand 1/10 once', 3.3930, 916.67, 3.1103, false, 212, 'Afrique du Sud', '1980-', 'https://www.samint.co.za/2026-range/'),
  ('maple_demi', 'Maple Leaf 1/2 once', 15.5517, 999.90, 15.5517, false, 214, 'Canada', '1986-', 'https://www.mint.ca/en/shop/coins/2025/2025-gml-1-oz-9999-pure-gold-coin-bullion'),
  ('maple_quart', 'Maple Leaf 1/4 once', 7.7759, 999.90, 7.7759, false, 216, 'Canada', '1982-', 'https://www.mint.ca/en/shop/coins/2025/2025-gml-1-oz-9999-pure-gold-coin-bullion'),
  ('maple_dixieme', 'Maple Leaf 1/10 once', 3.1103, 999.90, 3.1103, false, 218, 'Canada', '1982-', 'https://www.mint.ca/en/shop/coins/2025/2025-gml-1-oz-9999-pure-gold-coin-bullion'),
  ('philharmonique_demi', 'Philharmonique 1/2 once', 15.5517, 999.90, 15.5517, false, 220, 'Autriche', '1994-', 'https://en.numista.com/catalogue/pieces41418.html'),
  ('philharmonique_quart', 'Philharmonique 1/4 once', 7.7759, 999.90, 7.7759, false, 222, 'Autriche', '1989-', 'https://en.numista.com/catalogue/pieces9167.html'),
  ('philharmonique_dixieme', 'Philharmonique 1/10 once', 3.1210, 999.90, 3.1103, false, 224, 'Autriche', '1991-', 'https://en.numista.com/catalogue/pieces20259.html'),
  ('panda1oz', 'Panda 1 once', 31.1035, 999.00, 31.1035, false, 226, 'Chine', '1982-2015', 'https://en.numista.com/catalogue/pieces109508.html'),
  ('louis_autre', 'Louis d''or historique — autre type', null,   null,   null,   true, 890, 'France', '1640-1792', null),
  ('autre', 'Autre pièce', null,   null,   null,   true, 999, null, null, null)
on conflict (code) do update set
  nom = excluded.nom, poids_brut_g = excluded.poids_brut_g, titre_millieme = excluded.titre_millieme,
  poids_fin_g = excluded.poids_fin_g, saisie_libre = excluded.saisie_libre, ordre = excluded.ordre,
  pays = excluded.pays, annees = excluded.annees, source = excluded.source;
