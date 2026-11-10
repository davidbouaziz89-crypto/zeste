// Contrôle RÉEL de la source principale du cours : la vraie fonction zeste-or-cours (traiter)
// interroge la VRAIE cotation publique Swissquote ; la base est une base locale jetable (pglite).
// Rien n'est écrit ailleurs, aucune clé n'est utilisée (GoldAPI désactivé : pas de clé).
// Lancer : PGLITE_DIR=<dossier pglite> node --experimental-strip-types tests/or/test-swissquote-reel.mjs
import assert from 'node:assert/strict';
import { nouvelleBase, creerUtilisateur, rpc } from './pg-local.mjs';
import { traiter, SQ_SOURCE } from '../../supabase/functions/zeste-or-cours/index.ts';

const U = '66666666-6666-4666-8666-666666666666';
const db = await nouvelleBase();
await creerUtilisateur(db, U, 'reel@test.local');
let appelsSq = 0;
const f = async (url, init = {}) => {
  const u = new URL(url), h = init.headers || {};
  if (u.pathname === '/auth/v1/user') return new Response('{}', { status: 200 });
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    const qui = h.Authorization === 'Bearer cle-service' ? { role: 'service_role' } : { uid: U };
    const r = await rpc(db, u.pathname.split('/').pop(), JSON.parse(init.body || '{}'), qui);
    return new Response(r == null ? '' : JSON.stringify(r));
  }
  if (u.hostname === 'forex-data-feed.swissquote.com') { appelsSq++; return fetch(url, init); }   // VRAI réseau
  throw new Error('requête refusée : ' + url);
};
const ENV = { SUPABASE_URL: 'http://local', ANON_KEY: 'anon', SERVICE_KEY: 'cle-service' };
const req = (corps) => new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer jeton' }, body: JSON.stringify(corps) });
const r = await traiter(req({}), ENV, f);
const j = await r.json();
assert.equal(r.status, 200);
assert.equal(appelsSq, 1);
assert.deepEqual(j.alertes, []);
assert.equal(j.actuel.source, SQ_SOURCE);
const g = Number(j.actuel.eur_g);
assert.ok(g > 40 && g < 400, 'cours hors de toute vraisemblance : ' + g);
const ageCote = (Date.now() - Date.parse(j.actuel.cote_le)) / 60000;
console.log(`Cours réel : ${g.toFixed(4)} €/g d'or fin — ${(g * 31.1034768).toFixed(2)} €/once — source « ${j.actuel.source} »`);
console.log(`Coté le ${new Date(j.actuel.cote_le).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })} (il y a ${ageCote.toFixed(1)} min), relevé le ${new Date(j.actuel.releve_le).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);
// 2e appel immédiat : servi par le cache (aucun nouvel appel)
await traiter(req({}), ENV, f);
assert.equal(appelsSq, 1);
console.log('Cache : 2e appel servi sans requête au fournisseur ✔');
console.log(`Exemple : 50 pesos (37,5 g) = ${(37.5 * g).toFixed(2)} € de valeur métal ; Napoléon 20 F (5,8064 g) = ${(5.8064 * g).toFixed(2)} €`);
