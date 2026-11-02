-- ============================================================
--  Zeste 🍋 — RETOUR ARRIÈRE de sql/zeste-securite.sql, version À UTILISER depuis le
--  correctif de sécurité publié le 02/11/2026 à 20 h 10 (sql/zeste-correctif-securite.sql).
--
--  Ramène à l'état de production APRÈS correctif (failles fermées), pas avant :
--  zeste-securite.sql n'ajoute à ce correctif que zeste_rev_mine (numéro de version
--  pour la nouvelle appli) ; tout le reste y est identique (empreintes vérifiées par
--  tests/sync/serveur.test.mjs). Sans zeste_rev_mine, la nouvelle appli relit le serveur
--  complètement toutes les 60 s au lieu de demander le numéro : elle continue de marcher.
--
--  ⚠️ Ne PAS utiliser sql/zeste-securite-retour.sql : il remet l'état d'AVANT le correctif
--  (accès anonymes rouverts). Réservé à un blocage grave, avec l'accord exprès de David.
--  Aucune donnée touchée. Tout ou rien.
-- ============================================================
begin;
drop function if exists public.zeste_rev_mine();
commit;
