-- ============================================================
--  Zeste 🍋 — Synchro v2 : numéro de version par compte (anti-écrasement)
--  ⚠️ PRÉPARÉ, NON APPLIQUÉ. À exécuter seulement après le « go » de David,
--     d'abord en répétition BEGIN … ROLLBACK, puis pour de vrai.
--
--  Problème réglé : aujourd'hui zeste_save_mine remplace tout l'état sans
--  vérifier que l'appareil connaissait la dernière version. Deux appareils
--  peuvent donc s'écraser (le dernier qui écrit gagne). L'appli prépare déjà
--  une protection « relire puis écrire », mais il reste une fenêtre de course
--  de quelques centaines de millisecondes : seule une vérification DANS la
--  même transaction serveur la supprime.
--
--  Principe : chaque ligne zeste.user_data porte un numéro « rev ».
--   - zeste_load_mine_v2()               → {data, rev}
--   - zeste_save_mine_v2(data, base_rev) → enregistre seulement si rev = base_rev,
--     sinon refuse avec « Conflit de synchronisation » ; renvoie le nouveau rev.
--   - zeste_save_mine (ancienne version, encore utilisée par les appareils pas
--     encore mis à jour) incrémente AUSSI rev : leurs écritures restent détectées.
--   - Dès qu'un appareil à jour a écrit (colonne v2_only = true), l'ancienne
--     fonction REFUSE toute écriture : une ancienne version restée ouverte ne peut
--     plus écraser les archives ni contourner le numéro de version. Le message
--     commence par « Remboursement refusé » car c'est le seul que l'ancienne
--     version affiche à l'écran (sinon elle échouerait en silence).
--  Le contrôle des remboursements (zeste.verif_remboursements) est conservé.
--  L'appli détecte seule la présence de v2 ; sans ce script elle continue
--  avec l'ancienne méthode. Idempotent : peut être rejoué.
-- ============================================================

-- tout ou rien : une erreur au milieu annule l'ensemble (jamais de migration à moitié appliquée)
begin;

alter table zeste.user_data add column if not exists rev bigint not null default 0;
alter table zeste.user_data add column if not exists v2_only boolean not null default false;

create or replace function public.zeste_load_mine_v2()
returns jsonb language plpgsql stable security definer set search_path = zeste, public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select data, rev into r from zeste.user_data where user_id = auth.uid();
  if not found then return jsonb_build_object('data', null, 'rev', null); end if;
  return jsonb_build_object('data', r.data, 'rev', r.rev);
end;
$$;

create or replace function public.zeste_save_mine_v2(p_data jsonb, p_base_rev bigint)
returns bigint language plpgsql security definer set search_path = zeste, public as $$
declare cur bigint;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform zeste.verif_remboursements(p_data);
  select rev into cur from zeste.user_data where user_id = auth.uid() for update;
  if not found then
    if p_base_rev is not null then
      raise exception 'Conflit de synchronisation : aucune donnée sur le serveur (version % attendue)', p_base_rev;
    end if;
    insert into zeste.user_data(user_id, data, updated_at, rev, v2_only) values (auth.uid(), p_data, now(), 1, true);
    return 1;
  end if;
  if p_base_rev is distinct from cur then
    raise exception 'Conflit de synchronisation : version % attendue, % sur le serveur', p_base_rev, cur;
  end if;
  update zeste.user_data set data = p_data, updated_at = now(), rev = cur + 1, v2_only = true where user_id = auth.uid();
  return cur + 1;
end;
$$;

-- ancienne fonction : même comportement tant qu'aucun appareil à jour n'a écrit,
-- le numéro de version avance aussi ; refus dès que le compte est passé en v2
create or replace function public.zeste_save_mine(p_data jsonb)
returns void language plpgsql security definer set search_path = zeste, public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from zeste.user_data where user_id = auth.uid() and v2_only) then
    raise exception 'Remboursement refusé : version de Zeste périmée sur cet appareil. Ferme complètement l''appli et rouvre-la (rien n''a été enregistré).';
  end if;
  perform zeste.verif_remboursements(p_data);
  insert into zeste.user_data(user_id, data, updated_at, rev)
  values (auth.uid(), p_data, now(), 1)
  on conflict (user_id) do update set data = excluded.data, updated_at = now(), rev = zeste.user_data.rev + 1;
end;
$$;

revoke all on function public.zeste_load_mine_v2()               from public;
revoke all on function public.zeste_save_mine_v2(jsonb, bigint)  from public;
revoke all on function public.zeste_load_mine_v2()               from anon;
revoke all on function public.zeste_save_mine_v2(jsonb, bigint)  from anon;
grant execute on function public.zeste_load_mine_v2()              to authenticated;
grant execute on function public.zeste_save_mine_v2(jsonb, bigint) to authenticated;

-- même propriétaire que zeste_save_mine (security definer) : sinon l'appel interne à
-- zeste.verif_remboursements est refusé (« permission denied ») — piège déjà vécu le 01/10/2026
do $$
declare o text := (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.zeste_save_mine(jsonb)'::regprocedure);
begin
  execute format('alter function public.zeste_load_mine_v2() owner to %I', o);
  execute format('alter function public.zeste_save_mine_v2(jsonb, bigint) owner to %I', o);
end $$;

commit;

-- Vérification après application :
--   select to_regprocedure('public.zeste_load_mine_v2()'), to_regprocedure('public.zeste_save_mine_v2(jsonb,bigint)');
--   select column_name from information_schema.columns where table_schema='zeste' and table_name='user_data' and column_name in ('rev','v2_only');
-- Retour arrière : sql/zeste-sync-v2-retour.sql (testé sur la base isolée le 30/10/2026).
