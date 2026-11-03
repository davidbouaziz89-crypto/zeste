-- ============================================================
--  Zeste 🍋 — RETOUR ARRIÈRE du verrouillage des anciennes versions
--
--  ⛔ ROUVRE L'EXPOSITION : les anciennes versions encore ouvertes pourront de nouveau enregistrer,
--     donc diffuser l'état complet du compte sur le canal public « zeste-user-<uid> ».
--     À n'utiliser que sur décision écrite de David, en dernier recours. Pour revenir à l'appli
--     d'avant SANS rouvrir l'exposition : publier la branche `retour-securise` (synchro v2, sans canal).
--
--  Remet exactement zeste_save_mine telle que posée par sql/zeste-sync-v2.sql (refus seulement
--  pour un compte déjà passé à la nouvelle appli) et le défaut false. Les drapeaux déjà posés
--  restent (sinon toutes les anciennes versions repasseraient d'un coup).
-- ============================================================
begin;

alter table zeste.user_data alter column v2_only set default false;

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

commit;
