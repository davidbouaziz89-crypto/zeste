-- ============================================================
--  Zeste 🍋 — Onglet « Or » : pièces d'or (achats, ventes, cours)
--
--  ⚠️ NON APPLIQUÉ en production. À exécuter seulement après accord de David.
--
--  Pourquoi des tables dédiées et pas le blob zeste.user_data :
--   - le blob est renvoyé en entier sur le canal Realtime « zeste-user-<uid> »
--     (broadcast public) : un patrimoine n'a rien à y faire ;
--   - le blob est en « dernier qui écrit gagne » : une vente saisie sur le
--     téléphone pourrait être écrasée par l'ordinateur ;
--   - ici chaque opération est contrôlée par le serveur (quantités vendues,
--     dates, montants) sous verrou de ligne.
--
--  Sécurité : RLS activée SANS aucune policy (accès direct impossible, comme
--  zeste.spaces). Tout passe par des fonctions security definer filtrées sur
--  auth.uid(). Le cours de l'or (donnée publique de marché) n'est écrit que
--  par l'edge function zeste-or-cours (rôle service_role).
--
--  Idempotent : peut être rejoué sans risque.
-- ============================================================

create schema if not exists zeste;

-- ---------- Fiches des pièces connues (référence unique côté serveur) ----------
-- saisie_libre = true : les poids sont saisis par l'utilisateur (Louis d'or
-- d'un autre type, pièce personnalisée). Pour les autres, le serveur IMPOSE
-- les poids de la fiche, quoi que le navigateur envoie.
create table if not exists zeste.or_types (
  code            text primary key,
  nom             text not null,
  poids_brut_g    numeric(9,4),
  titre_millieme  numeric(6,2),
  poids_fin_g     numeric(9,4),
  saisie_libre    boolean not null default false,
  ordre           smallint not null default 0
);
alter table zeste.or_types enable row level security;

insert into zeste.or_types (code, nom, poids_brut_g, titre_millieme, poids_fin_g, saisie_libre, ordre) values
  ('napoleon20',   'Napoléon 20 francs',                         6.4516, 900.00, 5.8064, false, 10),
  ('francs10',     '10 francs or',                               3.2258, 900.00, 2.9032, false, 20),
  ('marianne_coq', 'Marianne Coq 20 francs',                     6.4516, 900.00, 5.8064, false, 30),
  ('louis_xvi',    'Louis d''or Louis XVI au buste (1785-1792)', 7.6490, 917.00, 7.0141, false, 40),
  ('louis_autre',  'Louis d''or historique — autre type',        null,   null,   null,   true,  45),
  ('souverain',    'Souverain britannique',                      7.9881, 916.67, 7.3224, false, 50),
  ('vreneli20',    '20 francs suisse (Vreneli)',                 6.4516, 900.00, 5.8064, false, 60),
  ('autre',        'Autre pièce',                                null,   null,   null,   true,  90)
on conflict (code) do update set
  nom = excluded.nom, poids_brut_g = excluded.poids_brut_g, titre_millieme = excluded.titre_millieme,
  poids_fin_g = excluded.poids_fin_g, saisie_libre = excluded.saisie_libre, ordre = excluded.ordre;

-- ---------- Achats (un lot = un achat, conservé même après revente) ----------
create table if not exists zeste.or_lots (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  type            text not null references zeste.or_types(code),
  nom             text,                         -- nom libre (pièce personnalisée, précision)
  millesime       int,
  date_achat      date not null,
  quantite        int  not null,
  prix_total      numeric(12,2) not null,       -- prix payé pour les pièces, hors frais
  frais           numeric(12,2) not null default 0,
  poids_brut_g    numeric(9,4),
  titre_millieme  numeric(6,2),
  poids_fin_g     numeric(9,4) not null,        -- or fin PAR PIÈCE retenu pour ce lot
  vendeur         text,
  commentaire     text,
  cree_le         timestamptz not null default now(),
  modifie_le      timestamptz not null default now(),
  constraint or_lots_quantite  check (quantite between 1 and 100000),
  constraint or_lots_prix      check (prix_total >= 0 and frais >= 0),
  constraint or_lots_poids     check (poids_fin_g > 0 and poids_fin_g <= 1000),
  constraint or_lots_titre     check (titre_millieme is null or titre_millieme between 1 and 1000),
  constraint or_lots_millesime check (millesime is null or millesime between 1200 and 2200),
  constraint or_lots_textes    check (coalesce(length(nom),0) <= 80 and coalesce(length(vendeur),0) <= 120
                                      and coalesce(length(commentaire),0) <= 1000)
);
create index if not exists or_lots_user on zeste.or_lots(user_id);
alter table zeste.or_lots enable row level security;

-- ---------- Ventes (partielles ou totales, rattachées à un lot) ----------
create table if not exists zeste.or_ventes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  lot_id          uuid not null references zeste.or_lots(id) on delete cascade,
  date_vente      date not null,
  quantite        int  not null,
  prix_total      numeric(12,2) not null,       -- montant reçu pour les pièces vendues, hors frais
  frais           numeric(12,2) not null default 0,
  commentaire     text,
  cree_le         timestamptz not null default now(),
  modifie_le      timestamptz not null default now(),
  constraint or_ventes_quantite check (quantite between 1 and 100000),
  constraint or_ventes_prix     check (prix_total >= 0 and frais >= 0),
  constraint or_ventes_textes   check (coalesce(length(commentaire),0) <= 1000)
);
create index if not exists or_ventes_lot  on zeste.or_ventes(lot_id);
create index if not exists or_ventes_user on zeste.or_ventes(user_id);
alter table zeste.or_ventes enable row level security;

-- ---------- Photo facultative d'un lot (JPEG compressé dans le navigateur) ----------
create table if not exists zeste.or_photos (
  lot_id   uuid primary key references zeste.or_lots(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  image    text not null,
  cree_le  timestamptz not null default now(),
  constraint or_photos_format check (image like 'data:image/jpeg;base64,%' and length(image) <= 600000)
);
alter table zeste.or_photos enable row level security;

-- ---------- Cours de l'or (donnée publique, écrite par l'edge function) ----------
create table if not exists zeste.or_cours_jour (
  jour    date primary key,
  eur_g   numeric(12,4) not null check (eur_g > 0),
  source  text not null,
  maj     timestamptz not null default now()
);
alter table zeste.or_cours_jour enable row level security;

create table if not exists zeste.or_cours_actuel (
  id         smallint primary key default 1 check (id = 1),
  eur_g      numeric(12,4) not null check (eur_g > 0),
  source     text not null,
  cote_le    timestamptz not null,               -- horodatage donné par le fournisseur
  releve_le  timestamptz not null default now()  -- moment où le serveur l'a récupéré
);
alter table zeste.or_cours_actuel enable row level security;

-- repères du rattrapage d'historique (ex. « histo_vide_avant » : le fournisseur
-- n'a rien avant cette date, inutile de redemander ; « histo_verifie_le »)
create table if not exists zeste.or_cours_meta (
  cle     text primary key,
  valeur  text not null,
  maj     timestamptz not null default now()
);
alter table zeste.or_cours_meta enable row level security;

-- journal des appels au fournisseur : sert à respecter le quota gratuit
create table if not exists zeste.or_appels_api (
  id          bigserial primary key,
  le          timestamptz not null default now(),
  fournisseur text not null,
  nature      text not null,
  ok          boolean not null,
  detail      text
);
create index if not exists or_appels_api_le on zeste.or_appels_api(le);
alter table zeste.or_appels_api enable row level security;

revoke all on zeste.or_types, zeste.or_lots, zeste.or_ventes, zeste.or_photos,
  zeste.or_cours_jour, zeste.or_cours_actuel, zeste.or_cours_meta, zeste.or_appels_api from public;
do $$ begin
  execute 'revoke all on zeste.or_types, zeste.or_lots, zeste.or_ventes, zeste.or_photos, zeste.or_cours_jour, zeste.or_cours_actuel, zeste.or_cours_meta, zeste.or_appels_api from anon, authenticated';
exception when undefined_object then null; end $$;

-- ============================================================
--  Contrôles communs
-- ============================================================
create or replace function zeste.or_montant(p jsonb, cle text, libelle text, obligatoire boolean)
returns numeric language plpgsql immutable set search_path = zeste, public as $$
declare a numeric;
begin
  if p->cle is null or jsonb_typeof(p->cle) = 'null' then
    if obligatoire then raise exception 'Or : % manquant', libelle; end if;
    return 0;
  end if;
  if jsonb_typeof(p->cle) <> 'number' then raise exception 'Or : % invalide', libelle; end if;
  a := (p->>cle)::numeric;
  if a < 0 then raise exception 'Or : % ne peut pas être négatif', libelle; end if;
  if a <> round(a, 2) then raise exception 'Or : % — 2 décimales au maximum', libelle; end if;
  if a > 10000000 then raise exception 'Or : % trop élevé', libelle; end if;
  return a;
end $$;

create or replace function zeste.or_entier(p jsonb, cle text, libelle text, mini int, maxi int)
returns int language plpgsql immutable set search_path = zeste, public as $$
declare a numeric;
begin
  if jsonb_typeof(p->cle) is distinct from 'number' then raise exception 'Or : % manquante ou invalide', libelle; end if;
  a := (p->>cle)::numeric;
  if a <> trunc(a) then raise exception 'Or : % doit être un nombre entier', libelle; end if;
  if a < mini or a > maxi then raise exception 'Or : % hors limites (% à %)', libelle, mini, maxi; end if;
  return a::int;
end $$;

-- date AAAA-MM-JJ, jamais dans le futur (heure de Paris)
create or replace function zeste.or_date(p jsonb, cle text, libelle text)
returns date language plpgsql stable set search_path = zeste, public as $$
declare d date;
begin
  if coalesce(p->>cle, '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Or : % manquante ou invalide', libelle; end if;
  begin d := (p->>cle)::date;
  exception when others then raise exception 'Or : % invalide (%)', libelle, p->>cle; end;
  if d < date '1900-01-01' then raise exception 'Or : % trop ancienne', libelle; end if;
  if d > (now() at time zone 'Europe/Paris')::date then raise exception 'Or : % dans le futur', libelle; end if;
  return d;
end $$;

create or replace function zeste.or_texte(p jsonb, cle text, maxi int)
returns text language sql immutable set search_path = zeste, public as $$
  select nullif(left(btrim(coalesce(p->>cle, '')), maxi), '')
$$;

create or replace function zeste.or_lot_json(l zeste.or_lots)
returns jsonb language sql stable set search_path = zeste, public as $$
  select (to_jsonb(l) - 'user_id')
    || jsonb_build_object('a_photo', exists(select 1 from zeste.or_photos p where p.lot_id = l.id))
$$;

-- ============================================================
--  Lecture du portefeuille de l'utilisateur connecté
-- ============================================================
create or replace function public.zeste_or_lire()
returns jsonb language plpgsql stable security definer set search_path = zeste, public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Or : connexion requise'; end if;
  return jsonb_build_object(
    'lots',   coalesce((select jsonb_agg(zeste.or_lot_json(l) order by l.date_achat, l.cree_le)
                        from zeste.or_lots l where l.user_id = u), '[]'::jsonb),
    'ventes', coalesce((select jsonb_agg(to_jsonb(v) - 'user_id' order by v.date_vente, v.cree_le)
                        from zeste.or_ventes v where v.user_id = u), '[]'::jsonb),
    'types',  (select jsonb_agg(to_jsonb(t) order by t.ordre) from zeste.or_types t)
  );
end $$;

-- ============================================================
--  Achat : création (id inconnu) ou modification (id existant)
--  L'id peut venir du navigateur : un double appui ne crée pas de doublon.
-- ============================================================
create or replace function public.zeste_or_lot_enregistrer(p jsonb)
returns jsonb language plpgsql security definer set search_path = zeste, public as $$
declare
  u uuid := auth.uid();
  v_id uuid; t zeste.or_types; ex zeste.or_lots; r zeste.or_lots;
  v_q int; v_prix numeric; v_frais numeric; v_date date; v_mil int;
  v_brut numeric; v_titre numeric; v_fin numeric; v_nom text;
  v_vendu int; v_premiere date;
begin
  if u is null then raise exception 'Or : connexion requise'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Or : données invalides'; end if;

  if coalesce(p->>'id', '') = '' then v_id := gen_random_uuid();
  else
    begin v_id := (p->>'id')::uuid;
    exception when others then raise exception 'Or : identifiant invalide'; end;
  end if;

  select * into t from zeste.or_types where code = p->>'type';
  if not found then raise exception 'Or : type de pièce inconnu'; end if;

  v_q     := zeste.or_entier(p, 'quantite', 'quantité', 1, 100000);
  v_prix  := zeste.or_montant(p, 'prix_total', 'prix d''achat', true);
  v_frais := zeste.or_montant(p, 'frais', 'frais d''achat', false);
  v_date  := zeste.or_date(p, 'date_achat', 'date d''achat');
  v_nom   := zeste.or_texte(p, 'nom', 80);
  v_mil   := null;
  if p->'millesime' is not null and jsonb_typeof(p->'millesime') <> 'null' then
    v_mil := zeste.or_entier(p, 'millesime', 'millésime', 1200, extract(year from now())::int);
  end if;

  if t.saisie_libre then
    -- poids saisis : or fin direct, ou poids brut × titre
    if t.code = 'autre' and v_nom is null then raise exception 'Or : indique le nom de la pièce'; end if;
    v_brut  := case when jsonb_typeof(p->'poids_brut_g') = 'number' then (p->>'poids_brut_g')::numeric end;
    v_titre := case when jsonb_typeof(p->'titre_millieme') = 'number' then (p->>'titre_millieme')::numeric end;
    v_fin   := case when jsonb_typeof(p->'poids_fin_g') = 'number' then (p->>'poids_fin_g')::numeric end;
    if v_brut is not null and (v_brut <= 0 or v_brut > 1000) then raise exception 'Or : poids brut invalide'; end if;
    if v_titre is not null and (v_titre <= 0 or v_titre > 1000) then raise exception 'Or : titre invalide (en millièmes, 1 à 1000)'; end if;
    if v_fin is null and v_brut is not null and v_titre is not null then v_fin := round(v_brut * v_titre / 1000, 4); end if;
    if v_fin is null or v_fin <= 0 or v_fin > 1000 then
      raise exception 'Or : indique le poids d''or fin, ou le poids brut et le titre';
    end if;
    if v_brut is not null and v_fin > v_brut then raise exception 'Or : l''or fin ne peut pas dépasser le poids brut'; end if;
    v_fin := round(v_fin, 4);
  else
    v_brut := t.poids_brut_g; v_titre := t.titre_millieme; v_fin := t.poids_fin_g;
  end if;

  select * into ex from zeste.or_lots where id = v_id for update;
  if found then
    if ex.user_id <> u then raise exception 'Or : achat introuvable'; end if;
    select coalesce(sum(quantite), 0), min(date_vente) into v_vendu, v_premiere
      from zeste.or_ventes where lot_id = v_id;
    if v_q < v_vendu then
      raise exception 'Or : quantité (%) inférieure aux % pièce(s) déjà vendue(s)', v_q, v_vendu;
    end if;
    if v_premiere is not null and v_date > v_premiere then
      raise exception 'Or : la date d''achat ne peut pas être après une vente (%)', to_char(v_premiere, 'DD/MM/YYYY');
    end if;
    update zeste.or_lots set
      type = t.code, nom = v_nom, millesime = v_mil, date_achat = v_date, quantite = v_q,
      prix_total = v_prix, frais = v_frais, poids_brut_g = v_brut, titre_millieme = v_titre,
      poids_fin_g = v_fin, vendeur = zeste.or_texte(p, 'vendeur', 120),
      commentaire = zeste.or_texte(p, 'commentaire', 1000), modifie_le = now()
    where id = v_id returning * into r;
  else
    insert into zeste.or_lots (id, user_id, type, nom, millesime, date_achat, quantite, prix_total, frais,
      poids_brut_g, titre_millieme, poids_fin_g, vendeur, commentaire)
    values (v_id, u, t.code, v_nom, v_mil, v_date, v_q, v_prix, v_frais, v_brut, v_titre, v_fin,
      zeste.or_texte(p, 'vendeur', 120), zeste.or_texte(p, 'commentaire', 1000))
    returning * into r;
  end if;
  return zeste.or_lot_json(r);
end $$;

-- Suppression d'un achat. S'il a des ventes, il faut le confirmer explicitement
-- (p_avec_ventes = true) : les ventes rattachées sont alors supprimées aussi.
create or replace function public.zeste_or_lot_supprimer(p_id uuid, p_avec_ventes boolean default false)
returns void language plpgsql security definer set search_path = zeste, public as $$
declare u uuid := auth.uid(); n int;
begin
  if u is null then raise exception 'Or : connexion requise'; end if;
  perform 1 from zeste.or_lots where id = p_id and user_id = u for update;
  if not found then raise exception 'Or : achat introuvable'; end if;
  select count(*) into n from zeste.or_ventes where lot_id = p_id;
  if n > 0 and not coalesce(p_avec_ventes, false) then
    raise exception 'Or : cet achat a % vente(s) enregistrée(s)', n;
  end if;
  delete from zeste.or_lots where id = p_id and user_id = u;
end $$;

-- ============================================================
--  Vente : création ou modification, contrôlée sous verrou du lot
-- ============================================================
create or replace function public.zeste_or_vente_enregistrer(p jsonb)
returns jsonb language plpgsql security definer set search_path = zeste, public as $$
declare
  u uuid := auth.uid();
  v_id uuid; v_lot uuid; l zeste.or_lots; ex zeste.or_ventes; r zeste.or_ventes;
  v_q int; v_prix numeric; v_frais numeric; v_date date; v_autres int;
begin
  if u is null then raise exception 'Or : connexion requise'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'Or : données invalides'; end if;
  begin
    v_id  := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
    v_lot := (p->>'lot_id')::uuid;
  exception when others then raise exception 'Or : identifiant invalide'; end;
  if v_lot is null then raise exception 'Or : achat à revendre manquant'; end if;

  select * into l from zeste.or_lots where id = v_lot and user_id = u for update;
  if not found then raise exception 'Or : achat introuvable'; end if;

  v_q     := zeste.or_entier(p, 'quantite', 'quantité vendue', 1, 100000);
  v_prix  := zeste.or_montant(p, 'prix_total', 'prix de vente', true);
  v_frais := zeste.or_montant(p, 'frais', 'frais de vente', false);
  v_date  := zeste.or_date(p, 'date_vente', 'date de vente');
  if v_date < l.date_achat then
    raise exception 'Or : la vente ne peut pas précéder l''achat (%)', to_char(l.date_achat, 'DD/MM/YYYY');
  end if;

  select * into ex from zeste.or_ventes where id = v_id for update;
  if found and (ex.user_id <> u or ex.lot_id <> v_lot) then raise exception 'Or : vente introuvable'; end if;

  select coalesce(sum(quantite), 0) into v_autres from zeste.or_ventes where lot_id = v_lot and id <> v_id;
  if v_autres + v_q > l.quantite then
    raise exception 'Or : il ne reste que % pièce(s) dans cet achat', l.quantite - v_autres;
  end if;

  if ex.id is not null then
    update zeste.or_ventes set date_vente = v_date, quantite = v_q, prix_total = v_prix, frais = v_frais,
      commentaire = zeste.or_texte(p, 'commentaire', 1000), modifie_le = now()
    where id = v_id returning * into r;
  else
    insert into zeste.or_ventes (id, user_id, lot_id, date_vente, quantite, prix_total, frais, commentaire)
    values (v_id, u, v_lot, v_date, v_q, v_prix, v_frais, zeste.or_texte(p, 'commentaire', 1000))
    returning * into r;
  end if;
  return to_jsonb(r) - 'user_id';
end $$;

create or replace function public.zeste_or_vente_supprimer(p_id uuid)
returns void language plpgsql security definer set search_path = zeste, public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Or : connexion requise'; end if;
  delete from zeste.or_ventes where id = p_id and user_id = u;
  if not found then raise exception 'Or : vente introuvable'; end if;
end $$;

-- ============================================================
--  Photo d'un lot (lue à la demande, jamais avec la liste)
-- ============================================================
create or replace function public.zeste_or_photo_lire(p_lot uuid)
returns text language plpgsql stable security definer set search_path = zeste, public as $$
declare u uuid := auth.uid(); img text;
begin
  if u is null then raise exception 'Or : connexion requise'; end if;
  select image into img from zeste.or_photos where lot_id = p_lot and user_id = u;
  return img;
end $$;

create or replace function public.zeste_or_photo_enregistrer(p_lot uuid, p_image text)
returns void language plpgsql security definer set search_path = zeste, public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Or : connexion requise'; end if;
  perform 1 from zeste.or_lots where id = p_lot and user_id = u for update;
  if not found then raise exception 'Or : achat introuvable'; end if;
  if p_image is null then delete from zeste.or_photos where lot_id = p_lot; return; end if;
  if p_image not like 'data:image/jpeg;base64,%' or length(p_image) > 600000 then
    raise exception 'Or : photo refusée (JPEG de 450 Ko maximum)';
  end if;
  insert into zeste.or_photos (lot_id, user_id, image) values (p_lot, u, p_image)
  on conflict (lot_id) do update set image = excluded.image, cree_le = now();
end $$;

-- ============================================================
--  Cours de l'or
-- ============================================================
-- Lecture (utilisateur connecté) : dernier cours + historique quotidien.
-- Sert aussi de secours si l'edge function est indisponible.
create or replace function public.zeste_or_cours_lire(p_depuis date default null)
returns jsonb language plpgsql stable security definer set search_path = zeste, public as $$
declare u uuid := auth.uid(); d date;
begin
  if u is null then raise exception 'Or : connexion requise'; end if;
  d := greatest(coalesce(p_depuis, current_date - 400), date '1900-01-01');
  return jsonb_build_object(
    'actuel', (select jsonb_build_object('eur_g', eur_g, 'source', source, 'cote_le', cote_le, 'releve_le', releve_le)
               from zeste.or_cours_actuel where id = 1),
    'historique', coalesce((select jsonb_agg(jsonb_build_array(jour, eur_g) order by jour)
                            from zeste.or_cours_jour where jour >= d), '[]'::jsonb),
    'premier_jour', (select min(jour) from zeste.or_cours_jour)
  );
end $$;

-- État pour l'edge function (service_role uniquement)
create or replace function public.zeste_or_cours_etat(p_fournisseur text)
returns jsonb language sql stable security definer set search_path = zeste, public as $$
  select jsonb_build_object(
    'actuel', (select jsonb_build_object('eur_g', eur_g, 'source', source, 'cote_le', cote_le, 'releve_le', releve_le)
               from zeste.or_cours_actuel where id = 1),
    'premier_jour', (select min(jour) from zeste.or_cours_jour),
    'dernier_jour', (select max(jour) from zeste.or_cours_jour),
    'appels_mois', (select count(*) from zeste.or_appels_api
                    where fournisseur = p_fournisseur
                      and le >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC'),
    'dernier_echec', (select max(le) from zeste.or_appels_api where fournisseur = p_fournisseur and not ok),
    'meta', coalesce((select jsonb_object_agg(cle, valeur) from zeste.or_cours_meta), '{}'::jsonb)
  )
$$;

-- Écriture par l'edge function (service_role uniquement) :
-- p = { fournisseur, nature, ok, detail, actuel:{eur_g, source, cote_le}?,
--       jours:[{jour, eur_g, source}]?, meta:{cle: valeur}?, sans_appel? }
-- sans_appel = true : simple mise à jour des repères, pas un appel au fournisseur
create or replace function public.zeste_or_cours_maj(p jsonb)
returns void language plpgsql security definer set search_path = zeste, public as $$
declare j jsonb; k text;
begin
  if not coalesce((p->>'sans_appel')::boolean, false) then
    insert into zeste.or_appels_api (fournisseur, nature, ok, detail)
    values (coalesce(p->>'fournisseur', '?'), coalesce(p->>'nature', '?'), coalesce((p->>'ok')::boolean, false),
            left(p->>'detail', 500));
  end if;
  if jsonb_typeof(p->'meta') = 'object' then
    for k in select jsonb_object_keys(p->'meta') loop
      insert into zeste.or_cours_meta (cle, valeur, maj) values (k, p->'meta'->>k, now())
      on conflict (cle) do update set valeur = excluded.valeur, maj = now();
    end loop;
  end if;
  if jsonb_typeof(p->'actuel') = 'object' and ((p->'actuel'->>'eur_g')::numeric) > 0 then
    insert into zeste.or_cours_actuel (id, eur_g, source, cote_le, releve_le)
    values (1, round((p->'actuel'->>'eur_g')::numeric, 4), p->'actuel'->>'source',
            (p->'actuel'->>'cote_le')::timestamptz, now())
    on conflict (id) do update set eur_g = excluded.eur_g, source = excluded.source,
      cote_le = excluded.cote_le, releve_le = excluded.releve_le;
  end if;
  if jsonb_typeof(p->'jours') = 'array' then
    for j in select value from jsonb_array_elements(p->'jours') loop
      if (j->>'eur_g')::numeric > 0 then
        insert into zeste.or_cours_jour (jour, eur_g, source, maj)
        values ((j->>'jour')::date, round((j->>'eur_g')::numeric, 4), j->>'source', now())
        on conflict (jour) do update set eur_g = excluded.eur_g, source = excluded.source, maj = now();
      end if;
    end loop;
  end if;
end $$;

-- ============================================================
--  Droits : rien pour anon ; utilisateurs connectés = leurs données ;
--  écriture du cours = service_role seulement.
-- ============================================================
do $$
declare f text;
begin
  foreach f in array array[
    'zeste.or_montant(jsonb,text,text,boolean)', 'zeste.or_entier(jsonb,text,text,integer,integer)',
    'zeste.or_date(jsonb,text,text)', 'zeste.or_texte(jsonb,text,integer)', 'zeste.or_lot_json(zeste.or_lots)',
    'public.zeste_or_lire()', 'public.zeste_or_lot_enregistrer(jsonb)', 'public.zeste_or_lot_supprimer(uuid,boolean)',
    'public.zeste_or_vente_enregistrer(jsonb)', 'public.zeste_or_vente_supprimer(uuid)',
    'public.zeste_or_photo_lire(uuid)', 'public.zeste_or_photo_enregistrer(uuid,text)',
    'public.zeste_or_cours_lire(date)', 'public.zeste_or_cours_etat(text)', 'public.zeste_or_cours_maj(jsonb)'
  ] loop
    execute format('revoke all on function %s from public', f);
    begin
      execute format('revoke all on function %s from anon, authenticated, service_role', f);
    exception when undefined_object then null; end;
  end loop;
end $$;

do $$ begin
  grant execute on function public.zeste_or_lire()                         to authenticated;
  grant execute on function public.zeste_or_lot_enregistrer(jsonb)         to authenticated;
  grant execute on function public.zeste_or_lot_supprimer(uuid,boolean)    to authenticated;
  grant execute on function public.zeste_or_vente_enregistrer(jsonb)       to authenticated;
  grant execute on function public.zeste_or_vente_supprimer(uuid)          to authenticated;
  grant execute on function public.zeste_or_photo_lire(uuid)               to authenticated;
  grant execute on function public.zeste_or_photo_enregistrer(uuid,text)   to authenticated;
  grant execute on function public.zeste_or_cours_lire(date)               to authenticated;
  grant execute on function public.zeste_or_cours_etat(text)               to service_role;
  grant execute on function public.zeste_or_cours_maj(jsonb)               to service_role;
exception when undefined_object then null; end $$;
