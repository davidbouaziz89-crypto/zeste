// Zeste 🍋 — Edge function « zeste-or-cours » : cours de l'or en euros par gramme.
//
// Fournisseur : GoldAPI.io, offre GRATUITE (300 requêtes par mois civil, sans
// carte bancaire). La clé reste sur le serveur (secret GOLDAPI_KEY), jamais
// dans le navigateur. Au-delà du quota, GoldAPI refuse simplement : aucun
// risque de facturation. On garde de toute façon une marge (BUDGET_MOIS).
//
// Ce que fait un appel (POST, utilisateur connecté obligatoire) :
//   1. cours actuel : redemandé au fournisseur au plus toutes les 2 h
//      (15 min si on appuie sur « Actualiser ») ; sinon le dernier en base ;
//   2. historique quotidien : complété vers aujourd'hui (une fois par jour)
//      et vers le passé jusqu'à `depuis` (date du premier achat), par
//      tranches de 90 jours (limite du fournisseur) ;
//   3. renvoie { actuel, historique, premier_jour, alertes } lu en base.
// En cas de panne du fournisseur : on renvoie le dernier cours connu, avec
// une alerte — jamais de valeur inventée.
//
// Testé hors Deno par tests/or/edge.test.mjs (la logique est dans traiter()).

const ONCE_G = 31.1034768;          // une once troy en grammes
const FOURNISSEUR = "goldapi";
const SOURCE = "GoldAPI.io — cours spot XAU/EUR";
const API = "https://www.goldapi.io/api";
export const BUDGET_MOIS = 280;            // quota gratuit 300 → marge de 20
const TTL_ACTUEL_MS = 2 * 3600_000;        // cours actuel : 1 appel / 2 h au plus
const TTL_FORCE_MS = 15 * 60_000;          // « Actualiser » : 1 appel / 15 min au plus
const PAUSE_ECHEC_MS = 10 * 60_000;        // après un échec, pause de 10 min
const TRANCHE_J = 90;                      // limite du fournisseur par requête
const MAX_TRANCHES_PASSE = 12;             // ≈ 3 ans de rattrapage par appel

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
  try {
    const etat = await rpc("zeste_or_cours_etat", { p_fournisseur: FOURNISSEUR });
    let appels = Number(etat?.appels_mois) || 0;
    const meta = (etat?.meta || {}) as Record<string, string>;
    const echecRecent = etat?.dernier_echec && maintenant - Date.parse(etat.dernier_echec) < PAUSE_ECHEC_MS;
    const peutAppeler = () => !!env.GOLDAPI_KEY && appels < BUDGET_MOIS && !echecRecent;
    if (!env.GOLDAPI_KEY) alertes.push("Clé du fournisseur de cours non configurée sur le serveur.");
    else if (appels >= BUDGET_MOIS) alertes.push("Quota gratuit du mois atteint : dernier cours connu affiché.");
    else if (echecRecent) alertes.push("Fournisseur de cours indisponible il y a peu : dernier cours connu affiché.");

    const appelGoldApi = async (chemin: string) => {
      appels++;
      const r = await f(`${API}${chemin}`, { headers: { "x-access-token": env.GOLDAPI_KEY!, Accept: "application/json" } });
      if (!r.ok) throw new Error(`GoldAPI HTTP ${r.status}`);
      return await r.json();
    };

    // 2. Cours actuel
    const age = etat?.actuel?.releve_le ? maintenant - Date.parse(etat.actuel.releve_le) : Infinity;
    if ((age > TTL_ACTUEL_MS || (forcer && age > TTL_FORCE_MS)) && peutAppeler()) {
      try {
        const j = await appelGoldApi("/price/XAU/EUR");
        const parGramme = Number(j?.price_per_unit?.gram) > 0 ? Number(j.price_per_unit.gram) : Number(j?.price) / ONCE_G;
        if (!(parGramme > 0) || j?.currency !== "EUR") throw new Error("réponse GoldAPI inattendue");
        const coteLe = Number(j.timestamp) > 0 ? new Date(Number(j.timestamp) * 1000).toISOString() : new Date(maintenant).toISOString();
        await journal({ nature: "actuel", ok: true, actuel: { eur_g: parGramme, source: SOURCE, cote_le: coteLe } });
      } catch (e) {
        await journal({ nature: "actuel", ok: false, detail: String((e as Error).message) }).catch(() => {});
        alertes.push("Cours actuel indisponible : dernier cours connu affiché.");
      }
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
    try {
      // 3a. vers aujourd'hui : au plus une fois par jour
      if (meta.histo_verifie_le !== aujourdhui && peutAppeler()) {
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
      if (depuis && premier && depuis < premier) {
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
