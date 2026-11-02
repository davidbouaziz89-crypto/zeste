// Serveur d'ESSAI local de l'onglet Or (captures d'écran, essais à la main).
// - sert index.html en remplaçant supabase-js par un bouchon et l'adresse du serveur par le local ;
// - base Postgres jetable en mémoire (vrai sql/zeste-or.sql) ;
// - VRAIE edge function zeste-or-cours, branchée sur un FAUX GoldAPI (cours fictifs).
// Aucune donnée réelle, aucune requête vers la production ni vers GoldAPI.
//
// Lancer : PGLITE_DIR=<dossier pglite> node --experimental-strip-types tests/or/serveur-essai.mjs [port]
// Pilotage : GET /essai/panne?on=1|0 (fournisseur en panne), /essai/vieillir (cours relevé il y a 3 h),
//            /essai/vide (compte sans pièce), /essai/decor (jeu d'essai remis à zéro)
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { nouvelleBase, creerUtilisateur, rpc, RACINE } from './pg-local.mjs';
import { traiter, ajouterJours } from '../../supabase/functions/zeste-or-cours/index.ts';

const PORT = Number(process.argv[2] || 8765);
const U = '44444444-4444-4444-8444-444444444444';
const SOURCE_ESSAI = 'Banc d\'essai — cours FICTIF';
let panne = false;

const db = await nouvelleBase();
await creerUtilisateur(db, U, 'essai@zeste.local');

// --- faux GoldAPI : courbe régulière fictive (€ par once), sans les week-ends ---
function prixFictifG(jour){
  const t = (Date.parse(jour + 'T00:00:00Z') - Date.parse('2023-01-01T00:00:00Z')) / 86400000;
  return 54 + t * 0.042 + 2.2 * Math.sin(t / 37) + 1.1 * Math.sin(t / 9.3);   // €/g
}
function fauxGoldapi(u){
  if (panne) return new Response('panne simulée', { status: 503 });
  if (u.pathname === '/api/price/XAU/EUR') {
    const j = new Date().toISOString().slice(0, 10), g = prixFictifG(j) + 0.37;
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
// le cours enregistré par l'edge function est marqué FICTIF (pas de confusion possible sur les captures)
const marquer = (nom, args) => {
  if (nom === 'zeste_or_cours_maj' && args.p) {
    if (args.p.actuel) args.p.actuel.source = SOURCE_ESSAI;
    (args.p.jours || []).forEach(j => { j.source = SOURCE_ESSAI; });
  }
  return args;
};
async function appelRpc(nom, args, auth){
  const uid = uidDe(auth);
  const qui = auth === 'Bearer cle-service' ? { role: 'service_role' } : uid ? { uid } : { role: 'anon' };
  if (nom.startsWith('zeste_') && !nom.startsWith('zeste_or_')) return null; // synchro des autres onglets : sans objet ici
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

// --- jeu d'essai (FICTIF) ---
async function decor(){
  await db.exec(`delete from zeste.or_lots; delete from zeste.or_cours_jour; delete from zeste.or_cours_actuel; delete from zeste.or_cours_meta; delete from zeste.or_appels_api;`);
  const lots = [
    { type: 'napoleon20', quantite: 10, date_achat: '2023-03-14', prix_total: 3650, frais: 25, millesime: 1912, vendeur: 'Comptoir de Paris' },
    { type: 'louis_xvi', quantite: 1, date_achat: '2024-02-05', prix_total: 1150, commentaire: 'Belle patine' },
    { type: 'napoleon20', quantite: 5, date_achat: '2024-06-03', prix_total: 2225, frais: 18 },
    { type: 'souverain', quantite: 2, date_achat: '2025-01-20', prix_total: 1160 },
    { type: 'marianne_coq', quantite: 3, date_achat: '2025-09-10', prix_total: 1860, frais: 12 },
  ];
  const faits = [];
  for (const p of lots) faits.push(await rpc(db, 'zeste_or_lot_enregistrer', { p }, { uid: U }));
  await rpc(db, 'zeste_or_vente_enregistrer', { p: { lot_id: faits[0].id, quantite: 3, date_vente: '2025-04-22', prix_total: 1680, frais: 15 } }, { uid: U });
}
await decor();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function pageApp(){
  return readFileSync(path.join(RACINE, 'index.html'), 'utf8')
    .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js[^"]*"><\/script>/, '<script src="/bouchon-supabase.js"></script>')
    .replace(/<script src="https:\/\/accounts\.google\.com\/gsi\/client"[^>]*><\/script>/, '')
    .replace("const SB_URL = 'https://api.srv.proformationplus.fr';", "const SB_URL = '';");
}
const BOUCHON = `
window.supabase = { createClient(){
  const U = { id: '${U}', email: 'essai@zeste.local' };
  const session = { access_token: 'jeton-' + U.id, user: U };
  const co = () => localStorage.getItem('bouchon_deconnecte') !== '1';
  const ec = [];
  const ch = { on(){ return ch; }, subscribe(){ return ch; }, send(){} };
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
    channel(){ return ch; }, removeChannel(){},
  };
} };`;

const lireCorps = (req) => new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://local');
  try {
    if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(pageApp()); }
    if (u.pathname === '/bouchon-supabase.js') { res.writeHead(200, { 'Content-Type': TYPES['.js'] }); return res.end(BOUCHON); }
    if (u.pathname === '/sw.js') { res.writeHead(404); return res.end(); } // pas de cache hors-ligne pendant l'essai
    if (u.pathname === '/essai/panne') { panne = u.searchParams.get('on') === '1'; res.writeHead(200); return res.end('panne=' + panne); }
    if (u.pathname === '/essai/vide') { await db.exec('delete from zeste.or_lots'); res.writeHead(200); return res.end('vide'); }
    if (u.pathname === '/essai/decor') { await decor(); res.writeHead(200); return res.end('decor'); }
    if (u.pathname === '/essai/vieillir') { await db.exec(`update zeste.or_cours_actuel set releve_le = releve_le - interval '3 hours', cote_le = cote_le - interval '3 hours'`); res.writeHead(200); return res.end('vieilli'); }
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const corps = await lireCorps(req);
      try { const r = await appelRpc(u.pathname.split('/').pop(), JSON.parse(corps || '{}'), req.headers.authorization);
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(r == null ? '' : JSON.stringify(r)); }
      catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ message: e.message })); }
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
}).listen(PORT, '127.0.0.1', () => console.log('Zeste Or — essai sur http://127.0.0.1:' + PORT));
