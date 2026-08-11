# 🔔 Activer les notifications push (brique 2) — 3 étapes

> ⚠️ **PÉRIMÉ depuis la migration du 2026-08-11.** Ce document décrit la
> procédure sur le Supabase **managé** (`lrslisyydbiejqzpsoxc`), qui n'est plus
> la production. Le backend est désormais auto-hébergé :
> `https://api.srv.proformationplus.fr`, stack dans `/opt/supabase` sur le
> serveur Hetzner. Les secrets ne se posent plus par la CLI `supabase secrets`
> mais dans `/opt/supabase/functions.env`, et la tâche planifiée `zeste-push`
> tourne déjà en pg_cron sur le serveur (chaque minute).
>
> **Point à vérifier** : la paire VAPID a été régénérée pendant la migration.
> Si `zeste-push` signe avec la clé de `functions.env`, la constante
> `VAPID_PUBLIC` d'`index.html` doit valoir la même clé publique, sinon les
> abonnements iPhone échoueront silencieusement.

Tout le code est prêt. Il reste à créer les tables, déployer la fonction serveur, et
programmer l'envoi automatique. ~5 minutes, en copier-coller.

## Étape 1 — Créer les tables (éditeur SQL)
Ouvre https://supabase.com/dashboard/project/lrslisyydbiejqzpsoxc/sql/new
Copie tout le contenu de **`sql/zeste-push.sql`**, colle, **Run**. → "Success".

## Étape 2 — Déployer la fonction serveur (Terminal)
Dans le Terminal du Mac :

```bash
cd ~/projects/zeste
# enregistre les clés secrètes (VAPID + secret cron) comme secrets de la fonction
supabase secrets set --project-ref lrslisyydbiejqzpsoxc --env-file vapid.local.txt
# déploie la fonction
supabase functions deploy zeste-push --project-ref lrslisyydbiejqzpsoxc --no-verify-jwt
```

Tu dois voir "Deployed Function zeste-push".

## Étape 3 — Programmer l'envoi chaque minute (éditeur SQL)
Toujours dans l'éditeur SQL, copie le contenu de **`sql/zeste-cron.sql`** (il est sur
ton Mac, il contient déjà le secret), colle, **Run**.
> Si `create extension pg_cron` / `pg_net` renvoie une erreur de droits, va d'abord
> dans Database → Extensions et active **pg_cron** et **pg_net**, puis relance.

## ✅ Tester
1. Installe l'appli sur l'iPhone (Safari → Partager → Sur l'écran d'accueil) — **obligatoire** pour les push iOS.
2. Ouvre-la, autorise les notifications, et assure-toi d'avoir un **foyer partagé** actif (⚙️).
3. Crée une tâche avec un rappel **dans 2-3 minutes**.
4. **Ferme l'appli / verrouille le téléphone** → la notif doit arriver à l'heure. 🎉
