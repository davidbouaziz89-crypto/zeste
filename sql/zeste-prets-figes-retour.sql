-- ============================================================
--  Zeste 🍋 — RETOUR ARRIÈRE de sql/zeste-prets-figes.sql : définition EXACTE de zeste_save_mine_v2
--  en production au 19/11/2026 (sauvegarde ~/sauvegardes/zeste-20261119-195125/fonctions.sql).
--  ⚠️ Rouvre l'écriture des prêts dans Zeste : à n'utiliser qu'en revenant AUSSI à l'ancien Zeste
--  (main = 4ab662a, tag zeste-avant-valora), et en sachant que VALORA ne verra plus ces changements.
-- ============================================================
begin;
CREATE OR REPLACE FUNCTION public.zeste_save_mine_v2(p_data jsonb, p_base_rev bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'zeste', 'public'
AS $function$
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
$function$
;
commit;
