// Prêts figés (sql/zeste-prets-figes.sql) sur une base locale jetable : après le transfert dans VALORA,
// Zeste n'accepte plus aucune modification des prêts, mais tout le reste s'enregistre normalement.
// Lancer : PGLITE_DIR=<dossier pglite> node --test tests/sync/prets-figes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { nouvelleBase, creerUtilisateur, rpc, DEJA_EN_PROD, A_APPLIQUER, lireSql } from '../or/pg-local.mjs';

const A = '66666666-6666-4666-8666-666666666666', B = '77777777-7777-4777-8777-777777777777';
const prets = [
  { id: 'p1', who: 'Paul', kind: 'money', amount: 1500, cur: 'EUR', done: false, repays: [{ id: 'r1', amount: 500, date: '2026-05-01' }] },
  { id: 'p2', who: 'Léa', kind: 'thing', amount: 0, txt: 'perceuse', done: false },
];
const etat = (extra = {}) => ({ todos: [{ id: 't1', txt: 'tâche' }], shop: [], films: [], debts: prets, ...extra });
const refus = (p, motif) => assert.rejects(p, e => motif.test(e.message));

test('prêts figés : seules les modifications des prêts sont refusées', async () => {
  const db = await nouvelleBase([...DEJA_EN_PROD, ...A_APPLIQUER]);
  await creerUtilisateur(db, A, 'a@x'); await creerUtilisateur(db, B, 'b@x');
  let rev = Number(await rpc(db, 'zeste_save_mine_v2', { p_data: etat(), p_base_rev: null }, { uid: A }));
  await db.exec(lireSql('zeste-prets-figes.sql'));
  assert.match((await db.query(`select pg_get_functiondef('public.zeste_save_mine_v2(jsonb,bigint)'::regprocedure) d`)).rows[0].d, /VALORA/);

  // nouveau Zeste : tâches, courses, films modifiés, prêts recopiés tels quels → accepté
  rev = Number(await rpc(db, 'zeste_save_mine_v2', { p_data: etat({ todos: [{ id: 't1', txt: 'tâche' }, { id: 't2', txt: 'nouvelle' }], films: [{ id: 'f' }] }), p_base_rev: rev }, { uid: A }));
  // même prêts, ordre des clés différent (le serveur compare le contenu, pas le texte) → accepté
  const melange = prets.map(p => Object.fromEntries(Object.entries(p).reverse()));
  rev = Number(await rpc(db, 'zeste_save_mine_v2', { p_data: etat({ debts: melange }), p_base_rev: rev }, { uid: A }));

  // ancien Zeste : nouveau prêt, remboursement, archivage, suppression → refusés, rien d'enregistré
  const essais = [
    [...prets, { id: 'p3', who: 'Max', kind: 'money', amount: 50, cur: 'EUR', done: false }],
    [{ ...prets[0], repays: [...prets[0].repays, { id: 'r2', amount: 100, date: '2026-11-20' }] }, prets[1]],
    [{ ...prets[0], archived: true, archivedAt: 1 }, prets[1]],
    [prets[1]],
    [],
  ];
  for (const debts of essais)
    await refus(rpc(db, 'zeste_save_mine_v2', { p_data: etat({ debts }), p_base_rev: rev }, { uid: A }), /^Remboursement refusé : les prêts sont maintenant dans l'appli VALORA/);
  const srv = (await db.query('select data, rev from zeste.user_data where user_id = $1', [A])).rows[0];
  assert.equal(Number(srv.rev), rev, 'aucun enregistrement refusé ne fait avancer la version');
  assert.deepEqual(srv.data.debts, melange.map(p => prets.find(x => x.id === p.id)));

  // le contrôle de version passe avant : un ancien appareil en retard voit d'abord le conflit
  await refus(rpc(db, 'zeste_save_mine_v2', { p_data: etat({ debts: [] }), p_base_rev: rev - 1 }, { uid: A }), /Conflit de synchronisation/);
  // compte neuf : sans prêt accepté, avec prêt refusé
  await refus(rpc(db, 'zeste_save_mine_v2', { p_data: etat(), p_base_rev: null }, { uid: B }), /Remboursement refusé/);
  assert.equal(Number(await rpc(db, 'zeste_save_mine_v2', { p_data: etat({ debts: [] }), p_base_rev: null }, { uid: B })), 1);
  // l'ancienne écriture sans version reste fermée
  await refus(rpc(db, 'zeste_save_mine', { p_data: etat() }, { uid: A }), /Remboursement refusé/);

  // retour arrière : définition de production restaurée, prêts de nouveau modifiables
  await db.exec(lireSql('zeste-prets-figes-retour.sql'));
  assert.doesNotMatch((await db.query(`select pg_get_functiondef('public.zeste_save_mine_v2(jsonb,bigint)'::regprocedure) d`)).rows[0].d, /VALORA/);
  assert.equal(Number(await rpc(db, 'zeste_save_mine_v2', { p_data: etat({ debts: [] }), p_base_rev: rev }, { uid: A })), rev + 1);
});
