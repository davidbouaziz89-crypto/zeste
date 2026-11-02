// Edge function zeste-or-cours, branchée sur la base locale jetable (vrai SQL)
// et sur un faux GoldAPI. Aucune requête réseau réelle.
// Lancer : PGLITE_DIR=<dossier pglite> node --experimental-strip-types --test tests/or/edge.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { nouvelleBase, creerUtilisateur, rpc } from './pg-local.mjs';
import { traiter, BUDGET_MOIS, MAX_APPELS_JOUR, jourParis, ajouterJours } from '../../supabase/functions/zeste-or-cours/index.ts';

const U = '33333333-3333-4333-8333-333333333333';
const ENV = { SUPABASE_URL: 'http://kong', ANON_KEY: 'cle-anon', SERVICE_KEY: 'cle-service', GOLDAPI_KEY: 'cle-goldapi' };
// même horloge que la base (now() de Postgres sert à dater les relevés et le journal)
const MAINTENANT = Date.now();

// faux réseau : auth + PostgREST (rejoués sur pglite) + GoldAPI simulé
function reseau(db, goldapi){
  const appels = [];
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
    if (u.hostname === 'www.goldapi.io') {
      assert.equal(h['x-access-token'], 'cle-goldapi');
      appels.push(u.pathname + u.search);
      return goldapi(u);
    }
    throw new Error('requête inattendue ' + url);
  };
  return { f, appels };
}
const OK = (corps) => new Response(JSON.stringify(corps), { status: 200 });
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
const vieillir = (h) => db.query(`update zeste.or_cours_actuel set releve_le = releve_le - make_interval(hours => $1)`, [h]);

let db;
test.beforeEach(async () => { db = await nouvelleBase(); await creerUtilisateur(db, U, 'u@test.local'); });

test('refuse sans connexion (protège le quota)', async () => {
  const { f, appels } = reseau(db, goldapiNormal);
  assert.equal((await traiter(requete({}, 'cle-anon'), ENV, f, MAINTENANT)).status, 401);
  assert.equal((await traiter(requete({}, 'faux'), ENV, f, MAINTENANT)).status, 401);
  assert.equal(appels.length, 0);
});

test('historique sur demande explicite : rattrapé depuis la date demandée ; cache 3 h ; « Actualiser » au plus 1 fois par heure', async () => {
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
  assert.ok(j.alertes.some(a => /Quota/.test(a)));
  assert.equal(j.actuel, null);
});

test('clé absente sur le serveur : aucun appel, alerte', async () => {
  const { f, appels } = reseau(db, goldapiNormal);
  const j = await (await traiter(requete({}), { ...ENV, GOLDAPI_KEY: undefined }, f, MAINTENANT)).json();
  assert.equal(appels.length, 0);
  assert.ok(j.alertes.some(a => /non configurée/.test(a)));
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
  assert.ok(j.alertes.some(a => /Limite d'actualisations du jour/.test(a)));
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
  assert.ok(j.alertes.some(x => /Cours indisponible \(clé GoldAPI refusée\)/.test(x)));
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
