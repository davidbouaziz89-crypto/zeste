// Synchro v2 + fermeture des accès (sql/zeste-sync-v2.sql, sql/zeste-securite.sql), sur base locale jetable.
// Migration rejouée sur des données « comme en production » (avant / après, retours arrière).
// Lancer : PGLITE_DIR=<dossier pglite> node --test tests/sync/serveur.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { nouvelleBase, creerUtilisateur, rpc, comme, lireSql, DEJA_EN_PROD, A_APPLIQUER } from '../or/pg-local.mjs';

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
