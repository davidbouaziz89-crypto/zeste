// Edge function zeste-or-cours, branchée sur la base locale jetable (vrai SQL)
// et sur de faux Swissquote / GoldAPI. Aucune requête réseau réelle.
// Lancer : PGLITE_DIR=<dossier pglite> node --experimental-strip-types --test tests/or/edge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { nouvelleBase, creerUtilisateur, rpc } from './pg-local.mjs';
import { traiter, lireSwissquote, BUDGET_MOIS, MAX_APPELS_JOUR, SQ_SOURCE, jourParis, ajouterJours } from '../../supabase/functions/zeste-or-cours/index.ts';

const U = '33333333-3333-4333-8333-333333333333';
const ENV = { SUPABASE_URL: 'http://kong', ANON_KEY: 'cle-anon', SERVICE_KEY: 'cle-service', GOLDAPI_KEY: 'cle-goldapi' };
// même horloge que la base (now() de Postgres sert à dater les relevés et le journal)
const MAINTENANT = Date.now();

// faux réseau : auth + PostgREST (rejoués sur pglite) + Swissquote et GoldAPI simulés
// swissquote : fonction () → Response ; par défaut EN PANNE, pour que les tests GoldAPI
// d'origine exercent le secours (le cas nominal Swissquote a ses propres tests).
function reseau(db, goldapi, swissquote = sqPanne){
  const appels = [], sq = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), h = init.headers || {};
    if (u.pathname === '/auth/v1/user') {
      return new Response(h.Authorization === 'Bearer jeton-ok' ? JSON.stringify({ id: U }) : '{}', { status: h.Authorization === 'Bearer jeton-ok' ? 200 : 401 });
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const nom = u.pathname.split('/').pop();
      const qui = h.Authorization === 'Bearer cle-service' ? { role: 'service_role' } : h.Authorization === 'Bearer jeton-ok' ? { uid: U } : { role: 'anon' };
      try { const r = await rpc(db, nom, JSON.parse(init.body || '{}'), qui); return new Response(r == null ? '' : JSON.stringify(r), { status: 200 }); }
      catch (e) { return new Response(JSON.stringify({ message: e.message }), { status: 400 }); }
    }
    if (u.hostname === 'forex-data-feed.swissquote.com') {
      assert.equal(u.pathname, '/public-quotes/bboquotes/instrument/XAU/EUR');
      sq.push(u.pathname);
      return swissquote();
    }
    if (u.hostname === 'www.goldapi.io') {
      assert.equal(h['x-access-token'], 'cle-goldapi');
      appels.push(u.pathname + u.search);
      return goldapi(u);
    }
    throw new Error('requête inattendue ' + url);
  };
  return { f, appels, sq };
}
const OK = (corps) => new Response(JSON.stringify(corps), { status: 200 });
// Swissquote : 3 plateformes ; milieux 3110,35 / 3110,40 / 3110,30 €/once → médiane 3110,35 → 100,0001 €/g
const SQ_TS = MAINTENANT - 30_000;
const sqCorps = (ts = SQ_TS, m = [3110.35, 3110.40, 3110.30]) => m.map((x, i) => ({ topo: { platform: 'P' + i }, ts,
  spreadProfilePrices: [{ spreadProfile: 'premium', bid: x - 0.6, ask: x + 0.6 }] }));
const sqNormal = () => OK(sqCorps());
const sqPanne = () => new Response('indisponible', { status: 503 });
const SQ_EUR_G = 3110.35 / 31.1034768;
function goldapiNormal(u){
  if (u.pathname === '/api/price/XAU/EUR') return OK({ currency: 'EUR', price: 3110.35, timestamp: 1793630000, price_per_unit: { gram: 100.0012 } });
  if (u.pathname === '/api/history/XAU/EUR') {
    const de = u.searchParams.get('from'), a = u.searchParams.get('to'), prices = [];
    for (let j = de; j <= a; j = ajouterJours(j, 1)) if (j >= '2024-01-01') prices.push({ date: j, price: 31.1034768 * 90 });
    return OK({ metal: 'XAU', currency: 'EUR', from: de, to: a, prices });
  }
  return new Response('?', { status: 404 });
}
const requete = (corps, jeton = 'jeton-ok') => new Request('http://x/functions/v1/zeste-or-cours',
  { method: 'POST', headers: { authorization: 'Bearer ' + jeton, 'content-type': 'application/json' }, body: JSON.stringify(corps) });

// fait comme si le dernier cours avait été relevé il y a h heures
const vieillir = (h) => db.query(`update zeste.or_cours_actuel set releve_le = releve_le - make_interval(mins => $1)`, [Math.round(h * 60)]);
// oublie les échecs récents (pauses après panne écoulées)
const oublierEchecs = () => db.query(`update zeste.or_appels_api set le = le - interval '11 minutes' where not ok`);

let db;
test.beforeEach(async () => { db = await nouvelleBase(); await creerUtilisateur(db, U, 'u@test.local'); });

test('refuse sans connexion (protège le quota)', async () => {
  const { f, appels } = reseau(db, goldapiNormal);
  assert.equal((await traiter(requete({}, 'cle-anon'), ENV, f, MAINTENANT)).status, 401);
  assert.equal((await traiter(requete({}, 'faux'), ENV, f, MAINTENANT)).status, 401);
  assert.equal(appels.length, 0);
});

test('historique sur demande explicite (GoldAPI) : rattrapé depuis la date demandée ; secours GoldAPI seulement si le cours a plus d\'1 h', async () => {
  const { f, appels } = reseau(db, goldapiNormal);
  const r = await traiter(requete({ depuis: '2025-06-01', historique: true }), ENV, f, MAINTENANT);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(Number(j.actuel.eur_g), 100.0012);
  assert.equal(j.actuel.source, 'GoldAPI.io — cours spot XAU/EUR');
  assert.deepEqual(j.alertes, []);
  assert.equal(j.historique[0][0], '2025-06-01');
  assert.equal(j.historique.at(-1)[0], jourParis(MAINTENANT));
  assert.equal(Number(j.historique[0][1]), 90);              // €/once → €/g
  assert.ok(appels.length <= 1 + 1 + 5, 'trop d\'appels : ' + appels.length);
  // deuxième ouverture juste après : aucun appel au fournisseur
  const n = appels.length;
  await traiter(requete({ depuis: '2025-06-01', historique: true }), ENV, f, MAINTENANT + 60_000);
  assert.equal(appels.length, n);
  // « Actualiser » avant 1 h : rien ; après 1 h : un seul appel (cours actuel)
  await traiter(requete({ forcer: true }), ENV, f, MAINTENANT + 50 * 60_000);
  assert.equal(appels.length, n);
  await traiter(requete({ forcer: true }), ENV, f, MAINTENANT + 70 * 60_000);
  assert.equal(appels.length, n + 1);
  assert.equal(appels.at(-1), '/api/price/XAU/EUR');
});

test('historique absent chez le fournisseur : mémorisé, plus jamais redemandé', async () => {
  // le faux fournisseur n'a de données que depuis 150 jours (le plafond de 9 requêtes/jour suffit pour l'atteindre)
  const debutDonnees = ajouterJours(jourParis(MAINTENANT), -150);
  const court = (u) => {
    if (u.pathname !== '/api/history/XAU/EUR') return goldapiNormal(u);
    const de = u.searchParams.get('from'), a = u.searchParams.get('to'), prices = [];
    for (let j = de; j <= a; j = ajouterJours(j, 1)) if (j >= debutDonnees) prices.push({ date: j, price: 31.1034768 * 90 });
    return OK({ metal: 'XAU', currency: 'EUR', from: de, to: a, prices });
  };
  const { f, appels } = reseau(db, court);
  await traiter(requete({ depuis: '2020-01-01', historique: true }), ENV, f, MAINTENANT);
  const etat = await rpc(db, 'zeste_or_cours_etat', { p_fournisseur: 'goldapi' }, { role: 'service_role' });
  assert.equal(etat.premier_jour, debutDonnees);
  assert.ok(etat.meta.histo_vide_avant < debutDonnees);
  const n = appels.length;
  await vieillir(4);
  await traiter(requete({ depuis: '2020-01-01', historique: true }), ENV, f, MAINTENANT);
  assert.deepEqual([...appels.slice(n)], ['/api/price/XAU/EUR']); // seulement le cours actuel (cache de 3 h dépassé)
});

test('panne du fournisseur : dernier cours connu + alerte, puis pause de 10 min', async () => {
  let panne = false;
  const { f, appels } = reseau(db, u => panne ? new Response('erreur', { status: 500 }) : goldapiNormal(u));
  await traiter(requete({}), ENV, f, MAINTENANT);
  panne = true;
  await vieillir(4);
  const r = await traiter(requete({ forcer: true }), ENV, f, MAINTENANT);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(Number(j.actuel.eur_g), 100.0012);            // ancien cours conservé
  assert.ok(j.alertes.some(a => /indisponible/.test(a)));
  const n = appels.length;
  await traiter(requete({ forcer: true }), ENV, f, MAINTENANT + 60_000);
  assert.equal(appels.length, n);                             // pas d'acharnement
  await db.query(`update zeste.or_appels_api set le = le - interval '11 minutes' where not ok`);
  await traiter(requete({ forcer: true }), ENV, f, MAINTENANT + 60_000);
  assert.equal(appels.length, n + 1);                         // on réessaie après la pause
});

test('quota du mois atteint : plus aucun appel, alerte claire', async () => {
  for (let i = 0; i < BUDGET_MOIS; i++) {
    await db.query(`insert into zeste.or_appels_api (le, fournisseur, nature, ok) values ($1, 'goldapi', 'actuel', true)`, [new Date(MAINTENANT - 3600_000).toISOString()]);
  }
  const { f, appels } = reseau(db, goldapiNormal);
  const j = await (await traiter(requete({ forcer: true, depuis: '2025-01-01' }), ENV, f, MAINTENANT)).json();
  assert.equal(appels.length, 0);
  assert.ok(j.alertes.some(a => /quota GoldAPI du mois atteint/.test(a)));
  assert.equal(j.actuel, null);
});

test('Swissquote en panne et secours GoldAPI sans clé : aucun appel GoldAPI, « Cours indisponible », rien d\'inventé', async () => {
  const { f, appels } = reseau(db, goldapiNormal);
  const j = await (await traiter(requete({}), { ...ENV, GOLDAPI_KEY: undefined }, f, MAINTENANT)).json();
  assert.equal(appels.length, 0);
  assert.ok(j.alertes.some(a => /^Cours indisponible \(Swissquote indisponible, secours GoldAPI non configuré\)/.test(a)));
  assert.equal(j.actuel, null);
});

test('réponse fournisseur incohérente : refusée, rien d\'enregistré', async () => {
  const { f } = reseau(db, u => u.pathname.startsWith('/api/price') ? OK({ currency: 'USD', price: 4000 }) : goldapiNormal(u));
  const j = await (await traiter(requete({}), ENV, f, MAINTENANT)).json();
  assert.equal(j.actuel, null);
  assert.ok(j.alertes.length > 0);
});

test('appels simultanés (plusieurs appareils) : un seul appel au fournisseur', async () => {
  const { f, appels } = reseau(db, async (u) => { await new Promise(r => setTimeout(r, 300)); return goldapiNormal(u); });
  const rs = await Promise.all([1, 2, 3].map(() => traiter(requete({}), ENV, f, MAINTENANT)));
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200]);
  assert.equal(appels.filter(a => a === '/api/price/XAU/EUR').length, 1);
  const j = await Promise.all(rs.map(r => r.json()));
  assert.ok(j.every(x => Number(x.actuel.eur_g) === 100.0012));     // tous reçoivent le cours enregistré
  // verrou rendu : un appel suivant (cours périmé) peut actualiser
  await vieillir(4);
  await traiter(requete({}), ENV, f, MAINTENANT);
  assert.equal(appels.filter(a => a === '/api/price/XAU/EUR').length, 2);
});

test('clé lue dans le coffre-fort (Vault) quand la variable d\'environnement est absente : aucun redémarrage', async () => {
  // simule vault.decrypted_secrets (présent en production, absent de la base locale)
  await db.exec(`create schema if not exists vault; create table vault.decrypted_secrets (name text, decrypted_secret text, created_at timestamptz default now());
    insert into vault.decrypted_secrets (name, decrypted_secret) values ('zeste_goldapi', 'cle-goldapi');`);
  const { f, appels } = reseau(db, goldapiNormal);   // le faux GoldAPI exige « cle-goldapi »
  const j = await (await traiter(requete({}), { ...ENV, GOLDAPI_KEY: undefined }, f, MAINTENANT)).json();
  assert.ok(appels.includes('/api/price/XAU/EUR'));
  assert.equal(Number(j.actuel.eur_g), 100.0012);
  assert.deepEqual(j.alertes, []);
  // la clé n'est lisible ni par un compte connecté ni sans connexion
  await assert.rejects(rpc(db, 'zeste_or_cle_fournisseur', {}, { uid: U }), /permission denied/);
  await assert.rejects(rpc(db, 'zeste_or_cle_fournisseur', {}, { role: 'anon' }), /permission denied/);
});


test('sans demande d\'historique (onglet Or simplifié) : une seule requête, le cours actuel', async () => {
  const { f, appels } = reseau(db, goldapiNormal);
  const j = await (await traiter(requete({ depuis: '2020-01-01' }), ENV, f, MAINTENANT)).json();
  assert.deepEqual([...appels], ['/api/price/XAU/EUR']);
  assert.equal(Number(j.actuel.eur_g), 100.0012);
  assert.deepEqual([...j.historique], []);
});

test('plafond journalier : jamais plus de ' + MAX_APPELS_JOUR + ' requêtes par jour (le quota mensuel tient jusqu\'au bout)', async () => {
  for (let i = 0; i < MAX_APPELS_JOUR; i++) {
    await db.query(`insert into zeste.or_appels_api (le, fournisseur, nature, ok) values (now(), 'goldapi', 'actuel', true)`);
  }
  const { f, appels } = reseau(db, goldapiNormal);
  const j = await (await traiter(requete({ forcer: true }), ENV, f, MAINTENANT)).json();
  assert.equal(appels.length, 0);
  assert.ok(j.alertes.some(a => /limite GoldAPI du jour atteinte/.test(a)));
});

test('clé refusée par GoldAPI (invalide) : aucun cours inventé, alerte, la clé n\'apparaît nulle part', async () => {
  const CLE = 'cle-goldapi';
  const { f } = reseau(db, () => new Response('{"error":"Invalid API Key"}', { status: 403 }));
  const r = await traiter(requete({}), ENV, f, MAINTENANT);
  const texte = await r.text(), j = JSON.parse(texte);
  assert.equal(j.actuel, null);                                       // « Cours indisponible » côté écran
  assert.ok(j.alertes.length > 0);
  assert.ok(!texte.includes(CLE));                                    // ni dans la réponse au navigateur…
  const journal = (await db.query(`select string_agg(coalesce(detail,''), ' ') t from zeste.or_appels_api`)).rows[0].t || '';
  assert.ok(!journal.includes(CLE));                                  // …ni dans le journal en base
  assert.match(journal, /403 \(clé refusée\)/);
  assert.ok(j.alertes.some(x => /Cours indisponible \(Swissquote indisponible, clé GoldAPI refusée\)/.test(x)));
});

test('quota épuisé chez GoldAPI (réponse 403 « quota ») : message clair, dernier cours réel conservé', async () => {
  const { f } = reseau(db, goldapiNormal);
  await traiter(requete({}), ENV, f, MAINTENANT);                       // un vrai cours est d'abord relevé
  await vieillir(4);
  const { f: f2 } = reseau(db, () => new Response('{"error":"Monthly API quota exceeded. Upgrade to Pro or Business"}', { status: 403 }));
  const j = await (await traiter(requete({}), ENV, f2, MAINTENANT)).json();
  assert.equal(Number(j.actuel.eur_g), 100.0012);                       // dernier cours réel, pas de valeur inventée
  assert.ok(j.alertes.some(x => /quota GoldAPI épuisé/.test(x)));
});

// ---------------------------------------------------------------------------
//  Source principale : Swissquote (sans clé ni quota)
// ---------------------------------------------------------------------------
test('Swissquote : cours en €/g d\'or fin (médiane des milieux achat/vente), source et heure de cotation, GoldAPI jamais appelé', async () => {
  const { f, appels, sq } = reseau(db, goldapiNormal, sqNormal);
  const j = await (await traiter(requete({}), ENV, f, MAINTENANT)).json();
  assert.equal(sq.length, 1);
  assert.equal(appels.length, 0);
  assert.equal(Number(j.actuel.eur_g), Math.round(SQ_EUR_G * 10000) / 10000);  // 100,0000 €/g (numeric 4 décimales)
  assert.equal(j.actuel.source, SQ_SOURCE);
  assert.equal(Date.parse(j.actuel.cote_le), SQ_TS);
  assert.ok(Math.abs(Date.parse(j.actuel.releve_le) - Date.now()) < 60_000);    // relevé = maintenant
  assert.deepEqual(j.alertes, []);
  const journal = (await db.query(`select fournisseur, ok from zeste.or_appels_api`)).rows;
  assert.deepEqual(journal.map(x => [x.fournisseur, x.ok]), [['swissquote', true]]);
});

test('Swissquote : cache partagé de 15 min ; « Actualiser » au plus une fois par minute', async () => {
  const { f, sq } = reseau(db, goldapiNormal, sqNormal);
  await traiter(requete({}), ENV, f, MAINTENANT);
  await vieillir(10 / 60);                                      // relevé il y a 10 min
  await traiter(requete({}), ENV, f, MAINTENANT);
  assert.equal(sq.length, 1);                                   // < 15 min : cache
  await traiter(requete({ forcer: true }), ENV, f, MAINTENANT);
  assert.equal(sq.length, 2);                                   // « Actualiser » : nouveau relevé
  await traiter(requete({ forcer: true }), ENV, f, MAINTENANT);
  assert.equal(sq.length, 2);                                   // < 1 min après : pas de nouvel appel
  await vieillir(16 / 60);
  await traiter(requete({}), ENV, f, MAINTENANT);
  assert.equal(sq.length, 3);                                   // > 15 min : actualisé automatiquement
});

test('Swissquote en panne, dernier cours de moins d\'1 h : dernier cours conservé avec alerte, quota GoldAPI préservé', async () => {
  let panne = false;
  const { f, appels, sq } = reseau(db, goldapiNormal, () => panne ? sqPanne() : sqNormal());
  await traiter(requete({}), ENV, f, MAINTENANT);
  panne = true;
  await vieillir(20 / 60);
  const j = await (await traiter(requete({}), ENV, f, MAINTENANT)).json();
  assert.equal(sq.length, 2);
  assert.equal(appels.length, 0);                                           // pas de GoldAPI : le cours a 20 min
  assert.equal(Number(j.actuel.eur_g), Math.round(SQ_EUR_G * 10000) / 10000);
  assert.equal(j.actuel.source, SQ_SOURCE);
  assert.ok(j.alertes.includes('Cours non actualisé (Swissquote indisponible) : dernier cours connu affiché.'));
  // pause de 2 min après l'échec : pas d'acharnement
  await traiter(requete({ forcer: true }), ENV, f, MAINTENANT);
  assert.equal(sq.length, 2);
});

test('Swissquote en panne, dernier cours de plus d\'1 h : GoldAPI prend le relais (secours)', async () => {
  let panne = false;
  const { f, appels } = reseau(db, goldapiNormal, () => panne ? sqPanne() : sqNormal());
  await traiter(requete({}), ENV, f, MAINTENANT);
  panne = true;
  await vieillir(2);
  const j = await (await traiter(requete({}), ENV, f, MAINTENANT)).json();
  assert.deepEqual([...appels], ['/api/price/XAU/EUR']);
  assert.equal(Number(j.actuel.eur_g), 100.0012);
  assert.equal(j.actuel.source, 'GoldAPI.io — cours spot XAU/EUR');
  assert.deepEqual(j.alertes, []);
});

test('les deux sources en panne : dernier cours FIABLE conservé (jamais remplacé), alerte avec les raisons', async () => {
  let panne = false;
  const { f } = reseau(db, u => panne ? new Response('erreur', { status: 500 }) : goldapiNormal(u), () => panne ? sqPanne() : sqNormal());
  await traiter(requete({}), ENV, f, MAINTENANT);
  const avant = (await db.query(`select eur_g, releve_le from zeste.or_cours_actuel`)).rows[0];
  panne = true;
  await vieillir(5);
  const j = await (await traiter(requete({}), ENV, f, MAINTENANT)).json();
  assert.equal(Number(j.actuel.eur_g), Number(avant.eur_g));
  assert.ok(Date.parse(j.actuel.releve_le) < Date.now() - 4 * 3600_000);  // date du DERNIER relevé réussi, pas maintenant
  assert.ok(j.alertes.includes('Cours non actualisé (Swissquote indisponible, GoldAPI indisponible) : dernier cours connu affiché.'));
});

test('Swissquote : cotations incohérentes, figées, hors bornes ou sans heure → refusées', () => {
  const M = MAINTENANT;
  assert.throws(() => lireSwissquote([], M), /inattendue/);
  assert.throws(() => lireSwissquote({ erreur: 1 }, M), /inattendue/);
  assert.throws(() => lireSwissquote(sqCorps(M, [3110, 3300]), M), /incohérentes/);       // 6 % d'écart entre plateformes
  assert.throws(() => lireSwissquote(sqCorps(M - 5 * 86400_000), M), /figée/);            // flux arrêté depuis 5 jours
  assert.throws(() => lireSwissquote(sqCorps(M + 3600_000), M), /horodatage/);            // dans le futur
  assert.throws(() => lireSwissquote(sqCorps(0), M), /horodatage/);
  assert.throws(() => lireSwissquote(sqCorps(M, [5, 5.01]), M), /hors bornes/);
  assert.throws(() => lireSwissquote([{ ts: M, spreadProfilePrices: [{ bid: 10, ask: 9 }] }], M), /sans cotation/);
  // week-end : cotation du vendredi soir acceptée, avec SON heure (pas présentée comme actuelle)
  const vendredi = M - 40 * 3600_000;
  const c = lireSwissquote(sqCorps(vendredi), M);
  assert.equal(Date.parse(c.cote_le), vendredi);
  assert.equal(c.eur_g, SQ_EUR_G);
});

test('saut anormal (> 20 %) par rapport au dernier cours : refusé, dernier cours conservé', async () => {
  let fou = false;
  const { f } = reseau(db, goldapiNormal, () => OK(sqCorps(SQ_TS, fou ? [4000, 4000.1, 4000.2] : undefined)));
  await traiter(requete({}), ENV, f, MAINTENANT);
  fou = true;
  await vieillir(20 / 60);
  const j = await (await traiter(requete({}), ENV, f, MAINTENANT)).json();
  assert.equal(Number(j.actuel.eur_g), Math.round(SQ_EUR_G * 10000) / 10000);
  assert.ok(j.alertes.some(a => /Cours non actualisé/.test(a)));
  const d = (await db.query(`select detail from zeste.or_appels_api where not ok`)).rows[0].detail;
  assert.match(d, /écart anormal/);
});

test('plusieurs appareils en même temps (Swissquote) : un seul appel', async () => {
  const { f, sq } = reseau(db, goldapiNormal, async () => { await new Promise(r => setTimeout(r, 300)); return sqNormal(); });
  const rs = await Promise.all([1, 2, 3].map(() => traiter(requete({}), ENV, f, MAINTENANT)));
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200]);
  assert.equal(sq.length, 1);
  const j = await Promise.all(rs.map(r => r.json()));
  assert.ok(j.every(x => x.actuel && x.actuel.source === SQ_SOURCE));
});
