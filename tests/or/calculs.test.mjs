// Calculs de l'onglet Or : le bloc « OR-CALCUL » est extrait tel quel d'index.html
// (aucune copie du code) puis exécuté ici. Lancer : node --test tests/or/calculs.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(path.join(RACINE, 'index.html'), 'utf8');
const bloc = html.split('// ==== OR-CALCUL-DEBUT')[1].split('// ==== OR-CALCUL-FIN ====')[0].replace(/^[^\n]*\n/, '');
const O = vm.runInNewContext(bloc + `;({OR_TYPES, OR_TYPE, orChercher, orCourantes, orGroupes, orNorm, orEurG, orC, orJ1, orEcart, orMoisAvant, orStatsLot, orLotStats, orPortefeuille,
  orSerie, orDebutPeriode, orLireEur, orLireNb, orEur, orPct})`, {});
const NB = ' '; // espace fine insécable des milliers (fr-FR)

const lot = (o) => ({ id: 'L1', type: 'napoleon20', quantite: 3, prix_total: 1500, frais: 30, poids_fin_g: 5.8064, date_achat: '2024-03-14', ...o });
const vente = (o) => ({ id: 'V' + Math.random(), lot_id: 'L1', quantite: 1, prix_total: 600, frais: 0, date_vente: '2025-01-10', cree_le: '2025-01-10T10:00:00Z', ...o });

test('fiches des pièces identiques au serveur (sql/zeste-or.sql puis sql/zeste-or-catalogue.sql)', () => {
  const re = /^\s*\('([a-z0-9_]+)',\s*'(?:[^']|'')*',\s*([\d.]+|null),\s*([\d.]+|null),\s*([\d.]+|null),\s*(true|false),\s*(\d+)(?:,\s*('(?:[^']|'')*'|null),\s*('(?:[^']|'')*'|null))?/gm;
  const fiches = new Map();   // le catalogue (appliqué après) remplace la fiche d'origine
  for (const f of ['sql/zeste-or.sql', 'sql/zeste-or-catalogue.sql']) {
    for (const m of readFileSync(path.join(RACINE, f), 'utf8').matchAll(re)) fiches.set(m[1], m);
  }
  assert.equal(fiches.size, O.OR_TYPES.length);
  assert.equal(new Set(O.OR_TYPES.map(t => t.code)).size, O.OR_TYPES.length, 'code en double');
  const txt = (v) => v == null || v === 'null' ? '' : v.slice(1, -1).replace(/''/g, "'");
  for (const [code, [, , brut, titre, fin, libre, ordre, pays, annees]] of fiches) {
    const t = O.OR_TYPE[code];
    assert.ok(t, 'type absent côté écran : ' + code);
    assert.equal(!!t.libre, libre === 'true', code);
    assert.equal(t.ordre, Number(ordre), code + ' ordre');
    assert.equal(t.pays, txt(pays), code + ' pays');
    assert.equal(t.annees, txt(annees), code + ' années');
    if (!t.libre) {
      assert.equal(t.brut, Number(brut), code + ' brut');
      assert.equal(t.titre, Number(titre), code + ' titre');
      assert.equal(t.fin, Number(fin), code + ' fin');
      assert.ok(t.fin <= t.brut, code + ' : or fin > poids brut');
      // pièces anciennes : or fin = brut × titre (poids légaux) ; pièces d'investissement (≥ 999 ‰) : contenu GARANTI
      // par la Monnaie (1 once = 31,1035 g), le poids brut publié pouvant être un peu plus fort (Britannia 31,21 g)
      const tol = (t.titre >= 999 || /once/.test(t.nom)) ? 0.005 * t.fin : 0.0006;
      assert.ok(Math.abs(t.brut * t.titre / 1000 - t.fin) <= tol, code + ' : brut × titre ≠ or fin');
    }
  }
  // les 8 fiches déjà en production gardent leurs poids (les achats existants restent justes)
  const PROD = { napoleon20: [6.4516, 900, 5.8064], francs10: [3.2258, 900, 2.9032], marianne_coq: [6.4516, 900, 5.8064],
    louis_xvi: [7.649, 917, 7.0141], souverain: [7.9881, 916.67, 7.3224], vreneli20: [6.4516, 900, 5.8064] };
  for (const [c, [b, ti, f]] of Object.entries(PROD)) assert.deepEqual([O.OR_TYPE[c].brut, O.OR_TYPE[c].titre, O.OR_TYPE[c].fin], [b, ti, f], c);
  assert.ok(O.OR_TYPE.louis_autre.libre && O.OR_TYPE.autre.libre);
  // un « louis » familier n'hérite pas des caractéristiques du Louis d'or historique
  assert.notEqual(O.OR_TYPE.napoleon20.fin, O.OR_TYPE.louis_xvi.fin);
  assert.equal(O.OR_TYPE.louis_autre.fin, undefined);
});

test('lot sans vente : valeur métal = quantité × or fin × cours', () => {
  const s = O.orLotStats(lot(), [], 100);
  assert.equal(s.cout, 153000);                 // 1 500 € + 30 € de frais
  assert.equal(s.valeur, 174192);               // 3 × 5,8064 g × 100 €/g = 1 741,92 €
  assert.equal(s.latent, 21192);
  assert.equal(s.latentPct.toFixed(2), '13.85');
  assert.equal(s.detenu, 3);
});

test('cours inconnu : valeur inconnue, jamais zéro ni inventée', () => {
  const s = O.orLotStats(lot(), [], null);
  assert.equal(s.valeur, null);
  assert.equal(s.latent, null);
  assert.equal(s.latentPct, null);
  const p = O.orPortefeuille([lot()], [], null);
  assert.equal(p.valeur, null);
  assert.equal(p.investi, 153000);
});

test('vente partielle : coût au prorata, gain réalisé, capital encore investi', () => {
  const s = O.orLotStats(lot(), [vente({ prix_total: 600, frais: 10 })], 100);
  assert.equal(s.vendu, 1);
  assert.equal(s.detenu, 2);
  assert.equal(s.ventes[0].base, 51000);        // 1 530 € / 3
  assert.equal(s.ventes[0].net, 59000);         // 600 € − 10 € de frais
  assert.equal(s.realise, 8000);
  assert.equal(s.coutDetenu, 102000);
  assert.equal(s.valeur, 116128);               // 2 pièces restantes
  assert.equal(s.latent, 116128 - 102000);
});

test('ventes successives : aucun centime perdu à l\'arrondi', () => {
  const l = lot({ prix_total: 1000.01, frais: 0 });          // 100 001 centimes / 3 pièces
  const vs = [vente({ date_vente: '2025-01-01' }), vente({ date_vente: '2025-02-01' }), vente({ date_vente: '2025-03-01' })];
  const s = O.orLotStats(l, vs, 100);
  assert.deepEqual([...s.ventes.map(x => x.base)], [33334, 33333, 33334]);
  assert.equal(s.ventes.reduce((a, x) => a + x.base, 0), 100001);
  assert.equal(s.coutDetenu, 0);
  assert.equal(s.valeur, 0);
  assert.equal(s.latentPct, null);
});

test('portefeuille : latent, réalisé et bilan global séparés', () => {
  const l1 = lot(), l2 = { ...lot({ id: 'L2', type: 'souverain', quantite: 2, prix_total: 1000, frais: 0, poids_fin_g: 7.3224, date_achat: '2025-01-20' }) };
  const p = O.orPortefeuille([l1, l2], [vente({ prix_total: 600, frais: 10 })], 100);
  assert.equal(p.pieces, 4);
  assert.equal(p.investi, 102000 + 100000);
  assert.equal(p.valeur, 116128 + 146448);
  assert.equal(p.latent, p.valeur - p.investi);
  assert.equal(p.realise, 8000);
  assert.equal(p.bilan, p.latent + 8000);
  assert.equal(p.coutTotal, 253000);
  assert.equal(p.bilanPct.toFixed(3), (p.bilan / 253000 * 100).toFixed(3));
  assert.equal(O.orPortefeuille([], [], null).valeur, 0);
});

test('courbes : chaque achat et chaque vente comptent à leur vraie date', () => {
  const l1 = lot({ date_achat: '2026-01-05' });
  const l2 = lot({ id: 'L2', quantite: 1, prix_total: 500, frais: 0, date_achat: '2026-01-08' });
  const hist = [['2026-01-05', 100], ['2026-01-06', 101], ['2026-01-07', 102], ['2026-01-08', 103], ['2026-01-09', 104]];
  const pts = O.orSerie([l1, l2], [vente({ date_vente: '2026-01-09', prix_total: 600 })], hist, '2026-01-05', '2026-01-12', null);
  const j = Object.fromEntries(pts.map(p => [p.j, p]));
  assert.equal(pts.length, 8);
  assert.equal(j['2026-01-05'].investi, 153000);              // seul le 1er achat
  assert.equal(j['2026-01-07'].investi, 153000);
  assert.equal(j['2026-01-08'].investi, 203000);              // + 2e achat le 08
  assert.equal(j['2026-01-09'].investi, 203000 - 51000);      // vente le 09
  assert.equal(j['2026-01-05'].valeur, Math.round(3 * 5.8064 * 100 * 100));
  assert.equal(j['2026-01-08'].valeur, Math.round(3 * 5.8064 * 103 * 100) + Math.round(5.8064 * 103 * 100));
  // week-end / férié : on reprend le dernier cours, au plus 5 jours
  assert.equal(j['2026-01-12'].g, 104);
});

test('courbes : au-delà de 5 jours sans cours, pas de valeur (trou, rien n\'est inventé)', () => {
  const pts = O.orSerie([lot({ date_achat: '2026-01-01' })], [], [['2026-01-01', 100]], '2026-01-01', '2026-01-10', null);
  const j = Object.fromEntries(pts.map(p => [p.j, p]));
  assert.equal(j['2026-01-06'].g, 100);
  assert.equal(j['2026-01-07'].valeur, null);
  assert.equal(j['2026-01-07'].investi, 153000);              // l'investi reste connu
});

test('courbes : cours du jour utilisé pour aujourd\'hui seulement', () => {
  const pts = O.orSerie([lot({ date_achat: '2026-01-01' })], [], [['2026-01-01', 100]], '2026-01-01', '2026-01-03', { jour: '2026-01-03', eur_g: 110 });
  assert.equal(pts[1].g, 100);
  assert.equal(pts[2].g, 110);
});

test('courbes longues : échantillonnées mais jours d\'achat/vente gardés', () => {
  const pts = O.orSerie([lot({ date_achat: '2016-01-01' }), lot({ id: 'L2', date_achat: '2020-07-13' })], [], [], '2016-01-01', '2026-01-01', null, 300);
  assert.ok(pts.length <= 320, 'trop de points : ' + pts.length);
  assert.ok(pts.some(p => p.j === '2020-07-13'));
  assert.equal(pts[pts.length - 1].j, '2026-01-01');
});

test('périodes : 1 M / 1 an / Max, jamais avant le premier achat', () => {
  assert.equal(O.orMoisAvant('2026-03-31', 1), '2026-02-28');
  assert.equal(O.orDebutPeriode('1m', '2026-11-02', '2020-01-01'), '2026-10-02');
  assert.equal(O.orDebutPeriode('1a', '2026-11-02', '2026-06-01'), '2026-06-01');
  assert.equal(O.orDebutPeriode('max', '2026-11-02', '2019-05-05'), '2019-05-05');
});

test('saisie des montants', () => {
  assert.equal(O.orLireEur('1 234,56'), 123456);
  assert.equal(O.orLireEur('520'), 52000);
  assert.equal(O.orLireEur('49.9 €'), 4990);
  assert.equal(O.orLireEur(''), null);
  assert.ok(Number.isNaN(O.orLireEur('12,345')));
  assert.ok(Number.isNaN(O.orLireEur('-5')));
  assert.ok(Number.isNaN(O.orLireEur('abc')));
  assert.equal(O.orLireNb('5,806'), 5.806);
});

test('affichage : signes, vert/rouge cohérents, pas de « -0 »', () => {
  assert.equal(O.orEur(123456), `1${NB}234,56 €`);
  assert.equal(O.orEur(-5600, true), '−56,00 €');
  assert.equal(O.orEur(5600, true), '+56,00 €');
  assert.equal(O.orEur(0, true), '0,00 €');
  assert.equal(O.orEur(null), '—');
  assert.equal(O.orPct(13.849), '+13,85 %');
  assert.equal(O.orPct(-2.04), '−2,04 %');
  assert.equal(O.orPct(null), '—');
});

test('aucun double comptage : achats multiples d\'une même pièce, frais à l\'achat et à la vente, ventes partielles', () => {
  // deux achats de Napoléon à des dates et prix différents, chacun avec des frais ; un souverain jamais vendu
  const a1 = { id: 'A1', type: 'napoleon20', quantite: 4, prix_total: 1600, frais: 20, poids_fin_g: 5.8064, date_achat: '2023-01-10' }; // coût 1 620 €
  const a2 = { id: 'A2', type: 'napoleon20', quantite: 6, prix_total: 2700, frais: 30, poids_fin_g: 5.8064, date_achat: '2024-05-02' }; // coût 2 730 €
  const a3 = { id: 'A3', type: 'souverain', quantite: 1, prix_total: 580, frais: 0, poids_fin_g: 7.3224, date_achat: '2025-01-20' };
  const ventes = [
    { id: 'V1', lot_id: 'A1', quantite: 1, prix_total: 520, frais: 8, date_vente: '2025-02-01', cree_le: '1' },   // net 512 − base 405 = +107
    { id: 'V2', lot_id: 'A2', quantite: 2, prix_total: 1000, frais: 12, date_vente: '2025-06-01', cree_le: '2' }, // net 988 − base 910 = +78
    { id: 'V3', lot_id: 'A1', quantite: 3, prix_total: 1500, frais: 0, date_vente: '2025-09-01', cree_le: '3' },  // A1 soldé : base 1 215
  ];
  const g = 100;
  const lots = [a1, a2, a3], P = O.orPortefeuille(lots, ventes, g);
  const S = Object.fromEntries(lots.map(l => [l.id, O.orLotStats(l, ventes, g)]));
  // pièces détenues : 0 + 4 + 1
  assert.equal(S.A1.detenu, 0); assert.equal(S.A2.detenu, 4); assert.equal(P.pieces, 5);
  // valeur actuelle : seulement les pièces encore détenues
  assert.equal(S.A1.valeur, 0);
  assert.equal(P.valeur, Math.round(4 * 5.8064 * g * 100) + Math.round(7.3224 * g * 100));
  // capital investi restant = coût d'acquisition (frais d'achat compris) des seules pièces détenues
  assert.equal(S.A2.coutDetenu, 182000);                     // 2 730 € × 4/6
  assert.equal(P.investi, 182000 + 58000);
  // gain latent = valeur − capital restant
  assert.equal(P.latent, P.valeur - P.investi);
  // gain réalisé net = Σ(prix de vente − frais de vente) − coût d'acquisition des pièces vendues
  assert.equal(S.A1.realise, (51200 - 40500) + (150000 - 121500));
  assert.equal(S.A2.realise, 98800 - 91000);
  assert.equal(P.realise, S.A1.realise + S.A2.realise);
  // pas de double comptage : tout le coût engagé est soit encore investi, soit attribué à une vente
  assert.equal(P.investi + P.coutVendu, P.coutTotal);
  assert.equal(P.coutTotal, 162000 + 273000 + 58000);
  const produitsNets = ventes.reduce((s, v) => s + Math.round(v.prix_total * 100) - Math.round(v.frais * 100), 0);
  assert.equal(P.realise, produitsNets - P.coutVendu);
  // les cartes s'additionnent exactement au récapitulatif
  assert.equal(lots.reduce((s, l) => s + S[l.id].coutDetenu, 0), P.investi);
  assert.equal(lots.reduce((s, l) => s + S[l.id].valeur, 0), P.valeur);
});

// ---------------------------------------------------------------------------
//  Catalogue : recherche simple, variantes proposées
// ---------------------------------------------------------------------------
const codes = (q) => [...O.orChercher(q).map(t => t.code)];   // tableau recréé ici (sinon autre contexte vm)
test('recherche : « 50 pesos » trouve la 50 pesos mexicaine en premier (Chili proposé aussi)', () => {
  assert.equal(codes('50 pesos')[0], 'pesos50');
  assert.ok(codes('50 pesos').includes('pesos50_cl'));
  assert.deepEqual(codes('50 pesos mexicains'), ['pesos50']);
  assert.deepEqual(codes('centenario'), ['pesos50']);
  assert.equal(codes('pesos mexique')[0], 'pesos50');
});
test('recherche : « 10 dollars or » propose les variantes (Eagle 1838-1933, Capped Bust, American Eagle 1/4 once)', () => {
  const r = codes('10 dollars or');
  assert.deepEqual([...r].sort(), ['dollars10', 'dollars10_1795', 'eagle_quart'].sort());
  assert.equal(r[0], 'dollars10');
  assert.deepEqual(codes('10$'), r);
  assert.deepEqual(codes('$10'), r);
  // les poids diffèrent bien d'une variante à l'autre : jamais confondues
  assert.equal(new Set(r.map(c => O.OR_TYPE[c].fin)).size, 3);
});
test('recherche : Napoléon, 20F, louis, souverain, fractions d\'once, accents et majuscules', () => {
  assert.equal(codes('Napoléon 20 francs')[0], 'napoleon20');
  assert.equal(codes('NAPOLEON')[0], 'napoleon20');
  assert.equal(codes('napo 20f')[0], 'napoleon20');
  assert.ok(codes('20F').includes('napoleon20') && codes('20F').includes('vreneli20'));
  assert.ok(codes('louis').includes('napoleon20') && codes('louis').includes('louis_xvi'));
  assert.equal(codes('souverain')[0], 'souverain');
  assert.deepEqual(codes('krugerrand 1/2'), ['krugerrand_demi']);
  assert.deepEqual(codes('maple ½ oz'), ['maple_demi']);
  assert.equal(codes('Krügerrand')[0], 'krugerrand1');
  assert.deepEqual(codes('pièce de 20 marks or'), ['mark20']);
  assert.deepEqual(codes('xyzzy'), []);
  assert.deepEqual(codes('   '), []);
  assert.equal(O.orCourantes(8).length, 8);
  assert.ok(O.orCourantes(8).every(t => !t.libre));
});

// ---------------------------------------------------------------------------
//  Tableau par référence : prix moyen pondéré, valeur unitaire × quantité = total
// ---------------------------------------------------------------------------
test('exemple de David : achat 700 €, valeur 850 € → gain +150,00 € (+21,43 %)', () => {
  const [g] = O.orGroupes([lot({ type: 'autre', nom: 'Essai', quantite: 1, prix_total: 700, frais: 0, poids_fin_g: 8.5 })], [], 100);
  assert.equal(O.orEur(g.coutDetenu), '700,00 €');
  assert.equal(O.orEur(g.valeur), '850,00 €');
  assert.equal(O.orEur(g.latent, true), '+150,00 €');
  assert.equal(O.orPct(g.latentPct), '+21,43 %');
});
test('même pièce achetée deux fois à des prix différents : achats conservés, coût total et prix moyen pondéré', () => {
  const lots = [
    lot({ id: 'A', type: 'pesos50', quantite: 2, prix_total: 2800, frais: 0, poids_fin_g: 37.4999, date_achat: '2024-01-10' }),
    lot({ id: 'B', type: 'pesos50', quantite: 1, prix_total: 1600, frais: 20, poids_fin_g: 37.4999, date_achat: '2025-05-02' }),
    lot({ id: 'C', type: 'napoleon20', quantite: 4, prix_total: 2000, frais: 0, poids_fin_g: 5.8064 }),
  ];
  const G = O.orGroupes(lots, [], 116.05);
  assert.equal(G.length, 2);
  const p = G.find(g => g.type === 'pesos50');
  assert.equal(p.achats.length, 2);                              // les deux achats restent distincts
  assert.equal(p.detenu, 3);
  assert.equal(p.coutDetenu, 442000);                            // 2 800 + 1 600 + 20 €
  assert.equal(p.puAchat, 147333);                               // 4 420 € / 3 = 1 473,33 €
  assert.equal(p.finPiece, 37.4999);
  assert.equal(p.valeurPiece, Math.round(37.4999 * 116.05 * 100)); // 4 351,86 € (or fin de l'achat, tel qu'enregistré)
  assert.equal(p.valeur, 3 * p.valeurPiece);                     // par pièce × quantité = total, au centime
  assert.equal(p.latent, p.valeur - 442000);
  // le portefeuille = somme des références
  const P = O.orPortefeuille(lots, [], 116.05);
  assert.equal(P.valeur, G.reduce((s, g) => s + g.valeur, 0));
  assert.equal(P.investi, G.reduce((s, g) => s + g.coutDetenu, 0));
});
test('changement du cours : toutes les valeurs suivent, les achats ne bougent pas', () => {
  const lots = [lot({ type: 'pesos50', quantite: 1, prix_total: 4300, frais: 0, poids_fin_g: 37.4999 })];
  const [a] = O.orGroupes(lots, [], 110), [b] = O.orGroupes(lots, [], 120);
  assert.equal(a.coutDetenu, b.coutDetenu);
  assert.equal(a.valeur, Math.round(37.4999 * 110 * 100));
  assert.equal(b.valeur, Math.round(37.4999 * 120 * 100));
  assert.ok(a.latent < 0 && b.latent > 0);                       // de la moins-value à la plus-value
  const [c] = O.orGroupes(lots, [], null);                       // cours inconnu : rien d'inventé
  assert.equal(c.valeur, null); assert.equal(c.latent, null); assert.equal(c.valeurPiece, null);
});
test('pièces saisies à la main : regroupées seulement si même nom ET même or fin', () => {
  const lots = [
    lot({ id: 'A', type: 'autre', nom: 'Ducat hollandais', poids_fin_g: 3.4436, quantite: 1 }),
    lot({ id: 'B', type: 'autre', nom: 'ducat hollandais ', poids_fin_g: 3.4436, quantite: 2 }),
    lot({ id: 'C', type: 'autre', nom: 'Ducat hollandais', poids_fin_g: 3.49, quantite: 1 }),
  ];
  const G = O.orGroupes(lots, [], 100);
  assert.equal(G.length, 2);
  assert.equal(G.find(g => g.achats.length === 2).detenu, 3);
});
test('référence entièrement vendue : 0 détenue, valeur 0, gain réalisé conservé', () => {
  const [g] = O.orGroupes([lot()], [vente({ quantite: 3, prix_total: 1800 })], 100);
  assert.equal(g.detenu, 0);
  assert.equal(g.valeur, 0);
  assert.equal(g.latent, null);
  assert.equal(g.realise, 180000 - 153000);
});
