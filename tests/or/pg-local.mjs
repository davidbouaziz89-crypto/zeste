// Banc d'essai de l'onglet Or : base Postgres LOCALE et jetable (pglite, en mémoire).
// Jamais la production. Charge un prélude qui imite Supabase (rôles anon /
// authenticated / service_role, auth.uid(), privilèges par défaut sur public)
// puis le VRAI sql/zeste-or.sql.
//
// pglite n'est pas une dépendance de l'appli : on l'installe à part
// (ex. `bun add @electric-sql/pglite@0.5.9` dans un dossier temporaire) et on
// passe son dossier dans PGLITE_DIR. Lancer avec node (pas bun) : voir README des tests.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const ici = path.dirname(fileURLToPath(import.meta.url));
export const RACINE = path.resolve(ici, '../..');

async function chargerPGlite(){
  const dir = process.env.PGLITE_DIR;
  if(!dir) throw new Error('PGLITE_DIR manquant (dossier contenant node_modules/@electric-sql/pglite)');
  const req = createRequire(path.join(dir, 'package.json'));
  const entree = req.resolve('@electric-sql/pglite');
  return (await import(pathToFileURL(entree).href)).PGlite;
}

const PRELUDE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- comme Supabase : toute nouvelle fonction de public est exécutable par anon/authenticated
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create schema zeste;
  grant usage on schema zeste to anon, authenticated, service_role;
`;

// Scripts dans l'ordre de la production : déjà appliqués (état constaté le 02/11/2026), puis à venir.
// (le correctif de sécurité est en production depuis le 02/11/2026 à 20 h 10)
export const AVANT_CORRECTIF = ['zeste-setup.sql', 'zeste-push.sql', 'zeste-auth.sql', 'zeste-remboursements.sql'];
export const DEJA_EN_PROD = [...AVANT_CORRECTIF, 'zeste-correctif-securite.sql'];
// (sync-v2, securite et or sont en production depuis le 03/11/2026 ; le catalogue vient ensuite)
export const A_APPLIQUER = ['zeste-sync-v2.sql', 'zeste-securite.sql', 'zeste-or.sql', 'zeste-or-catalogue.sql'];
export const lireSql = (f) => readFileSync(path.join(RACINE, 'sql', f), 'utf8');

// etapes : liste de scripts sql/ à charger (par défaut : toute la chaîne, comme après la mise en ligne)
export async function nouvelleBase(etapes = [...DEJA_EN_PROD, ...A_APPLIQUER]){
  const PGlite = await chargerPGlite();
  const db = new PGlite();
  await db.exec(PRELUDE);
  for (const f of etapes) await db.exec(lireSql(f));
  return db;
}

export async function creerUtilisateur(db, id, email){
  await db.query('insert into auth.users(id, email) values ($1, $2) on conflict do nothing', [id, email]);
}

// Exécute une requête « comme » un rôle donné (et un utilisateur connecté si uid).
export async function comme(db, { role = 'authenticated', uid = null } = {}, requete, params = []){
  const claims = JSON.stringify(uid ? { sub: uid, role } : { role });
  await db.exec(`begin; set local role ${role}; select set_config('request.jwt.claims', '${claims.replace(/'/g, "''")}', true);`);
  try{
    const r = await db.query(requete, params);
    await db.exec('commit');
    return r.rows;
  }catch(e){
    await db.exec('rollback');
    throw e;
  }
}

// Appel RPC à la manière de PostgREST : arguments nommés, résultat scalaire.
export async function rpc(db, nom, args = {}, qui = {}){
  if(!/^[a-z_][a-z0-9_]*$/.test(nom)) throw new Error('nom de fonction invalide');
  const cles = Object.keys(args);
  cles.forEach(k=>{ if(!/^[a-z_][a-z0-9_]*$/.test(k)) throw new Error('argument invalide'); });
  const vals = cles.map(k=>{ const v = args[k]; return (v !== null && typeof v === 'object') ? JSON.stringify(v) : v; });
  const rows = await comme(db, qui, `select public.${nom}(${cles.map((k,i)=>`${k} => $${i+1}`).join(', ')}) as r`, vals);
  return rows[0] ? rows[0].r : null;
}
