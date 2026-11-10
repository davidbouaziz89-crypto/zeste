// Catalogue de pièces (sql/zeste-or-catalogue.sql) sur une base locale jetable :
// migration sur des données existantes, poids imposés par le serveur, variantes,
// valorisation calculée côté serveur = côté écran, retour arrière sans perte.
// Lancer : PGLITE_DIR=<dossier pglite> node --test tests/or/catalogue.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { nouvelleBase, creerUtilisateur, rpc, RACINE, DEJA_EN_PROD, A_APPLIQUER, lireSql } from './pg-local.mjs';

const A = '55555555-5555-4555-8555-555555555555';
const asA = { uid: A };
// le bloc de calcul de l'écran, tel quel (même extraction que calculs.test.mjs)
const html = readFileSync(path.join(RACINE, 'index.html'), 'utf8');
const bloc = html.split('// ==== OR-CALCUL-DEBUT')[1].split('// ==== OR-CALCUL-FIN ====')[0].replace(/^[^\n]*\n/, '');
const O = vm.runInNewContext(bloc + ';({OR_TYPES, OR_TYPE, orPortefeuille, orGroupes, orChercher})', {});

// base = production actuelle (avant le catalogue), avec les achats déjà enregistrés de David (fictifs ici)
const SANS_CATALOGUE = [...DEJA_EN_PROD, ...A_APPLIQUER.filter(f => f !== 'zeste-or-catalogue.sql')];
async function baseAvecAchats(){
  const db = await nouvelleBase(SANS_CATALOGUE);
  await creerUtilisateur(db, A, 'a@test.local');
  for (const p of [
    { type: 'napoleon20', quantite: 5, date_achat: '2024-03-14', prix_total: 2600, frais: 40 },
    { type: 'vreneli20', quantite: 3, date_achat: '2025-01-08', prix_total: 1590 },
    { type: 'autre', nom: '50 pesos mexicain', quantite: 1, date_achat: '2024-11-05', prix_total: 3020, poids_fin_g: 37.5 },
  ]) await rpc(db, 'zeste_or_lot_enregistrer', { p }, asA);
  const l = (await rpc(db, 'zeste_or_lire', {}, asA)).lots;
  await rpc(db, 'zeste_or_vente_enregistrer', { p: { lot_id: l[0].id, quantite: 1, date_vente: '2025-06-01', prix_total: 640 } }, asA);
  return db;
}
const empreinte = async (db) => (await db.query(`select md5(string_agg(to_jsonb(l)::text, '|' order by id)) h from zeste.or_lots l`)).rows[0].h
  + (await db.query(`select md5(string_agg(to_jsonb(v)::text, '|' order by id)) h from zeste.or_ventes v`)).rows[0].h;

test('migration sur une base qui a déjà des achats : aucun achat, vente ni poids modifié ; rejouable', async () => {
  const db = await baseAvecAchats();
  const avant = await empreinte(db);
  await db.exec(lireSql('zeste-or-catalogue.sql'));
  await db.exec(lireSql('zeste-or-catalogue.sql'));                 // rejouée : sans effet
  assert.equal(await empreinte(db), avant);
  const n = (await db.query('select count(*)::int n from zeste.or_types')).rows[0].n;
  assert.equal(n, O.OR_TYPES.length);
  // les 8 fiches d'origine : mêmes poids
  const r = (await db.query(`select code, poids_fin_g::float f from zeste.or_types where code in ('napoleon20','vreneli20','souverain','louis_xvi') order by code`)).rows;
  assert.deepEqual(r.map(x => [x.code, x.f]), [['louis_xvi', 7.0141], ['napoleon20', 5.8064], ['souverain', 7.3224], ['vreneli20', 5.8064]]);
  const p50 = (await db.query(`select pays, annees from zeste.or_types where code = 'pesos50'`)).rows[0];
  assert.equal(p50.pays, 'Mexique');
});

test('50 pesos depuis le catalogue : le serveur impose les poids officiels, quoi que le navigateur envoie', async () => {
  const db = await baseAvecAchats();
  await db.exec(lireSql('zeste-or-catalogue.sql'));
  const l = await rpc(db, 'zeste_or_lot_enregistrer', { p: { type: 'pesos50', quantite: 1, date_achat: '2026-11-10', prix_total: 4300,
    poids_fin_g: 1, poids_brut_g: 1, titre_millieme: 1 } }, asA);
  const t = O.OR_TYPE.pesos50;
  assert.deepEqual([Number(l.poids_brut_g), Number(l.titre_millieme), Number(l.poids_fin_g)], [t.brut, t.titre, t.fin]);
});

test('10 dollars : chaque variante garde ses propres poids (jamais confondues)', async () => {
  const db = await baseAvecAchats();
  await db.exec(lireSql('zeste-or-catalogue.sql'));
  const fins = [];
  for (const type of O.orChercher('10 dollars').map(t => t.code)) {
    const l = await rpc(db, 'zeste_or_lot_enregistrer', { p: { type, quantite: 1, date_achat: '2026-11-10', prix_total: 1000 } }, asA);
    assert.equal(Number(l.poids_fin_g), O.OR_TYPE[type].fin, type);
    fins.push(Number(l.poids_fin_g));
  }
  assert.equal(fins.length, 3);
  assert.equal(new Set(fins).size, 3);
});

test('valorisation : calcul serveur (SQL) = calcul de l\'écran, au centime, pour deux cours différents', async () => {
  const db = await baseAvecAchats();
  await db.exec(lireSql('zeste-or-catalogue.sql'));
  for (const p of [
    { type: 'pesos50', quantite: 2, date_achat: '2025-02-11', prix_total: 6640 },
    { type: 'pesos50', quantite: 1, date_achat: '2026-03-02', prix_total: 4180, frais: 20 },
    { type: 'dollars10', quantite: 1, date_achat: '2026-06-18', prix_total: 1690 },
  ]) await rpc(db, 'zeste_or_lot_enregistrer', { p }, asA);
  for (const cours of [116.0517, 98.3]) {
    await db.query(`insert into zeste.or_cours_actuel (id, eur_g, source, cote_le) values (1, $1, 'essai', now())
      on conflict (id) do update set eur_g = excluded.eur_g`, [cours]);
    // côté serveur : pièces détenues × (or fin × cours, arrondi au centime) ; coût des pièces détenues au prorata
    const srv = (await db.query(`
      with d as (
        select l.id, l.quantite q, coalesce((select sum(v.quantite) from zeste.or_ventes v where v.lot_id = l.id), 0) vendu,
               round((l.prix_total + l.frais) * 100) cout, l.poids_fin_g fin
        from zeste.or_lots l where l.user_id = $1)
      select sum((q - vendu) * round(fin * c.eur_g * 100))::bigint valeur,
             sum(cout - round(cout * vendu / q))::bigint investi
      from d, zeste.or_cours_actuel c`, [A])).rows[0];
    const lu = await rpc(db, 'zeste_or_lire', {}, asA);
    const cr = await rpc(db, 'zeste_or_cours_lire', {}, asA);
    const P = O.orPortefeuille(lu.lots, lu.ventes, Number(cr.actuel.eur_g));
    assert.equal(P.valeur, Number(srv.valeur), 'valeur à ' + cours);
    assert.equal(P.investi, Number(srv.investi), 'investi à ' + cours);
    const G = O.orGroupes(lu.lots, lu.ventes, Number(cr.actuel.eur_g));
    assert.equal(G.reduce((s, g) => s + g.valeur, 0), P.valeur);
    const p50 = G.find(g => g.type === 'pesos50');
    assert.equal(p50.detenu, 3);
    assert.equal(p50.puAchat, Math.round(1084000 / 3));         // (6 640 + 4 180 + 20) / 3
  }
});

test('retour arrière : refusé tant qu\'un achat utilise une nouvelle fiche ; sinon retour exact, achats intacts', async () => {
  const db = await baseAvecAchats();
  const avant = await empreinte(db);
  await db.exec(lireSql('zeste-or-catalogue.sql'));
  const l = await rpc(db, 'zeste_or_lot_enregistrer', { p: { type: 'krugerrand1', quantite: 1, date_achat: '2026-11-10', prix_total: 3500 } }, asA);
  await assert.rejects(db.exec(lireSql('zeste-or-catalogue-retour.sql')), /Retour arrière refusé : 1 achat/);
  assert.equal((await db.query('select count(*)::int n from zeste.or_types')).rows[0].n, O.OR_TYPES.length);
  await rpc(db, 'zeste_or_lot_supprimer', { p_id: l.id }, asA);
  await db.exec(lireSql('zeste-or-catalogue-retour.sql'));
  assert.equal((await db.query('select count(*)::int n from zeste.or_types')).rows[0].n, 8);
  assert.equal(await empreinte(db), avant);
});

test('pièce saisie à la main avant le catalogue : reconnue sans ambiguïté et rattachable sans perte (prix, date, ventes)', async () => {
  const db = await baseAvecAchats();
  await db.exec(lireSql('zeste-or-catalogue.sql'));
  const lu = await rpc(db, 'zeste_or_lire', {}, asA);
  const l = lu.lots.find(x => x.type === 'autre');
  const c = O.orChercher(l.nom).filter(t => !t.libre);
  assert.deepEqual([...c.map(t => t.code)], ['pesos50']);
  assert.ok(Math.abs(c[0].fin - Number(l.poids_fin_g)) <= 0.01 * c[0].fin);
  // même appel que le bouton « Rattacher à cette fiche »
  const r = await rpc(db, 'zeste_or_lot_enregistrer', { p: { id: l.id, type: 'pesos50', quantite: l.quantite, date_achat: l.date_achat,
    prix_total: Number(l.prix_total), frais: Number(l.frais), millesime: null, vendeur: '', commentaire: '', nom: '' } }, asA);
  assert.equal(r.id, l.id);
  assert.equal(Number(r.prix_total), 3020);
  assert.equal(r.date_achat, '2024-11-05');
  assert.equal(Number(r.poids_fin_g), O.OR_TYPE.pesos50.fin);
});
