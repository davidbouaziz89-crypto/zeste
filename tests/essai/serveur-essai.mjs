// Serveur d'ESSAI local de Zeste (recette, captures d'écran, deux « appareils »).
// - sert index.html en remplaçant supabase-js par un bouchon et l'adresse du serveur par le local ;
// - base Postgres jetable en mémoire chargée avec TOUTE la chaîne sql/ (comme après la mise en ligne) ;
// - VRAIE edge function zeste-or-cours, branchée sur un FAUX GoldAPI (cours FICTIFS, marqués comme tels) ;
// - /ancienne.html = la version actuellement en ligne (origin/main), pour tester les anciens appareils.
// Aucune donnée réelle, aucune requête vers la production ni vers GoldAPI.
//
// Lancer : PGLITE_DIR=<dossier pglite> node --experimental-strip-types tests/essai/serveur-essai.mjs [port]
// ZESTE_BASE=correctif : base « production actuelle + correctif seul », à utiliser avec /correctif.html.
// Pilotage (GET) : /essai/decor (remise à zéro), /essai/panne?on=1|0 (fournisseur de cours en panne),
//   /essai/vieillir (cours relevé il y a 3 h), /essai/perdre?n=1 (la réponse des n prochains enregistrements
//   est perdue APRÈS l'écriture), /essai/coupure?on=1|0 (serveur injoignable), /essai/journal (diffusions temps réel, écritures)
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { nouvelleBase, creerUtilisateur, rpc, RACINE, DEJA_EN_PROD, lireSql } from '../or/pg-local.mjs';
import { traiter, ajouterJours } from '../../supabase/functions/zeste-or-cours/index.ts';

const PORT = Number(process.argv[2] || 8765);
const U = '44444444-4444-4444-8444-444444444444';
const SOURCE_ESSAI = 'Banc d\'essai — cours FICTIF';
let panne = false, coupure = false, aPerdre = 0;
const journal = { diffusions: 0, ecritures: [] };
const messages = [];   // relais du faux canal temps réel : { n, de, sujet, event, payload }

// ZESTE_BASE=correctif : base « production actuelle + correctif de sécurité seul » (pour /correctif.html)
const MODE = process.env.ZESTE_BASE || 'complet';
const db = MODE === 'correctif' ? await nouvelleBase([...DEJA_EN_PROD, 'zeste-correctif-securite.sql']) : await nouvelleBase();
await creerUtilisateur(db, U, 'essai@zeste.local');

// --- faux GoldAPI : courbe régulière fictive, sans les week-ends ---
function prixFictifG(jour){
  const t = (Date.parse(jour + 'T00:00:00Z') - Date.parse('2023-01-01T00:00:00Z')) / 86400000;
  return 54 + t * 0.042 + 2.2 * Math.sin(t / 37) + 1.1 * Math.sin(t / 9.3);   // €/g
}
function fauxGoldapi(u){
  if (panne) return new Response('panne simulée', { status: 503 });
  if (u.pathname === '/api/price/XAU/EUR') {
    const g = prixFictifG(new Date().toISOString().slice(0, 10)) + 0.37;
    return new Response(JSON.stringify({ currency: 'EUR', price: g * 31.1034768, timestamp: Math.floor(Date.now() / 1000), price_per_unit: { gram: g } }));
  }
  if (u.pathname === '/api/history/XAU/EUR') {
    const de = u.searchParams.get('from'), a = u.searchParams.get('to'), prices = [];
    for (let j = de; j <= a; j = ajouterJours(j, 1)) {
      const js = new Date(j + 'T00:00:00Z').getUTCDay();
      if (j >= '2023-01-01' && js !== 0 && js !== 6) prices.push({ date: j, price: Math.round(prixFictifG(j) * 31.1034768 * 100) / 100 });
    }
    return new Response(JSON.stringify({ metal: 'XAU', currency: 'EUR', from: de, to: a, prices }));
  }
  return new Response('?', { status: 404 });
}
const uidDe = (auth) => { const m = /^Bearer jeton-([0-9a-f-]{36})$/.exec(auth || ''); return m ? m[1] : null; };
const marquer = (nom, args) => {   // le cours enregistré par l'edge function est marqué FICTIF
  if (nom === 'zeste_or_cours_maj' && args.p) {
    if (args.p.actuel) args.p.actuel.source = SOURCE_ESSAI;
    (args.p.jours || []).forEach(j => { j.source = SOURCE_ESSAI; });
  }
  return args;
};
async function appelRpc(nom, args, auth){
  const uid = uidDe(auth);
  const qui = auth === 'Bearer cle-service' ? { role: 'service_role' } : uid ? { uid } : { role: 'anon' };
  return rpc(db, nom, marquer(nom, args), qui);
}
const fauxReseau = async (url, init = {}) => {
  const u = new URL(url), h = init.headers || {};
  if (u.pathname === '/auth/v1/user') return new Response('{}', { status: uidDe(h.Authorization) ? 200 : 401 });
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    try { const r = await appelRpc(u.pathname.split('/').pop(), JSON.parse(init.body || '{}'), h.Authorization); return new Response(r == null ? '' : JSON.stringify(r)); }
    catch (e) { return new Response(JSON.stringify({ message: e.message }), { status: 400 }); }
  }
  if (u.hostname === 'www.goldapi.io') return fauxGoldapi(u);
  throw new Error('requête externe refusée : ' + url);
};
const ENV = { SUPABASE_URL: 'http://local', ANON_KEY: 'cle-anon', SERVICE_KEY: 'cle-service', GOLDAPI_KEY: 'cle-fictive' };

// --- jeu d'essai (FICTIF) : listes du 30/10 + pièces d'or ---
async function decor(){
  await db.exec(`delete from zeste.user_data; delete from zeste.reminders; delete from zeste.push_subs;`);
  if (MODE === 'correctif') { journal.diffusions = 0; journal.ecritures = [];
    await rpc(db, 'zeste_save_mine', { p_data: JSON.parse(readFileSync(path.join(RACINE, 'tests/essai/fixture-fictive.json'), 'utf8')) }, { uid: U }); return; }
  await db.exec(`delete from zeste.or_lots; delete from zeste.or_cours_jour; delete from zeste.or_cours_actuel;
    delete from zeste.or_cours_meta; delete from zeste.or_appels_api;`);
  const fixture = JSON.parse(readFileSync(path.join(RACINE, 'tests/essai/fixture-fictive.json'), 'utf8'));
  await rpc(db, 'zeste_save_mine', { p_data: fixture }, { uid: U });   // écrit comme aujourd'hui (avant la v2)
  const lots = [
    { type: 'napoleon20', quantite: 10, date_achat: '2023-03-14', prix_total: 3650, frais: 25, millesime: 1912, vendeur: 'Comptoir fictif' },
    { type: 'louis_xvi', quantite: 1, date_achat: '2024-02-05', prix_total: 1150, commentaire: 'Belle patine' },
    { type: 'napoleon20', quantite: 5, date_achat: '2024-06-03', prix_total: 2225, frais: 18 },
    { type: 'souverain', quantite: 2, date_achat: '2025-01-20', prix_total: 1160 },
    { type: 'marianne_coq', quantite: 3, date_achat: '2025-09-10', prix_total: 1860, frais: 12 },
  ];
  const faits = [];
  for (const p of lots) faits.push(await rpc(db, 'zeste_or_lot_enregistrer', { p }, { uid: U }));
  await rpc(db, 'zeste_or_vente_enregistrer', { p: { lot_id: faits[0].id, quantite: 3, date_vente: '2025-04-22', prix_total: 1680, frais: 15 } }, { uid: U });
  journal.diffusions = 0; journal.ecritures = [];
}
await decor();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const adapter = (html) => html
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^"]*"><\/script>/, '<script src="/bouchon-supabase.js"></script>')
  .replace(/<script src="https:\/\/accounts\.google\.com\/gsi\/client"[^>]*><\/script>/, '')
  .replace("const SB_URL = 'https://api.srv.proformationplus.fr';", "const SB_URL = '';");
const pageApp = () => adapter(readFileSync(path.join(RACINE, 'index.html'), 'utf8'));
const pageAncienne = () => adapter(execFileSync('git', ['-C', RACINE, 'show', 'origin/main:index.html'], { encoding: 'utf8' }));
const pageCorrectif = () => adapter(execFileSync('git', ['-C', RACINE, 'show', 'origin/correctif-securite:index.html'], { encoding: 'utf8' }));
// version d'AVANT le correctif de sécurité (celle qu'une ancienne instance peut encore exécuter)
const pageAvantCorrectif = () => adapter(execFileSync('git', ['-C', RACINE, 'show', '9b8ed9a:index.html'], { encoding: 'utf8' }));
const BOUCHON = `
window.supabase = { createClient(){
  const U = { id: '${U}', email: 'essai@zeste.local' };
  const session = { access_token: 'jeton-' + U.id, user: U };
  const co = () => localStorage.getItem('bouchon_deconnecte') !== '1';
  const ec = [];
  const moi = Math.random().toString(36).slice(2), ecoute = [];
  let vu = 0, minuteur = null;
  const ch = { sujet: '',
    on(type, filtre, cb){ ecoute.push({ event: filtre && filtre.event, cb }); return ch; },
    subscribe(){ fetch('/essai/abonnement', {method:'POST'});
      minuteur = setInterval(async ()=>{ const l = await (await fetch('/essai/canal?apres='+vu)).json();
        l.forEach(m=>{ vu = Math.max(vu, m.n); if(m.de===moi || m.sujet!==ch.sujet) return; ecoute.filter(e=>e.event===m.event).forEach(e=>e.cb({ payload: m.payload })); }); }, 300);
      return ch; },
    send(m){ fetch('/essai/diffusion', { method:'POST', body: JSON.stringify(m) });
      fetch('/essai/canal', { method:'POST', body: JSON.stringify({ de: moi, sujet: ch.sujet, event: m.event, payload: m.payload }) }); } };
  return {
    auth: {
      onAuthStateChange(cb){ ec.push(cb); setTimeout(()=>cb(co()?'INITIAL_SESSION':'SIGNED_OUT', co()?session:null), 0); return { data:{ subscription:{ unsubscribe(){} } } }; },
      async getSession(){ return { data:{ session: co()?session:null } }; },
      async signInWithPassword(){ localStorage.removeItem('bouchon_deconnecte'); ec.forEach(cb=>cb('SIGNED_IN', session)); return { data:{ session, user:U }, error:null }; },
      async signOut(){ localStorage.setItem('bouchon_deconnecte','1'); ec.forEach(cb=>cb('SIGNED_OUT', null)); return { error:null }; },
    },
    async rpc(nom, args){
      try{ const r = await fetch('/rest/v1/rpc/'+nom, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+(co()?session.access_token:'anon') }, body: JSON.stringify(args||{}) });
        const t = await r.text(), j = t ? JSON.parse(t) : null;
        return r.ok ? { data:j, error:null } : { data:null, error: j || { message:'HTTP '+r.status } };
      }catch(e){ return { data:null, error:{ message: e.message } }; }
    },
    channel(nom){ ch.sujet = nom; return ch; }, removeChannel(){},
  };
} };`;

const lireCorps = (req) => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
const ok = (res, txt) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(typeof txt === 'string' ? txt : JSON.stringify(txt)); };
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://local');
  try {
    if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(pageApp()); }
    if (u.pathname === '/ancienne.html') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(pageAncienne()); }
    if (u.pathname === '/correctif.html') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(pageCorrectif()); }
    if (u.pathname === '/avant-correctif.html') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(pageAvantCorrectif()); }
    if (u.pathname === '/essai/canal' && req.method === 'POST') {   // n'importe qui (clé publique) diffuse sur un sujet
      const m = JSON.parse(await lireCorps(req) || '{}'); m.n = messages.length + 1; messages.push(m); return ok(res, { n: m.n }); }
    if (u.pathname === '/essai/canal') { const apres = Number(u.searchParams.get('apres') || 0); return ok(res, messages.filter(m => m.n > apres)); }
    if (u.pathname === '/essai/verrou-anciennes') {   // = sql/zeste-verrou-anciennes-versions.sql
      await db.exec(lireSql('zeste-verrou-anciennes-versions.sql')); return ok(res, 'anciennes versions verrouillées'); }
    if (u.pathname === '/bouchon-supabase.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end(BOUCHON); }
    if (u.pathname === '/sw.js') { res.writeHead(404); return res.end(); }       // pas de cache hors-ligne pendant l'essai
    if (u.pathname === '/essai/panne') { panne = u.searchParams.get('on') === '1'; return ok(res, { panne }); }
    if (u.pathname === '/essai/coupure') { coupure = u.searchParams.get('on') === '1'; return ok(res, { coupure }); }
    if (u.pathname === '/essai/perdre') { aPerdre = Number(u.searchParams.get('n') || 1); return ok(res, { aPerdre }); }
    if (u.pathname === '/essai/vieillir') { await db.exec(`update zeste.or_cours_actuel set releve_le = releve_le - interval '3 hours', cote_le = cote_le - interval '3 hours'`); return ok(res, 'vieilli'); }
    if (u.pathname === '/essai/decor') { await decor(); return ok(res, 'decor'); }
    if (u.pathname === '/essai/diffusion') { journal.diffusions++; await lireCorps(req); return ok(res, 'ok'); }
    if (u.pathname === '/essai/abonnement') { journal.abonnements = (journal.abonnements || 0) + 1; return ok(res, 'ok'); }
    if (u.pathname === '/essai/journal') {
      const srv = (await db.query(`select (to_jsonb(u)->>'rev')::bigint rev, (to_jsonb(u)->>'v2_only')::boolean v2_only, data from zeste.user_data u`)).rows[0];
      return ok(res, { ...journal, rev: srv && Number(srv.rev), v2_only: srv && srv.v2_only, serveur: srv && srv.data });
    }
    if (u.pathname.startsWith('/rest/v1/rpc/') || u.pathname.startsWith('/functions/v1/')) {
      if (coupure) { req.socket.destroy(); return; }                              // serveur injoignable
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const nom = u.pathname.split('/').pop(), corps = await lireCorps(req);
      try {
        const r = await appelRpc(nom, JSON.parse(corps || '{}'), req.headers.authorization);
        if (/^zeste_save_mine/.test(nom)) {
          journal.ecritures.push({ nom, rev: r });
          if (aPerdre > 0) { aPerdre--; req.socket.destroy(); return; }            // écrit, mais la réponse se perd
        }
        return ok(res, r == null ? '' : JSON.stringify(r));
      } catch (e) {
        if (/^zeste_save_mine/.test(nom)) journal.ecritures.push({ nom, refus: e.message });
        res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ message: e.message }));
      }
    }
    if (u.pathname === '/functions/v1/zeste-or-cours') {
      const corps = await lireCorps(req);
      const r = await traiter(new Request('http://local' + u.pathname, { method: req.method, headers: req.headers, body: req.method === 'POST' ? corps : undefined }), ENV, fauxReseau);
      res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(await r.text());
    }
    const f = path.join(RACINE, path.normalize(u.pathname).replace(/^\/+/, ''));
    if (f.startsWith(RACINE) && existsSync(f) && !f.includes('/sql/') && !f.includes('/tests/')) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); return res.end(readFileSync(f));
    }
    res.writeHead(404); res.end();
  } catch (e) { console.error(e); res.writeHead(500); res.end(String(e.message)); }
}).listen(PORT, '127.0.0.1', () => console.log('Zeste — essai sur http://127.0.0.1:' + PORT));
