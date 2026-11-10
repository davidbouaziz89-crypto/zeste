// Zeste 🍋 — Edge function « zeste-or-cours » : cours de l'or en euros par gramme d'or fin.
//
// Sources, dans l'ordre :
//   1. Swissquote (banque suisse) — cotation publique XAU/EUR en continu, sans clé
//      ni quota : milieu entre prix d'achat et prix de vente, converti en €/g.
//   2. GoldAPI.io en SECOURS (offre gratuite : 300 requêtes par mois civil, sans
//      carte bancaire), seulement si Swissquote ne répond pas. La clé reste sur le
//      serveur : coffre-fort Vault (secret « zeste_goldapi », lu par
//      zeste_or_cle_fournisseur, aucun redémarrage), ou la variable GOLDAPI_KEY.
//      Quota protégé (BUDGET_MOIS, MAX_APPELS_JOUR) : aucun risque de facturation.
//
// Ce que fait un appel (POST, utilisateur connecté obligatoire) :
//   1. cours actuel : redemandé au plus toutes les 15 min (cache serveur partagé
//      par tous les appareils) ; « Actualiser » : au plus une fois par minute ;
//   2. historique quotidien (GoldAPI) : seulement sur demande explicite ;
//   3. renvoie { actuel, historique, premier_jour, alertes } lu en base.
// Toute source en panne : on renvoie le dernier cours FIABLE connu (avec la date
// de son relevé) et une alerte — jamais de valeur inventée. Une cotation figée
// (plus de 4 jours) ou incohérente est refusée.
//
// Testé hors Deno par tests/or/edge.test.mjs (la logique est dans traiter()).

const ONCE_G = 31.1034768;          // une once troy en grammes
const FOURNISSEUR = "goldapi";
const SOURCE = "GoldAPI.io — cours spot XAU/EUR";
const API = "https://www.goldapi.io/api";
export const SQ_FOURNISSEUR = "swissquote";
export const SQ_SOURCE = "Swissquote — cotation XAU/EUR (milieu achat/vente)";
export const SQ_URL = "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/EUR";
export const BUDGET_MOIS = 280;            // quota gratuit GoldAPI 300 → marge de 20
export const TTL_ACTUEL_MS = 15 * 60_000;  // cours actuel : redemandé au plus toutes les 15 min (cache serveur partagé)
export const TTL_FORCE_MS = 60_000;        // bouton « Actualiser le cours » : au plus 1 appel par minute
export const TTL_SECOURS_MS = 3600_000;    // GoldAPI (secours) : seulement si le dernier cours a plus d'1 h
export const MAX_APPELS_JOUR = 9;          // GoldAPI : 280 / 31 jours, le quota mensuel ne peut pas être épuisé avant la fin du mois
const PAUSE_ECHEC_MS = 10 * 60_000;        // GoldAPI : après un échec, pause de 10 min
const PAUSE_ECHEC_SQ_MS = 2 * 60_000;      // Swissquote : après un échec, pause de 2 min
export const COTATION_MAX_AGE_MS = 4 * 86400_000; // cotation plus vieille (marché fermé > 4 j) = flux figé, refusée
const SAUT_MAX = 0.2;                      // écart > 20 % avec un cours relevé il y a moins de 3 jours = refusé
const TRANCHE_J = 90;                      // limite du fournisseur par requête
const MAX_TRANCHES_PASSE = 12;             // ≈ 3 ans de rattrapage par appel
export const ATTENTE_VERROU_MS = 1500;     // un autre appel actualise : on patiente avant de lire

type Env = { SUPABASE_URL: string; ANON_KEY: string; SERVICE_KEY: string; GOLDAPI_KEY?: string };
type Fetch = typeof fetch;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// dates AAAA-MM-JJ (jour de Paris)
export function jourParis(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(ms));
}
export function ajouterJours(jour: string, n: number): string {
  const d = new Date(jour + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const estJour = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

/* Réponse Swissquote : [{ ts, spreadProfilePrices:[{bid, ask}, …] }, …] (€ par once troy).
   Cours = médiane des milieux achat/vente ; refusé si les cotations divergent (> 1 %),
   si l'horodatage manque ou est dans le futur, ou si la valeur sort des bornes. */
export function lireSwissquote(j: unknown, maintenant: number): { eur_g: number; cote_le: string } {
  if (!Array.isArray(j) || !j.length) throw new Error("réponse Swissquote inattendue");
  const milieux: number[] = [];
  let ts = 0;
  for (const p of j as Array<{ ts?: number; spreadProfilePrices?: Array<{ bid?: number; ask?: number }> }>) {
    if (Number(p?.ts) > ts) ts = Number(p.ts);
    for (const q of (Array.isArray(p?.spreadProfilePrices) ? p.spreadProfilePrices : [])) {
      const b = Number(q?.bid), a = Number(q?.ask);
      if (b > 0 && a >= b) milieux.push((a + b) / 2);
    }
  }
  if (!milieux.length) throw new Error("réponse Swissquote sans cotation");
  milieux.sort((x, y) => x - y);
  if (milieux[milieux.length - 1] / milieux[0] - 1 > 0.01) throw new Error("cotations Swissquote incohérentes");
  const parGramme = milieux[Math.floor(milieux.length / 2)] / ONCE_G;
  if (!(parGramme > 10 && parGramme < 1000)) throw new Error("cours Swissquote hors bornes");
  if (!(ts > 0) || ts > maintenant + 10 * 60_000) throw new Error("horodatage Swissquote invalide");
  if (maintenant - ts > COTATION_MAX_AGE_MS) throw new Error("cotation Swissquote figée");
  return { eur_g: parGramme, cote_le: new Date(ts).toISOString() };
}

export async function traiter(req: Request, env: Env, f: Fetch = fetch, maintenant = Date.now()): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erreur: "méthode non autorisée" }, 405);

  // 1. Utilisateur connecté obligatoire : protège le quota et réserve l'accès à Zeste
  const jeton = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!jeton || jeton === env.ANON_KEY) return json({ erreur: "connexion requise" }, 401);
  const qui = await f(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { apikey: env.ANON_KEY, Authorization: `Bearer ${jeton}` } });
  if (!qui.ok) return json({ erreur: "connexion requise" }, 401);

  const corps = await req.json().catch(() => ({}));
  const forcer = corps?.forcer === true;
  // historique quotidien : seulement sur demande explicite (l'onglet Or n'a plus de graphique → aucune requête inutile)
  const avecHistorique = corps?.historique === true;
  const aujourdhui = jourParis(maintenant);
  let depuis = estJour(corps?.depuis) ? String(corps.depuis) : null;
  if (depuis && depuis > aujourdhui) depuis = aujourdhui;

  const rpc = async (nom: string, args: unknown, cle = env.SERVICE_KEY, porteur = env.SERVICE_KEY) => {
    const r = await f(`${env.SUPABASE_URL}/rest/v1/rpc/${nom}`, {
      method: "POST",
      headers: { apikey: cle, Authorization: `Bearer ${porteur}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`${nom} : HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  const journal = (p: Record<string, unknown>) => rpc("zeste_or_cours_maj", { p: { fournisseur: FOURNISSEUR, ...p } });

  const alertes: string[] = [];
  let verrou = false;
  try {
    // un seul rafraîchissement à la fois (plusieurs appareils / onglets au même instant)
    verrou = await rpc("zeste_or_cours_reserver", { p_secondes: 60 }) === true;
    if (!verrou) {
      await new Promise((r) => setTimeout(r, ATTENTE_VERROU_MS)); // l'autre appel est en train d'actualiser
      const lu = await rpc("zeste_or_cours_lire", { p_depuis: depuis }, env.ANON_KEY, jeton);
      return json({ ...lu, alertes });
    }
    const etat = await rpc("zeste_or_cours_etat", { p_fournisseur: FOURNISSEUR });
    const etatSq = await rpc("zeste_or_cours_etat", { p_fournisseur: SQ_FOURNISSEUR });
    // clé GoldAPI lue seulement si le secours ou l'historique en a besoin
    let cle: string | null | undefined = env.GOLDAPI_KEY || undefined;
    const lireCle = async () => {
      if (cle === undefined) cle = (await rpc("zeste_or_cle_fournisseur", {}).catch(() => null)) || null;
      return cle;
    };
    let appels = Number(etat?.appels_mois) || 0, appelsJour = Number(etat?.appels_jour) || 0;
    const meta = (etat?.meta || {}) as Record<string, string>;
    const echecRecent = etat?.dernier_echec && maintenant - Date.parse(etat.dernier_echec) < PAUSE_ECHEC_MS;
    const peutAppeler = () => !!cle && appels < BUDGET_MOIS && appelsJour < MAX_APPELS_JOUR && !echecRecent;
    const motifGoldApi = () => !cle ? "secours GoldAPI non configuré"
      : appels >= BUDGET_MOIS ? "quota GoldAPI du mois atteint"
      : appelsJour >= MAX_APPELS_JOUR ? "limite GoldAPI du jour atteinte"
      : echecRecent ? "GoldAPI indisponible il y a peu" : "GoldAPI indisponible";

    const appelGoldApi = async (chemin: string) => {
      appels++; appelsJour++;
      const r = await f(`${API}${chemin}`, { headers: { "x-access-token": cle!, Accept: "application/json" } });
      if (!r.ok) {
        // message du fournisseur (sans la clé) : distingue clé refusée et quota épuisé
        const m = (await r.text().catch(() => "")).replace(/[^\p{L}\p{N} .,:'()-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 120);
        const quota = /quota|limit/i.test(m) || r.status === 429;
        throw new Error(`GoldAPI HTTP ${r.status}${quota ? " (quota)" : r.status === 401 || r.status === 403 ? " (clé refusée)" : ""}${m ? " : " + m : ""}`);
      }
      return await r.json();
    };

    // 2. Cours actuel : Swissquote, puis GoldAPI en secours
    const precedent = etat?.actuel || null;
    const age = precedent?.releve_le ? maintenant - Date.parse(precedent.releve_le) : Infinity;
    // garde-fou : un saut de plus de 20 % par rapport à un cours relevé il y a moins de 3 jours est refusé
    const plausible = (eurG: number) => {
      if (precedent && Number(precedent.eur_g) > 0 && age < 3 * 86400_000 && Math.abs(eurG / Number(precedent.eur_g) - 1) > SAUT_MAX) {
        throw new Error(`écart anormal avec le dernier cours (${Number(precedent.eur_g).toFixed(2)} → ${eurG.toFixed(2)} €/g)`);
      }
    };
    if (age > TTL_ACTUEL_MS || (forcer && age > TTL_FORCE_MS)) {
      const raisons: string[] = [];
      let releve = false;
      const echecSq = etatSq?.dernier_echec && maintenant - Date.parse(etatSq.dernier_echec) < PAUSE_ECHEC_SQ_MS;
      if (echecSq) raisons.push("Swissquote indisponible il y a peu");
      else {
        try {
          const r = await f(SQ_URL, { headers: { Accept: "application/json" } });
          if (!r.ok) throw new Error(`Swissquote HTTP ${r.status}`);
          const c = lireSwissquote(await r.json(), maintenant);
          plausible(c.eur_g);
          await journal({ fournisseur: SQ_FOURNISSEUR, nature: "actuel", ok: true, actuel: { eur_g: c.eur_g, source: SQ_SOURCE, cote_le: c.cote_le } });
          releve = true;
        } catch (e) {
          await journal({ fournisseur: SQ_FOURNISSEUR, nature: "actuel", ok: false, detail: String((e as Error).message).slice(0, 200) }).catch(() => {});
          raisons.push("Swissquote indisponible");
        }
      }
      // secours GoldAPI : seulement si le dernier cours a plus d'1 h (quota gratuit limité)
      if (!releve && age > TTL_SECOURS_MS) {
        await lireCle();
        if (!peutAppeler()) raisons.push(motifGoldApi());
        else {
          try {
            const j = await appelGoldApi("/price/XAU/EUR");
            const parGramme = Number(j?.price_per_unit?.gram) > 0 ? Number(j.price_per_unit.gram) : Number(j?.price) / ONCE_G;
            if (!(parGramme > 0) || j?.currency !== "EUR") throw new Error("réponse GoldAPI inattendue");
            plausible(parGramme);
            const coteLe = Number(j.timestamp) > 0 ? new Date(Number(j.timestamp) * 1000).toISOString() : new Date(maintenant).toISOString();
            await journal({ nature: "actuel", ok: true, actuel: { eur_g: parGramme, source: SOURCE, cote_le: coteLe } });
            releve = true;
          } catch (e) {
            const msg = String((e as Error).message);
            await journal({ nature: "actuel", ok: false, detail: msg }).catch(() => {});
            raisons.push(/\(quota\)/.test(msg) ? "quota GoldAPI épuisé" : /clé refusée/.test(msg) ? "clé GoldAPI refusée" : "GoldAPI indisponible");
          }
        }
      }
      if (!releve) alertes.push(precedent ? `Cours non actualisé (${raisons.join(", ")}) : dernier cours connu affiché.` : `Cours indisponible (${raisons.join(", ")}).`);
    }

    // 3. Historique quotidien (prix GoldAPI = euros par once troy → converti en €/g)
    const tranche = async (de: string, a: string) => {
      const j = await appelGoldApi(`/history/XAU/EUR?from=${de}&to=${a}`);
      const jours = (Array.isArray(j?.prices) ? j.prices : [])
        .filter((p: { date?: string; price?: number }) => estJour(p?.date) && Number(p?.price) > 0)
        .map((p: { date: string; price: number }) => ({ jour: p.date, eur_g: Number(p.price) / ONCE_G, source: SOURCE }));
      await journal({ nature: "historique", ok: true, detail: `${de}..${a} : ${jours.length} jours`, jours });
      // plus ancien jour renvoyé (null si la tranche est vide)
      return jours.reduce((m: string | null, x: { jour: string }) => (!m || x.jour < m ? x.jour : m), null);
    };
    if (avecHistorique) await lireCle();
    try {
      // 3a. vers aujourd'hui : au plus une fois par jour, et seulement si l'historique est demandé
      if (avecHistorique && meta.histo_verifie_le !== aujourdhui && peutAppeler()) {
        let de = etat?.dernier_jour ? String(etat.dernier_jour) : ajouterJours(aujourdhui, -(TRANCHE_J - 1));
        while (de <= aujourdhui && peutAppeler()) {
          const a = [ajouterJours(de, TRANCHE_J - 1), aujourdhui].sort()[0];
          await tranche(de, a);
          de = ajouterJours(a, 1);
        }
        if (de > aujourdhui) await journal({ sans_appel: true, meta: { histo_verifie_le: aujourdhui } });
      }
      // 3b. vers le passé, jusqu'au premier achat
      const etat2 = await rpc("zeste_or_cours_etat", { p_fournisseur: FOURNISSEUR });
      const premier = etat2?.premier_jour ? String(etat2.premier_jour) : null;
      const videAvant = meta.histo_vide_avant || "0000-00-00";
      if (avecHistorique && depuis && premier && depuis < premier) {
        let a = ajouterJours(premier, -1), n = 0, connu = premier;
        while (a >= depuis && a > videAvant && n < MAX_TRANCHES_PASSE && peutAppeler()) {
          const de = [ajouterJours(a, -(TRANCHE_J - 1)), depuis].sort().reverse()[0];
          const plusAncien = await tranche(de, a);
          n++;
          if (!plusAncien) {
            // tranche vide : le fournisseur n'a rien avant le plus ancien jour connu → on ne redemandera plus
            await journal({ sans_appel: true, meta: { histo_vide_avant: ajouterJours(connu, -1) } });
            break;
          }
          if (plusAncien < connu) connu = plusAncien;
          a = ajouterJours(de, -1);
        }
      }
    } catch (e) {
      await journal({ nature: "historique", ok: false, detail: String((e as Error).message) }).catch(() => {});
      alertes.push("Historique du cours incomplet (fournisseur indisponible).");
    }

    // 4. Réponse : lue en base avec le jeton de l'utilisateur (même lecture que le secours du navigateur)
    const lu = await rpc("zeste_or_cours_lire", { p_depuis: depuis }, env.ANON_KEY, jeton);
    return json({ ...lu, alertes, budget: { appels_mois: appels, max: BUDGET_MOIS } });
  } catch (e) {
    console.error("zeste-or-cours", e);
    return json({ erreur: "cours indisponible", alertes }, 502);
  } finally {
    if (verrou) await rpc("zeste_or_cours_liberer", {}).catch(() => {});
  }
}

// @ts-ignore — Deno n'existe que dans le runtime des edge functions
if (typeof Deno !== "undefined") {
  // @ts-ignore
  const env: Env = { SUPABASE_URL: Deno.env.get("SUPABASE_URL")!, ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY")!,
    // @ts-ignore
    SERVICE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, GOLDAPI_KEY: Deno.env.get("GOLDAPI_KEY") || undefined };
  // @ts-ignore
  Deno.serve((req: Request) => traiter(req, env));
}
