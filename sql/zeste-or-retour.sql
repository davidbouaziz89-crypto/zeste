-- ============================================================
--  Zeste 🍋 — RETOUR ARRIÈRE de sql/zeste-or.sql
--  Coupe l'accès à l'onglet Or SANS rien effacer : les tables zeste.or_* et
--  leurs données (achats, ventes, photos, cours) restent, simplement plus
--  appelables. Réactiver = rejouer sql/zeste-or.sql. Tout ou rien.
-- ============================================================
begin;
do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname like 'zeste\_or\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end $$;
commit;
-- Vérification : select count(*) from information_schema.routine_privileges
--   where routine_name like 'zeste_or_%' and grantee in ('anon','authenticated','service_role');  → 0
