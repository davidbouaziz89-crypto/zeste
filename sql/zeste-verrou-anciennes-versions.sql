-- ============================================================
--  Zeste 🍋 — VERROUILLAGE DES ANCIENNES VERSIONS (neutralise l'ancien canal temps réel)
--
--  ⚠️ PRÉPARÉ, NON APPLIQUÉ. Nécessite sql/zeste-sync-v2.sql (zeste_save_mine_v2, colonne v2_only).
--     Ordre retenu (MISE-EN-LIGNE.md) : juste après les migrations et JUSTE AVANT la publication
--     de la nouvelle appli, pour que l'exposition s'arrête immédiatement. Accord de David requis.
--
--  Pourquoi : TOUTES les versions publiées du 05/08 au 01/10/2026 (28 versions de index.html,
--  vérifiées une à une) diffusent l'état COMPLET du compte sur le canal public
--  « zeste-user-<uid> », et uniquement par un seul appel à send(), placé JUSTE APRÈS un
--  zeste_save_mine RÉUSSI (en cas d'erreur : return avant l'envoi). Elles appliquent aussi ce
--  qu'elles reçoivent sur ce canal, puis l'enregistrent à la modification suivante.
--
--  Effet :
--   1. zeste_save_mine (l'enregistrement de TOUTES les anciennes versions, y compris le correctif
--      du 02/11) refuse désormais TOUT, pour tous les comptes — même un compte qui n'aurait encore
--      aucune ligne (un drapeau par compte ne suffisait pas : un compte créé depuis une ancienne
--      version aurait encore pu enregistrer, donc diffuser). Une ancienne version ne peut donc
--      plus rien publier de nouveau sur le canal, et un état falsifié reçu par ce canal ne peut
--      plus être enregistré sur le serveur.
--      Le message commence par « Remboursement refusé » : c'est le seul que la dernière ancienne
--      version (01/10) affiche ; les plus anciennes échouent en silence (rien n'est enregistré).
--   2. Drapeau v2_only posé sur chaque compte, et par défaut pour les comptes futurs (cohérence).
--  La nouvelle appli (zeste_save_mine_v2) n'est pas concernée. Aucune donnée modifiée.
--
--  Ce que le verrou NE fait PAS (risque résiduel, MISE-EN-LIGNE.md) : une ancienne instance
--  restée ouverte écoute toujours le canal public ; quelqu'un qui connaîtrait l'identifiant interne
--  du compte pourrait y afficher un faux état SUR CET APPAREIL seulement (rien n'est enregistré,
--  rien ne fuit) jusqu'à ce qu'il soit fermé.
--
--  Retour arrière : sql/zeste-verrou-anciennes-versions-retour.sql — ⛔ ROUVRE l'exposition.
--  Pour revenir à l'appli d'avant SANS le défaire : publier la branche `retour-securise`.
-- ============================================================
begin;

update zeste.user_data set v2_only = true where not v2_only;
alter table zeste.user_data alter column v2_only set default true;

create or replace function public.zeste_save_mine(p_data jsonb)
returns void language plpgsql security definer set search_path = zeste, public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  raise exception 'Remboursement refusé : version de Zeste périmée sur cet appareil. Ferme complètement l''appli et rouvre-la (rien n''a été enregistré).';
end;
$$;

commit;

-- Vérification après application (doit renvoyer 0 et true) :
--   select count(*) from zeste.user_data where not v2_only;
--   select prosrc not like '%insert%' from pg_proc where oid = 'public.zeste_save_mine(jsonb)'::regprocedure;
