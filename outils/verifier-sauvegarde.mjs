// Zeste 🍋 — vérifie qu'une sauvegarde (zeste.sql produit par outils/sauvegarde-zeste.sh) se RECHARGE
// réellement et redonne exactement les mêmes données : rechargement dans une base jetable en mémoire
// (pglite, Postgres 17 comme la production), puis comparaison avec empreintes.txt.
// Usage : PGLITE_DIR=<dossier pglite> node outils/verifier-sauvegarde.mjs <dossier de la sauvegarde>
// Le dossier peut être supprimé ensuite (il contient des données personnelles).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage : node outils/verifier-sauvegarde.mjs <dossier>'); process.exit(2); }
const req = createRequire(path.join(process.env.PGLITE_DIR, 'package.json'));
const { PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href);
const db = new PGlite();
// socle minimal : rôles et auth.users (clés étrangères), comme sur Supabase
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create role supabase_admin nologin; create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
let sql = readFileSync(path.join(dir, 'zeste.sql'), 'utf8')
  .split('\n').filter(l => !/^\\(un)?restrict /.test(l)).join('\n');   // lignes propres à pg_dump 17
const attendu = readFileSync(path.join(dir, 'empreintes.txt'), 'utf8').trim().split('\n').map(l => l.split(' '));
for (const [, id] of attendu.filter(x => x[0] === 'compte')) await db.query('insert into auth.users(id) values ($1)', [id]);
await db.exec(sql);
let ok = 0, ko = 0;
for (const [type, cle, val] of attendu) {
  const obtenu = type === 'table'
    ? String((await db.query(`select count(*)::int n from zeste.${cle}`)).rows[0].n)
    : (await db.query(`select md5(data::text) h from zeste.user_data where user_id = $1`, [cle])).rows[0]?.h;
  const bon = obtenu === (val ?? '');
  bon ? ok++ : ko++;
  console.log(`${bon ? 'OK   ' : 'ÉCART'} ${type === 'compte' ? 'données du compte' : 'lignes ' + cle} : ${type === 'compte' ? (bon ? 'empreinte identique' : obtenu + ' ≠ ' + val) : obtenu + (bon ? '' : ' ≠ ' + val)}`);
}
console.log(ko ? `❌ sauvegarde NON conforme (${ko} écart(s))` : `✅ sauvegarde rechargée et identique (${ok} contrôles)`);
process.exit(ko ? 1 : 0);
