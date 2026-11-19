-- ============================================================
--  Zeste 🍋 — Prêts FIGÉS après leur transfert dans VALORA (19/11/2026)
--  À appliquer JUSTE AVANT la copie des prêts (valora/sql/valora-import-prets.sql), sous verrou.
--
--  Problème : un ancien Zeste resté ouvert sur un téléphone (avec l'onglet Prêts) pourrait encore
--  créer, modifier, rembourser ou archiver un prêt APRÈS la copie : ce changement resterait dans Zeste
--  et n'arriverait jamais dans VALORA.
--  Parade côté serveur : zeste_save_mine_v2 (seule écriture encore ouverte, l'ancienne zeste_save_mine
--  refuse déjà tout) REFUSE tout enregistrement dont la liste des prêts diffère de celle du serveur.
--   - nouveau Zeste : ne touche jamais aux prêts → accepté (tâches, courses, films inchangés) ;
--   - ancien Zeste qui modifie un prêt → refusé. Le message commence par « Remboursement refusé » :
--     c'est celui que l'ancienne version affiche à l'écran ; elle garde sa version dans ⚙️ Réglages →
--     Copies de secours, puis se réaligne sur le serveur. Rien n'est perdu en silence.
--  Le reste de la fonction est STRICTEMENT la définition en production au 19/11/2026
--  (sauvegarde ~/sauvegardes/zeste-20261119-195125/fonctions.sql). Idempotent.
--  Retour arrière : sql/zeste-prets-figes-retour.sql.
-- ============================================================
begin;

create or replace function public.zeste_save_mine_v2(p_data jsonb, p_base_rev bigint)
returns bigint language plpgsql security definer set search_path to 'zeste', 'public' as $function$
declare cur bigint; prets jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  perform zeste.verif_remboursements(p_data);
  select rev, data->'debts' into cur, prets from zeste.user_data where user_id = auth.uid() for update;
  if not found then
    if p_base_rev is not null then
      raise exception 'Conflit de synchronisation : aucune donnée sur le serveur (version % attendue)', p_base_rev;
    end if;
    -- compte neuf : aucun prêt dans Zeste (ils se notent dans VALORA)
    if jsonb_typeof(p_data->'debts') = 'array' and jsonb_array_length(p_data->'debts') > 0 then
      raise exception 'Remboursement refusé : les prêts sont maintenant dans l''appli VALORA. Rien n''a été enregistré.';
    end if;
    insert into zeste.user_data(user_id, data, updated_at, rev, v2_only) values (auth.uid(), p_data, now(), 1, true);
    return 1;
  end if;
  if p_base_rev is distinct from cur then
    raise exception 'Conflit de synchronisation : version % attendue, % sur le serveur', p_base_rev, cur;
  end if;
  -- prêts figés : copie conservée telle quelle, toute modification est refusée
  if coalesce(p_data->'debts', '[]'::jsonb) is distinct from coalesce(prets, '[]'::jsonb) then
    raise exception 'Remboursement refusé : les prêts sont maintenant dans l''appli VALORA (rien n''a été enregistré). Ferme complètement Zeste et rouvre-le pour avoir la nouvelle version.';
  end if;
  update zeste.user_data set data = p_data, updated_at = now(), rev = cur + 1, v2_only = true where user_id = auth.uid();
  return cur + 1;
end;
$function$;

commit;

-- Vérification : select pg_get_functiondef('public.zeste_save_mine_v2(jsonb,bigint)'::regprocedure) ~ 'VALORA';  → t
-- (create or replace garde le propriétaire et les droits existants : authenticated et service_role)
