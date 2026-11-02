-- ============================================================
--  Zeste 🍋 — RETOUR ARRIÈRE de sql/zeste-sync-v2.sql
--  Remet l'écriture d'avant (zeste_save_mine sans numéro de version ni refus)
--  et retire les fonctions v2. Les données ne sont pas touchées ; les colonnes
--  rev et v2_only restent (inutilisées). L'appli à jour repasse seule sur
--  l'ancienne méthode (« vérifier puis écrire »), l'ancienne appli remarche.
--  Tout ou rien (transaction).
-- ============================================================
begin;

drop function if exists public.zeste_load_mine_v2();
drop function if exists public.zeste_save_mine_v2(jsonb, bigint);

-- même définition que sql/zeste-remboursements.sql
create or replace function public.zeste_save_mine(p_data jsonb)
returns void language plpgsql security definer set search_path = zeste, public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform zeste.verif_remboursements(p_data);
  insert into zeste.user_data(user_id, data, updated_at)
  values (auth.uid(), p_data, now())
  on conflict (user_id) do update set data = excluded.data, updated_at = now();
end;
$$;

commit;

-- Vérification : select to_regprocedure('public.zeste_save_mine_v2(jsonb,bigint)');  → vide
