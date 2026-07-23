// Zeste 🍋 — Edge function : envoie les notifications push des rappels arrivés à échéance.
// Appelée chaque minute par un cron (pg_cron + pg_net). Voir sql/zeste-cron.sql.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contact@example.com";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: "zeste" } });

Deno.serve(async (req) => {
  // Protection simple : le cron doit fournir le bon secret
  if (CRON_SECRET && req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const now = Date.now();
  const { data: due, error } = await db
    .from("reminders")
    .select("household_id, todo_id, txt, emoji, due_ms")
    .eq("pushed", false)
    .lte("due_ms", now)
    .limit(200);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  if (!due || due.length === 0) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

  let sent = 0;
  for (const r of due) {
    const { data: subs } = await db
      .from("push_subs")
      .select("endpoint, sub")
      .eq("household_id", r.household_id);

    const payload = JSON.stringify({
      title: "🔔 " + (r.emoji ? r.emoji + " " : "") + (r.txt ?? "Rappel"),
      body: "C'est l'heure ! (Zeste 🍋)",
    });

    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification(s.sub, payload);
        sent++;
      } catch (e) {
        // abonnement expiré / invalide -> on le supprime
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await db.from("push_subs").delete().eq("endpoint", s.endpoint);
        }
      }
    }
    // marque le rappel comme envoyé
    await db.from("reminders").update({ pushed: true })
      .eq("household_id", r.household_id).eq("todo_id", r.todo_id);
  }

  return new Response(JSON.stringify({ sent, reminders: due.length }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
