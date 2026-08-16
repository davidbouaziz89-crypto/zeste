// Zeste 🍋 — Edge function : suggestions de films/séries en langage naturel.
// Reçoit une demande libre et renvoie ~8 titres réels via Mistral (mistral-small-latest, gratuit).
// Appelée depuis le navigateur (github.io) avec l'entête apikey = clé anon.
// Pas de vérification JWT (FUNCTIONS_VERIFY_JWT=false côté serveur), comme zeste-push.

const MISTRAL_API_KEY = Deno.env.get("MISTRAL_API_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Nettoie la réponse du modèle : retire les fences ```json … ``` et isole le tableau JSON.
function extractJsonArray(raw: string): unknown[] {
  let s = (raw ?? "").trim();
  // Retire les fences markdown éventuelles
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  // Isole le premier tableau JSON présent
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  const parsed = JSON.parse(s);
  return Array.isArray(parsed) ? parsed : [];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ items: [] }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body?.q ?? "").trim();
    const kind = ["movie", "tv", "any"].includes(body?.kind) ? body.kind : "any";

    if (!q) return json({ items: [] });

    const contrainte =
      kind === "movie"
        ? "Ne propose QUE des films (type = \"movie\")."
        : kind === "tv"
          ? "Ne propose QUE des séries (type = \"tv\")."
          : "Tu peux mélanger films (type = \"movie\") et séries (type = \"tv\").";

    const systemPrompt =
      "Tu es un expert en cinéma et séries. À partir d'une demande en langage naturel, " +
      "tu recommandes des œuvres RÉELLES et CONNUES qui correspondent vraiment à la demande. " +
      "Tu réponds UNIQUEMENT par un tableau JSON valide d'environ 8 objets, sans aucun texte autour, " +
      "sans balise markdown. Chaque objet a exactement les clés : " +
      '"title" (titre en français quand il existe), "year" (année de sortie, chaîne à 4 chiffres), ' +
      '"type" ("movie" ou "tv"), "reason" (une phrase courte en français expliquant pourquoi ça colle à la demande). ' +
      contrainte;

    const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        temperature: 0.6,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: q },
        ],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return json({ items: [], error: `Mistral ${resp.status}`, detail });
    }

    const data = await resp.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";

    let arr: unknown[] = [];
    try {
      arr = extractJsonArray(content);
    } catch {
      return json({ items: [] });
    }

    const items = arr
      .map((o) => {
        const r = o as Record<string, unknown>;
        const type = r?.type === "tv" ? "tv" : "movie";
        return {
          title: String(r?.title ?? "").trim(),
          year: String(r?.year ?? "").trim(),
          type,
          reason: String(r?.reason ?? "").trim(),
        };
      })
      .filter((x) => x.title)
      .filter((x) => (kind === "any" ? true : x.type === kind));

    return json({ items });
  } catch (e) {
    return json({ items: [], error: String(e) });
  }
});
