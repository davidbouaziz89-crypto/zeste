// Contrôles serveur de l'onglet Or, sur une base locale jetable (voir pg-local.mjs).
// Lancer : PGLITE_DIR=<dossier pglite> node --test tests/or/sql.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { nouvelleBase, creerUtilisateur, rpc, comme, RACINE } from './pg-local.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const LOT = 'aaaaaaaa-0000-4000-8000-000000000001';
const asA = { uid: A }, asB = { uid: B };
const refuse = async (promesse, motif) => {
  await assert.rejects(promesse, e => { assert.match(String(e.message), motif); return true; });
};

let db;
test.before(async () => {
  db = await nouvelleBase();
  // idempotent : on rejoue le script une deuxième fois
  await db.exec(readFileSync(path.join(RACINE, 'sql/zeste-or.sql'), 'utf8'));
  await creerUtilisateur(db, A, 'a@test.local');
  await creerUtilisateur(db, B, 'b@test.local');
});

test('anon ne peut rien appeler', async () => {
  for (const f of ['zeste_or_lire', 'zeste_or_cours_lire']) {
    await refuse(rpc(db, f, {}, { role: 'anon' }), /permission denied/);
  }
});

test('connexion obligatoire', async () => {
  await refuse(rpc(db, 'zeste_or_lire', {}, { role: 'authenticated' }), /connexion requise/);
});

test('aucun accès direct aux tables', async () => {
  for (const t of ['or_lots', 'or_ventes', 'or_photos', 'or_cours_jour', 'or_appels_api']) {
    await refuse(comme(db, asA, `select * from zeste.${t}`), /permission denied/);
    await refuse(comme(db, { role: 'anon' }, `select * from zeste.${t}`), /permission denied/);
  }
});

test('achat : création, poids imposés par la fiche serveur, idempotence', async () => {
  const p = { id: LOT, type: 'napoleon20', quantite: 5, date_achat: '2024-03-14', prix_total: 2600, frais: 40,
    poids_fin_g: 99, millesime: 1910, vendeur: '  Comptoir  ', commentaire: '' };
  const l = await rpc(db, 'zeste_or_lot_enregistrer', { p }, asA);
  assert.equal(Number(l.poids_fin_g), 5.8064);       // le navigateur ne choisit pas le poids d'une pièce connue
  assert.equal(Number(l.titre_millieme), 900);
  assert.equal(l.vendeur, 'Comptoir');
  assert.equal(l.commentaire, null);
  assert.equal(l.user_id, undefined);                // jamais renvoyé
  await rpc(db, 'zeste_or_lot_enregistrer', { p }, asA); // double appui
  const lu = await rpc(db, 'zeste_or_lire', {}, asA);
  assert.equal(lu.lots.length, 1);
  assert.equal(lu.types.length, (await db.query('select count(*)::int n from zeste.or_types')).rows[0].n);   // tout le catalogue
});

test('cloisonnement entre comptes', async () => {
  const luB = await rpc(db, 'zeste_or_lire', {}, asB);
  assert.equal(luB.lots.length, 0);
  await refuse(rpc(db, 'zeste_or_lot_enregistrer', { p: { id: LOT, type: 'napoleon20', quantite: 1, date_achat: '2024-01-01', prix_total: 1 } }, asB), /achat introuvable/);
  await refuse(rpc(db, 'zeste_or_lot_supprimer', { p_id: LOT }, asB), /achat introuvable/);
  await refuse(rpc(db, 'zeste_or_vente_enregistrer', { p: { lot_id: LOT, quantite: 1, date_vente: '2024-05-01', prix_total: 1 } }, asB), /achat introuvable/);
  await refuse(rpc(db, 'zeste_or_photo_enregistrer', { p_lot: LOT, p_image: 'data:image/jpeg;base64,AAAA' }, asB), /achat introuvable/);
  assert.equal(await rpc(db, 'zeste_or_photo_lire', { p_lot: LOT }, asB), null);
  const lu = await rpc(db, 'zeste_or_lire', {}, asA);
  assert.equal(lu.lots[0].quantite, 5);               // intact
});

test('saisies invalides refusées', async () => {
  const base = { type: 'napoleon20', quantite: 1, date_achat: '2024-01-01', prix_total: 400 };
  const essai = (diff, motif) => refuse(rpc(db, 'zeste_or_lot_enregistrer', { p: { ...base, ...diff } }, asA), motif);
  await essai({ quantite: 0 }, /quantité hors limites/);
  await essai({ quantite: 1.5 }, /nombre entier/);
  await essai({ quantite: '3' }, /quantité manquante ou invalide/);
  await essai({ prix_total: -1 }, /négatif/);
  await essai({ prix_total: 10.001 }, /2 décimales/);
  await essai({ prix_total: null }, /prix d'achat manquant/);
  await essai({ frais: 'abc' }, /frais d'achat invalide/);
  await essai({ date_achat: '2999-01-01' }, /dans le futur/);
  await essai({ date_achat: '2024-02-30' }, /invalide/);
  await essai({ type: 'lingot' }, /type de pièce inconnu/);
  await essai({ millesime: 3000 }, /millésime hors limites/);
  await essai({ type: 'autre' }, /nom de la pièce/);
  await essai({ type: 'autre', nom: 'Pesos' }, /poids d'or fin/);
  await essai({ type: 'autre', nom: 'Pesos', poids_brut_g: 5, poids_fin_g: 6 }, /dépasser le poids brut/);
  await essai({ type: 'louis_autre', titre_millieme: 1200, poids_brut_g: 8 }, /titre invalide/);
});

test('pièce libre : or fin calculé depuis poids brut × titre', async () => {
  const l = await rpc(db, 'zeste_or_lot_enregistrer', { p: { type: 'louis_autre', nom: 'Louis XV aux lunettes',
    quantite: 1, date_achat: '2023-06-01', prix_total: 1300, poids_brut_g: 8.158, titre_millieme: 917 } }, asA);
  assert.equal(Number(l.poids_fin_g), 7.4809);
  await rpc(db, 'zeste_or_lot_supprimer', { p_id: l.id }, asA);
});

test('ventes partielles : jamais plus que détenu, contrôle sous verrou', async () => {
  const v1 = await rpc(db, 'zeste_or_vente_enregistrer', { p: { lot_id: LOT, quantite: 2, date_vente: '2025-01-10', prix_total: 1200, frais: 10 } }, asA);
  await refuse(rpc(db, 'zeste_or_vente_enregistrer', { p: { lot_id: LOT, quantite: 4, date_vente: '2025-02-01', prix_total: 1 } }, asA), /il ne reste que 3/);
  await refuse(rpc(db, 'zeste_or_vente_enregistrer', { p: { lot_id: LOT, quantite: 1, date_vente: '2024-03-13', prix_total: 1 } }, asA), /précéder l'achat/);
  await refuse(rpc(db, 'zeste_or_vente_enregistrer', { p: { lot_id: LOT, quantite: 1, date_vente: '2999-01-01', prix_total: 1 } }, asA), /dans le futur/);
  const v2 = await rpc(db, 'zeste_or_vente_enregistrer', { p: { lot_id: LOT, quantite: 3, date_vente: '2025-03-01', prix_total: 1900 } }, asA);
  await refuse(rpc(db, 'zeste_or_vente_enregistrer', { p: { lot_id: LOT, quantite: 1, date_vente: '2025-03-02', prix_total: 1 } }, asA), /il ne reste que 0/);
  // modification d'une vente : elle ne se compte pas deux fois
  await rpc(db, 'zeste_or_vente_enregistrer', { p: { id: v2.id, lot_id: LOT, quantite: 2, date_vente: '2025-03-01', prix_total: 1300 } }, asA);
  await refuse(rpc(db, 'zeste_or_vente_enregistrer', { p: { id: v2.id, lot_id: LOT, quantite: 4, date_vente: '2025-03-01', prix_total: 1 } }, asA), /il ne reste que 3/);
  // une vente ne change pas d'achat
  const autre = await rpc(db, 'zeste_or_lot_enregistrer', { p: { type: 'souverain', quantite: 1, date_achat: '2024-01-01', prix_total: 500 } }, asA);
  await refuse(rpc(db, 'zeste_or_vente_enregistrer', { p: { id: v1.id, lot_id: autre.id, quantite: 1, date_vente: '2025-01-10', prix_total: 1 } }, asA), /vente introuvable/);
  // B ne peut pas toucher la vente de A
  await refuse(rpc(db, 'zeste_or_vente_supprimer', { p_id: v1.id }, asB), /vente introuvable/);
  const lu = await rpc(db, 'zeste_or_lire', {}, asA);
  assert.equal(lu.ventes.filter(v => v.lot_id === LOT).reduce((s, v) => s + v.quantite, 0), 4);
  await rpc(db, 'zeste_or_lot_supprimer', { p_id: autre.id }, asA);
});

test("modifier l'achat ne peut pas contredire les ventes", async () => {
  const p = { id: LOT, type: 'napoleon20', quantite: 3, date_achat: '2024-03-14', prix_total: 2600 };
  await refuse(rpc(db, 'zeste_or_lot_enregistrer', { p }, asA), /inférieure aux 4 pièce/);
  await refuse(rpc(db, 'zeste_or_lot_enregistrer', { p: { ...p, quantite: 5, date_achat: '2025-02-01' } }, asA), /après une vente/);
  const ok = await rpc(db, 'zeste_or_lot_enregistrer', { p: { ...p, quantite: 6 } }, asA);
  assert.equal(ok.quantite, 6);
});

test('photo : format et taille contrôlés, lecture réservée au propriétaire', async () => {
  await refuse(rpc(db, 'zeste_or_photo_enregistrer', { p_lot: LOT, p_image: 'data:image/png;base64,AAAA' }, asA), /photo refusée/);
  await refuse(rpc(db, 'zeste_or_photo_enregistrer', { p_lot: LOT, p_image: 'data:image/jpeg;base64,' + 'A'.repeat(600001) }, asA), /photo refusée/);
  await rpc(db, 'zeste_or_photo_enregistrer', { p_lot: LOT, p_image: 'data:image/jpeg;base64,QUJD' }, asA);
  assert.equal(await rpc(db, 'zeste_or_photo_lire', { p_lot: LOT }, asA), 'data:image/jpeg;base64,QUJD');
  const lu = await rpc(db, 'zeste_or_lire', {}, asA);
  assert.equal(lu.lots.find(l => l.id === LOT).a_photo, true);
});

test('supprimer un achat qui a des ventes demande une confirmation explicite', async () => {
  await refuse(rpc(db, 'zeste_or_lot_supprimer', { p_id: LOT }, asA), /a 2 vente/);
  await rpc(db, 'zeste_or_lot_supprimer', { p_id: LOT, p_avec_ventes: true }, asA);
  const lu = await rpc(db, 'zeste_or_lire', {}, asA);
  assert.equal(lu.lots.length, 0);
  assert.equal(lu.ventes.length, 0);
  const photos = await db.query('select count(*)::int as n from zeste.or_photos');
  assert.equal(photos.rows[0].n, 0);
});

test('cours : écriture réservée au service_role, lecture pour les connectés', async () => {
  const maj = { p: { fournisseur: 'goldapi', nature: 'actuel', ok: true, actuel: { eur_g: 98.1234567, source: 'test', cote_le: '2026-11-02T10:00:00Z' },
    jours: [{ jour: '2026-10-30', eur_g: 97.5, source: 'test' }, { jour: '2026-10-31', eur_g: 0, source: 'test' }] } };
  await refuse(rpc(db, 'zeste_or_cours_maj', maj, asA), /permission denied/);
  await refuse(rpc(db, 'zeste_or_cours_etat', { p_fournisseur: 'goldapi' }, asA), /permission denied/);
  await rpc(db, 'zeste_or_cours_maj', maj, { role: 'service_role' });
  await rpc(db, 'zeste_or_cours_maj', { p: { sans_appel: true, meta: { histo_verifie_le: '2026-11-02' } } }, { role: 'service_role' });
  const etat = await rpc(db, 'zeste_or_cours_etat', { p_fournisseur: 'goldapi' }, { role: 'service_role' });
  assert.equal(etat.appels_mois, 1);                 // la mise à jour « sans appel » ne consomme pas le quota
  assert.equal(etat.meta.histo_verifie_le, '2026-11-02');
  const lu = await rpc(db, 'zeste_or_cours_lire', { p_depuis: '2026-01-01' }, asB);
  assert.equal(Number(lu.actuel.eur_g), 98.1235);
  assert.deepEqual(lu.historique.map(x => x[0]), ['2026-10-30']); // le prix nul est ignoré
});
