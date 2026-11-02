# Mise en ligne de la version consolidée (branche `integration-zeste`)

**Rien n'est fait tant que David n'a pas donné deux accords distincts :**
**(1) les migrations de la base, (2) la publication de l'appli.** La clé GoldAPI est
ajoutée par David lui-même (fichier à double-cliquer), jamais collée dans une conversation.

## État de départ constaté (production, lecture seule, 02/11/2026)

- Schéma `zeste` : `user_data` (1 compte, colonnes `user_id, data, updated_at`), `spaces` (2 foyers de juillet),
  `push_subs` (2), `reminders` (0). RLS active partout, aucun droit direct sur les tables.
- `sql/zeste-remboursements.sql` **déjà appliqué** (contrôle des remboursements dans `zeste_save_mine`).
- Synchro v2, sécurité, onglet Or : **absents**.
- Fonctions serveur `zeste-push` et `zeste-suggest` : identiques à `main`. `CRON_SECRET` présent, `GOLDAPI_KEY` absent.
- Temps réel : canaux publics autorisés (réglage commun à toutes les apps : **on n'y touche pas**).

## Ordre et pourquoi

1. **Base d'abord** (`zeste-sync-v2.sql` → `zeste-securite.sql` → `zeste-or.sql`). L'appli actuellement en ligne
   continue de fonctionner tant qu'aucun appareil à jour n'a écrit (testé : `tests/sync/serveur.test.mjs`).
2. **Puis l'appli** (fusion dans `main` → GitHub Pages). Elle détecte seule la v2.
3. **Puis les fonctions serveur** `zeste-or-cours` (nouvelle) et `zeste-suggest` (réservée aux comptes connectés :
   à déployer APRÈS l'appli, l'ancienne appli n'envoie pas la session).
4. **Clé GoldAPI** quand David l'a ajoutée, puis redémarrage court du conteneur des fonctions (toutes les apps,
   quelques secondes, à un moment calme).

## Étapes (exécutées par Claude, une seule conversation sur la base et le serveur)

0. Demander à David si une autre conversation travaille sur la base ou le serveur. Sinon, ne pas commencer.
1. **Sauvegarde** sur le serveur : `pg_dump -n zeste` (structure + données) et copie de
   `/opt/supabase/volumes/functions/zeste-*` dans `~/sauvegardes/zeste-<date>/`. Noter l'empreinte md5 de
   `zeste.user_data.data` (contrôle d'intégrité).
2. **Verrou de déploiement** (base partagée) : `outils/verrou-deploiement.sh etat` puis
   `prendre "zeste" "sync-v2 + securite + or" 30` (dépôt comptes-engco) ; `set deploiement.jeton = '<JETON>';`
   en tête de chaque session psql ; `rendre <JETON>` à la fin, même en cas d'échec.
3. **Essai à blanc** de chaque script dans `begin … rollback` (pour `zeste-sync-v2.sql`, neutraliser son
   `begin/commit` comme `tests/sync/test-migration.sh`).
4. **Application** dans l'ordre, puis vérifications :
   - aucune fonction `zeste%` exécutable par `anon` ;
   - `to_regprocedure('public.zeste_rev_mine()')`, `…zeste_save_mine_v2(jsonb,bigint)`, `…zeste_or_lire()` non nuls ;
   - md5 de `zeste.user_data.data` **identique** à l'étape 1, `rev` = 0, `v2_only` = false.
5. **Publication** (accord n° 2) : fusion de `integration-zeste` dans `main`, envoi. Contrôle en ligne :
   la page servie contient `zeste_rev_mine` ; connexion de David → « Synchronisé » ; `v2_only` passe à true
   après sa première modification.
6. **Fonctions** : copie de `supabase/functions/zeste-or-cours/` et `zeste-suggest/` dans
   `/opt/supabase/volumes/functions/`. Test : `zeste-suggest` refuse sans session (401), accepte avec.
7. **Clé GoldAPI** : David double-clique `outils/ajouter-cle-goldapi.command` → message « clé GoldAPI ajoutée ».
   Puis `docker compose up -d functions` (recrée le conteneur avec la clé). Test : onglet Or →
   source « GoldAPI.io — cours spot XAU/EUR », plus d'alerte. Le quota est suivi dans `zeste.or_appels_api`.

## Retour arrière (du plus léger au plus lourd)

| Problème | Action | Données |
|---|---|---|
| Appli | `git revert` de la fusion sur `main` (retour à 9b8ed9a) | aucune perte |
| Onglet Or | `sql/zeste-or-retour.sql` (coupe l'accès) | conservées |
| Fermeture des accès | `sql/zeste-securite-retour.sql` (remet aussi la faille) | aucune perte |
| Synchro v2 | `sql/zeste-sync-v2-retour.sql` (après le précédent) | aucune perte |
| Données abîmées | restaurer la ligne `zeste.user_data` depuis la sauvegarde de l'étape 1 | retour à l'instant T |

Les retours arrière sont testés sur base locale (`tests/sync/serveur.test.mjs`, test 1).

## Risques résiduels connus

- Un appareil resté ouvert sur l'**ancienne version** écoute encore l'ancien canal public jusqu'à sa
  réouverture : il n'y reçoit plus rien (plus personne n'y diffuse) ; un faux état injecté par un tiers
  s'afficherait sur cet appareil mais **ne pourrait pas être enregistré** (refus serveur v2).
- Les 2 foyers de juillet (`zeste.spaces`) restent en base, devenus inaccessibles : à supprimer plus tard si David le souhaite.
- Conflit entre deux appareils : pas de fusion automatique, David choisit une version, l'autre est gardée
  en copie de secours restaurable (⚙️ Réglages).
- GoldAPI gratuit : CGU sans limite de durée ni restriction à l'évaluation (lues le 02/11/2026), mention
  « for evaluation » dans leur documentation technique (WebSocket). Alternative prête à étudier : MetalpriceAPI.
