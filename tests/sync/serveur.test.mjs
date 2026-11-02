// Synchro v2 + fermeture des accès (sql/zeste-sync-v2.sql, sql/zeste-securite.sql), sur base locale jetable.
// Migration rejouée sur des données « comme en production » (avant / après, retours arrière).
// Lancer : PGLITE_DIR=<dossier pglite> node --test tests/sync/serveur.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { nouvelleBase, creerUtilisateur, rpc, comme, lireSql, DEJA_EN_PROD, AVANT_CORRECTIF, A_APPLIQUER } from '../or/pg-local.mjs';

const A = 'aaaaaaaa-1111-4111-8111-111111111111';
const B = 'bbbbbbbb-2222-4222-8222-222222222222';
const asA = { uid: A }, asB = { uid: B }, anon = { role: 'anon' };
const refuse = async (p, motif) => assert.rejects(p, e => { assert.match(String(e.message), motif); return true; });
const etat = (n) => ({ todos: [{ id: 't1', txt: 'Tâche ' + n }], shop: [], films: [{ id: 'f1', txt: 'Film' }],
  debts: [{ id: 'd1', who: 'Léa', kind: 'money', amount: 100, cur: 'EUR', repays: [{ id: 'r1', amount: 30, date: '2026-10-01' }] }] });

test('migration sur des données existantes : rien perdu, rejouable, retour arrière', async () => {
  const db = await nouvelleBase(DEJA_EN_PROD);           // état de la production aujourd'hui
  await creerUtilisateur(db, A, 'a@t');
  await rpc(db, 'zeste_save_mine', { p_data: etat('avant') }, asA);
  const h0 = (await db.query(`select md5(data::text) h from zeste.user_data`)).rows[0].h;
  for (const f of A_APPLIQUER) await db.exec(lireSql(f));
  for (const f of A_APPLIQUER) await db.exec(lireSql(f)); // deux fois : idempotent
  const r = (await db.query(`select md5(data::text) h, rev, v2_only from zeste.user_data`)).rows[0];
  assert.equal(r.h, h0);                                   // données intactes
  assert.equal(r.v2_only, false);                          // anciennes versions encore acceptées tant qu'aucun appareil à jour n'a écrit
  const lu = await rpc(db, 'zeste_load_mine_v2', {}, asA);
  assert.equal(lu.data.todos[0].txt, 'Tâche avant');
  // retours arrière (ordre inverse), données toujours intactes
  await db.exec(lireSql('zeste-securite-retour.sql'));
  await db.exec(lireSql('zeste-sync-v2-retour.sql'));
  assert.equal((await db.query(`select md5(data::text) h from zeste.user_data`)).rows[0].h, h0);
  assert.equal((await db.query(`select to_regprocedure('public.zeste_save_mine_v2(jsonb,bigint)') is null as ok`)).rows[0].ok, true);
  await rpc(db, 'zeste_save_mine', { p_data: etat('après retour') }, asA); // l'ancienne appli remarche
});

let db;
test.before(async () => {
  db = await nouvelleBase();
  await creerUtilisateur(db, A, 'a@t'); await creerUtilisateur(db, B, 'b@t');
});

test('anon : plus aucune fonction Zeste exécutable', async () => {
  const r = await db.query(`select p.oid::regprocedure::text f from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'zeste%' and has_function_privilege('anon', p.oid, 'execute')`);
  assert.deepEqual(r.rows.map(x => x.f), []);
  await refuse(rpc(db, 'zeste_sync_reminders', { p_household: A, p_items: [] }, anon), /permission denied/);
  await refuse(rpc(db, 'zeste_load_mine', {}, anon), /permission denied/);
});

test('« code foyer » fermé, données conservées', async () => {
  await db.query(`insert into zeste.spaces(id, data) values ('cccccccc-3333-4333-8333-333333333333', '{"todos":[]}')`);
  await refuse(rpc(db, 'zeste_load', { p_id: 'cccccccc-3333-4333-8333-333333333333' }, asA), /permission denied/);
  await refuse(rpc(db, 'zeste_save', { p_id: 'cccccccc-3333-4333-8333-333333333333', p_data: {} }, asA), /permission denied/);
  await refuse(rpc(db, 'zeste_new_space', {}, asA), /permission denied/);
  assert.equal((await db.query(`select count(*)::int n from zeste.spaces`)).rows[0].n, 1);
});

test('rappels push : un compte ne touche jamais ceux d\'un autre', async () => {
  await rpc(db, 'zeste_sync_reminders', { p_household: B, p_items: [{ todo_id: 'x', due_ms: 1, txt: 'Médecin' }] }, asB);
  await refuse(rpc(db, 'zeste_sync_reminders', { p_household: B, p_items: [] }, asA), /Accès refusé/);
  await refuse(rpc(db, 'zeste_save_sub', { p_household: B, p_sub: { endpoint: 'https://pirate' } }, asA), /Accès refusé/);
  await refuse(rpc(db, 'zeste_sync_reminders', { p_household: B, p_items: [] }, { role: 'authenticated' }), /not authenticated/);
  assert.equal((await db.query(`select count(*)::int n from zeste.reminders where household_id = $1`, [B])).rows[0].n, 1);
  assert.equal((await db.query(`select count(*)::int n from zeste.push_subs`)).rows[0].n, 0);
  // l'appel de l'ancienne appli pour SON compte fonctionne toujours ; la nouvelle forme aussi
  await rpc(db, 'zeste_sync_reminders', { p_household: A, p_items: [{ todo_id: 'y', due_ms: 2, txt: 'Courses' }] }, asA);
  await rpc(db, 'zeste_save_sub_mine', { p_sub: { endpoint: 'https://push.apple/a' } }, asA);
  assert.equal((await db.query(`select household_id::text h from zeste.push_subs`)).rows[0].h, A);
});

test('synchro v2 : jamais d\'écrasement silencieux entre deux appareils', async () => {
  const r1 = await rpc(db, 'zeste_save_mine_v2', { p_data: etat('A1'), p_base_rev: null }, asA);
  assert.equal(Number(r1), 1);
  // appareil 1 et appareil 2 partent tous deux de la version 1
  const r2 = await rpc(db, 'zeste_save_mine_v2', { p_data: etat('téléphone'), p_base_rev: 1 }, asA);
  assert.equal(Number(r2), 2);
  await refuse(rpc(db, 'zeste_save_mine_v2', { p_data: etat('ordinateur'), p_base_rev: 1 }, asA), /Conflit de synchronisation/);
  const lu = await rpc(db, 'zeste_load_mine_v2', {}, asA);
  assert.equal(lu.data.todos[0].txt, 'Tâche téléphone');   // la modification du téléphone n'est pas effacée
  assert.equal(Number(lu.rev), 2);
  // l'ancienne version de l'appli ne peut plus écrire ni contourner le numéro de version
  await refuse(rpc(db, 'zeste_save_mine', { p_data: etat('ancienne appli') }, asA), /version de Zeste périmée/);
  // numéro de version seul, par compte
  assert.equal(Number((await rpc(db, 'zeste_rev_mine', {}, asA)).rev), 2);
  assert.equal((await rpc(db, 'zeste_rev_mine', {}, asB)).rev, null);
});

test('remboursements : doublon, dépassement et montants invalides refusés par le serveur', async () => {
  const base = Number((await rpc(db, 'zeste_rev_mine', {}, asA)).rev);
  const avec = (repays) => ({ ...etat('r'), debts: [{ id: 'd1', who: 'Léa', kind: 'money', amount: 100, cur: 'EUR', repays }] });
  // même remboursement envoyé deux fois (double appui) → refusé, rien d'enregistré
  await refuse(rpc(db, 'zeste_save_mine_v2', { p_data: avec([{ id: 'r1', amount: 30, date: '2026-10-01' }, { id: 'r1', amount: 30, date: '2026-10-01' }]), p_base_rev: base }, asA), /double/);
  await refuse(rpc(db, 'zeste_save_mine_v2', { p_data: avec([{ id: 'r1', amount: 130, date: '2026-10-01' }]), p_base_rev: base }, asA), /130/);
  await refuse(rpc(db, 'zeste_save_mine_v2', { p_data: avec([{ id: 'r1', amount: 10.005, date: '2026-10-01' }]), p_base_rev: base }, asA), /2 décimales/);
  await refuse(rpc(db, 'zeste_save_mine_v2', { p_data: avec([{ id: 'r1', amount: 10, date: '01/10/2026' }]), p_base_rev: base }, asA), /date/);
  assert.equal(Number((await rpc(db, 'zeste_rev_mine', {}, asA)).rev), base); // aucune écriture partielle
  // renvoyer exactement le même état après une réponse perdue : un seul remboursement, version suivante
  const ok = avec([{ id: 'r1', amount: 30, date: '2026-10-01' }, { id: 'r2', amount: 70, date: '2026-10-20' }]);
  await rpc(db, 'zeste_save_mine_v2', { p_data: ok, p_base_rev: base }, asA);
  await refuse(rpc(db, 'zeste_save_mine_v2', { p_data: ok, p_base_rev: base }, asA), /Conflit/); // le renvoi aveugle est détecté
  const lu = await rpc(db, 'zeste_load_mine_v2', {}, asA);
  assert.equal(lu.data.debts[0].repays.length, 2);
});

test('les données Or ne passent jamais par le blob synchronisé', async () => {
  await rpc(db, 'zeste_or_lot_enregistrer', { p: { type: 'napoleon20', quantite: 2, date_achat: '2025-01-01', prix_total: 900 } }, asA);
  const lu = await rpc(db, 'zeste_load_mine_v2', {}, asA);
  assert.doesNotMatch(JSON.stringify(lu), /napoleon|or_lots|prix_total/);
  assert.equal((await rpc(db, 'zeste_or_lire', {}, asB)).lots.length, 0);
});

test('ordre inverse (Or avant sécurité) : les droits Or restent corrects', async () => {
  const d2 = await nouvelleBase([...DEJA_EN_PROD, 'zeste-or.sql', 'zeste-sync-v2.sql', 'zeste-securite.sql']);
  await creerUtilisateur(d2, A, 'a@t');
  assert.equal((await rpc(d2, 'zeste_or_lire', {}, asA)).lots.length, 0);
  await refuse(rpc(d2, 'zeste_or_lire', {}, anon), /permission denied/);
  await refuse(rpc(d2, 'zeste_or_cours_maj', { p: {} }, asA), /permission denied/);
});

test('retour arrière de l\'onglet Or : accès coupé, données conservées, réactivable', async () => {
  const d3 = await nouvelleBase();
  await creerUtilisateur(d3, A, 'a@t');
  await rpc(d3, 'zeste_or_lot_enregistrer', { p: { type: 'souverain', quantite: 1, date_achat: '2025-01-01', prix_total: 500 } }, asA);
  await d3.exec(lireSql('zeste-or-retour.sql'));
  await refuse(rpc(d3, 'zeste_or_lire', {}, asA), /permission denied/);
  assert.equal((await d3.query(`select count(*)::int n from zeste.or_lots`)).rows[0].n, 1);
  await d3.exec(lireSql('zeste-or.sql'));
  assert.equal((await rpc(d3, 'zeste_or_lire', {}, asA)).lots.length, 1);
});

test('correctif de sécurité SEUL sur la production actuelle : failles fermées, ancienne appli intacte, suite complète applicable ensuite', async () => {
  const d4 = await nouvelleBase([...AVANT_CORRECTIF, 'zeste-correctif-securite.sql']);
  await creerUtilisateur(d4, A, 'a@t'); await creerUtilisateur(d4, B, 'b@t');
  // ce que fait l'appli en ligne (main) : tout fonctionne pour le compte connecté
  await rpc(d4, 'zeste_save_mine', { p_data: etat('appli en ligne') }, asA);
  assert.equal((await rpc(d4, 'zeste_load_mine', {}, asA)).todos[0].txt, 'Tâche appli en ligne');
  await rpc(d4, 'zeste_sync_reminders', { p_household: A, p_items: [{ todo_id: 'r', due_ms: 5, txt: 'Dentiste' }] }, asA);
  await rpc(d4, 'zeste_save_sub', { p_household: A, p_sub: { endpoint: 'https://push.apple/a' } }, asA);
  // failles fermées
  await refuse(rpc(d4, 'zeste_sync_reminders', { p_household: A, p_items: [] }, anon), /permission denied/);
  await refuse(rpc(d4, 'zeste_save_sub', { p_household: A, p_sub: { endpoint: 'https://pirate' } }, anon), /permission denied/);
  await refuse(rpc(d4, 'zeste_sync_reminders', { p_household: A, p_items: [] }, asB), /Accès refusé/);
  await refuse(rpc(d4, 'zeste_save_sub', { p_household: A, p_sub: { endpoint: 'https://pirate' } }, asB), /Accès refusé/);
  await refuse(rpc(d4, 'zeste_load', { p_id: 'cccccccc-3333-4333-8333-333333333333' }, anon), /permission denied/);
  await refuse(rpc(d4, 'zeste_load_mine', {}, anon), /permission denied/);
  assert.equal((await d4.query(`select count(*)::int n from zeste.reminders where household_id=$1`, [A])).rows[0].n, 1);
  // puis la version consolidée par-dessus, sans accroc
  for (const f of A_APPLIQUER) await d4.exec(lireSql(f));
  assert.equal((await rpc(d4, 'zeste_load_mine_v2', {}, asA)).data.todos[0].txt, 'Tâche appli en ligne');
  assert.equal((await d4.query(`select count(*)::int n from zeste.reminders`)).rows[0].n, 1);
  // et le retour arrière remet exactement l'état d'avant (failles comprises)
  const d5 = await nouvelleBase([...AVANT_CORRECTIF, 'zeste-correctif-securite.sql', 'zeste-securite-retour.sql']);
  assert.equal((await d5.query(`select has_function_privilege('anon','public.zeste_save_sub(uuid,jsonb)','execute') ok`)).rows[0].ok, true);
});

test('(historique) retours vers l\'état d\'AVANT le correctif : définitions de production du 02/11 avant 20 h 10', async () => {
  const PROD = { zeste_save_mine: '4dae0c3f6776457ec931093b7dc0ffeb', zeste_save_sub: 'df91e862944daddb1d29fd86ec28c279',
                 zeste_sync_reminders: '86aee7b211a791f2601292800e6f570d' };
  const d6 = await nouvelleBase([...AVANT_CORRECTIF, ...A_APPLIQUER, 'zeste-or-retour.sql', 'zeste-securite-retour.sql', 'zeste-sync-v2-retour.sql']);
  const r = await d6.query(`select p.proname, md5(pg_get_functiondef(p.oid)) h from pg_proc p
    where p.oid in ('public.zeste_save_sub(uuid,jsonb)'::regprocedure, 'public.zeste_sync_reminders(uuid,jsonb)'::regprocedure, 'public.zeste_save_mine(jsonb)'::regprocedure)`);
  for (const x of r.rows) assert.equal(x.h, PROD[x.proname], x.proname);
  // et le correctif seul + son retour également
  const d7 = await nouvelleBase([...AVANT_CORRECTIF, 'zeste-correctif-securite.sql', 'zeste-securite-retour.sql']);
  const r7 = await d7.query(`select p.proname, md5(pg_get_functiondef(p.oid)) h from pg_proc p
    where p.oid in ('public.zeste_save_sub(uuid,jsonb)'::regprocedure, 'public.zeste_sync_reminders(uuid,jsonb)'::regprocedure)`);
  for (const x of r7.rows) assert.equal(x.h, PROD[x.proname], x.proname);
});

test('retour arrière de la version complète : ramène EXACTEMENT à la production actuelle (correctif compris, failles fermées)', async () => {
  // empreintes relevées en production après le correctif (02/11/2026, 20 h 13)
  const PROD = { zeste_load: '3762658e0a099c062a937147e8337255', zeste_load_mine: 'cf53677b95a3b23ed95fffac834de162',
    zeste_new_space: '1c2622b80da5269855bbfdb32057ff5a', zeste_save: '80d3ab076f930fe59963d4e56f956ac5',
    zeste_save_mine: '4dae0c3f6776457ec931093b7dc0ffeb', zeste_save_sub: 'a9ad1482d1ae67c53db14cd3aeb1d96d',
    zeste_save_sub_mine: '4c35c849413f22a1fdbd60415c5876b4', zeste_sync_reminders: '096bb726c0207f7f122027fe78b77ce3',
    zeste_sync_reminders_mine: 'ddb40589315b3f38b6af2cb5fc3835d4', verif_remboursements: '27e0c28975c76606aff24c925d9e6aad' };
  const empreintes = async (d) => Object.fromEntries((await d.query(`select p.proname, md5(pg_get_functiondef(p.oid)) h from pg_proc p
    where ((p.pronamespace='public'::regnamespace and p.proname like 'zeste%') or p.pronamespace='zeste'::regnamespace)`)).rows.map(x=>[x.proname, x.h]));
  // 1. la base locale « production actuelle » est bien identique à la vraie
  assert.deepEqual(await empreintes(await nouvelleBase(DEJA_EN_PROD)), PROD);
  // 2. version complète puis retours (Or → sécurité après correctif → synchro v2) : retour à l'identique
  const d8 = await nouvelleBase([...DEJA_EN_PROD, ...A_APPLIQUER, 'zeste-or-retour.sql', 'zeste-securite-retour-apres-correctif.sql', 'zeste-sync-v2-retour.sql']);
  const apres = await empreintes(d8);
  for (const [f, h] of Object.entries(PROD)) assert.equal(apres[f], h, f);
  assert.equal((await d8.query(`select count(*)::int n from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'zeste%'
    and has_function_privilege('anon', p.oid, 'execute')`)).rows[0].n, 0);   // failles toujours fermées après retour
});

test('verrouillage des anciennes versions (après publication complète) : plus aucun enregistrement par l\'ancien chemin, nouvelle appli intacte', async () => {
  const d9 = await nouvelleBase(DEJA_EN_PROD);
  await creerUtilisateur(d9, A, 'a@t');
  await rpc(d9, 'zeste_save_mine', { p_data: etat('appli actuelle') }, asA);              // état de départ réel
  for (const f of A_APPLIQUER) await d9.exec(lireSql(f));
  await rpc(d9, 'zeste_save_mine', { p_data: etat('encore accepté') }, asA);              // sans verrou : l'ancien chemin passe encore
  const h0 = (await d9.query(`select md5(data::text) h from zeste.user_data`)).rows[0].h;
  await d9.exec(lireSql('zeste-verrou-anciennes-versions.sql'));
  assert.equal((await d9.query(`select md5(data::text) h from zeste.user_data`)).rows[0].h, h0); // aucune donnée modifiée
  await refuse(rpc(d9, 'zeste_save_mine', { p_data: etat('état falsifié') }, asA), /version de Zeste périmée/);
  const lu = await rpc(d9, 'zeste_load_mine_v2', {}, asA);
  assert.equal(lu.data.todos[0].txt, 'Tâche encore accepté');                              // le faux n'est pas enregistré
  await rpc(d9, 'zeste_save_mine_v2', { p_data: etat('nouvelle appli'), p_base_rev: lu.rev }, asA); // la nouvelle appli enregistre
});
