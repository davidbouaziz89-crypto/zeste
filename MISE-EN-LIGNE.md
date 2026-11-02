# Mise en ligne de la version consolidée — procédure progressive

**Rien ne se fait sans l'accord explicite de David, étape par étape.** Une seule conversation
sur la base et le serveur à la fois. Branches : `integration-zeste` (version complète),
`correctif-securite` (correctif urgent seul, partant de la version en ligne).

## 0. État réel constaté (production, lecture seule, 02/11/2026 vers 19 h)

| Point | Constat |
|---|---|
| Postgres | 17.6 (même version que tous les tests) |
| `zeste.user_data` | 1 compte, colonnes `user_id, data, updated_at`, empreinte des données `27ef15c9…` |
| Autres tables | `spaces` 2 (juillet), `push_subs` 2 (abonnements morts), `reminders` 0 |
| Fonctions en place | 8, définitions identiques au dépôt sauf la mise en forme de `zeste_sync_reminders` (recopiée telle quelle dans les retours arrière) |
| Failles | **présentes** : `zeste_save_sub`, `zeste_sync_reminders`, `zeste_load`, `zeste_save`, `zeste_new_space` exécutables sans connexion, sans contrôle ; appli en ligne = `main`, diffuse l'état sur un canal temps réel public (démontré sur un canal jetable) |
| Dépendances | aucune fonction/vue d'une autre appli ne cite `zeste` ; aucune table `zeste` dans la publication temps réel ; tâche `cron` `zeste-push` (chaque minute) — inchangée |
| Collisions | aucune table `or_*`, aucune fonction des migrations déjà existante |
| Journalisation | `log_statement = none`, `pg_stat_statements` actif (`track_utility = on`) |
| Vault | présent (0.3.1), aucun secret `zeste_goldapi` |
| Verrou de déploiement | **détenu par une autre session** (« netteté PDF Notelia », jusqu'à 19 h 36 le 02/11) |
| Fonctions serveur | `zeste-push`, `zeste-suggest` identiques à `main` ; `CRON_SECRET` posé ; le routeur crée un « worker » par requête : **une nouvelle fonction ou un code modifié est pris sans redémarrage** |

## A. Option « correctif de sécurité urgent » (indépendante, publiable seule)

Ferme les failles **sans** publier les nouveautés. Testé : seul sur la base actuelle, avec l'appli en ligne,
puis la version complète par-dessus (`tests/sync/serveur.test.mjs`), et en conditions réelles (2 appareils).

1. Sauvegarde vérifiée (étape 1 ci-dessous).
2. Sous verrou : `sql/zeste-correctif-securite.sql`. Effet immédiat : rappels push réservés au compte connecté
   pour lui-même, « code foyer » fermé, plus rien pour les visiteurs anonymes. **L'appli en ligne continue de
   fonctionner sans changement** (elle appelle ces fonctions connectée, avec son propre identifiant).
3. (facultatif, 2ᵉ accord) Publication de la branche `correctif-securite` sur `main` : l'appli cesse d'utiliser
   le canal public (13 lignes changées). Les autres appareils voient les modifications en ≤ 30 s ou au retour
   sur l'appli au lieu de l'instantané.
- Interruption : aucune. Retour arrière : `sql/zeste-securite-retour.sql` (remet exactement l'état actuel,
  failles comprises) ; `git revert` du correctif d'appli. Aucune perte de données.

## B. Publication complète — ordre imposé par les dépendances

| # | Étape | Pourquoi à ce moment | Interruption | Retour arrière (réaliste) |
|---|---|---|---|---|
| 1 | **Sauvegarde vérifiée** : `outils/sauvegarde-zeste.sh` (serveur) puis `outils/verifier-sauvegarde.mjs` (rechargement dans une base jetable, empreintes comparées) | avant toute écriture | aucune | — |
| 2 | **Contrôles de sécurité préalables** (lecture seule) : droits, empreintes des 3 fonctions remplacées = `4dae0c3f…`, `df91e862…`, `86aee7b2…` ; verrou libre ; aucune session longue | détecter une modification faite entre-temps par une autre session | aucune | — |
| 3 | **Migrations** sous verrou (`outils/verrou-deploiement.sh prendre`, jeton en tête de session), essai à blanc `begin…rollback` puis réel : `zeste-sync-v2.sql` → `zeste-securite.sql` → `zeste-or.sql` | l'appli en ligne reste compatible (testé) ; failles push/foyer fermées dès ici | quelques millisecondes de verrou sur la seule table `zeste.user_data` (ajout de 2 colonnes à valeur par défaut, sans réécriture) | `zeste-or-retour.sql` → `zeste-securite-retour.sql` → `zeste-sync-v2-retour.sql` : définitions de production remises à l'identique (empreintes testées) ; les 2 colonnes et les tables `or_*` vides restent (sans effet). **Aucune perte.** |
| 4 | **Fonction serveur `zeste-or-cours`** (copie dans `volumes/functions/`) | doit exister avant l'appli pour l'onglet Or | aucune (pas de redémarrage) | supprimer le dossier : onglet Or en mode « cours indisponible » |
| 5 | **Publication de Zeste** : fusion `integration-zeste` → `main` (GitHub Pages, ~1-2 min) | la base est prête | aucune ; chaque appareil prend la nouvelle version à sa réouverture | voir ci-dessous ⚠️ |
| 5b | **`zeste-suggest`** (idées IA réservées aux connectés) | APRÈS l'appli (l'ancienne n'envoie pas la session) | aucune | recopier l'ancienne version (`main` d'avant) |
| 6 | **Clé GoldAPI** : David double-clique `outils/ajouter-cle-goldapi.command` → coffre-fort Vault | possible dès l'étape 4 | **aucune** (pas de redémarrage, autres applis non touchées) | `delete from vault.secrets where name='zeste_goldapi'` : retour au dernier cours connu |
| 7 | **Recette de la version publiée** (non destructive) : page servie contient `zeste_rev_mine` ; appels anonymes refusés ; David : connexion, « Synchronisé », un remboursement, Films, onglet Or (source GoldAPI) ; `v2_only` passe à vrai après sa 1re modification | | aucune | — |
| 8 | **Autres applis** : conteneur des fonctions non redémarré (même heure de démarrage qu'avant) ; une fonction témoin répond ; portail accessible ; verrou rendu ; aucune session bloquée | | aucune | — |

⚠️ **Retour arrière de l'appli après l'étape 5** : dès que David a enregistré avec la nouvelle version, la base
refuse les écritures des anciennes versions (`v2_only`). Revenir en arrière demande donc **deux gestes** :
republier `correctif-securite` (et non l'ancienne `main`, pour ne pas rouvrir le canal public) **et** appliquer
`sql/zeste-sync-v2-retour.sql`. Aucune perte de listes (même format) ; les données de l'onglet Or restent en base,
invisibles dans l'ancienne version.

**Restauration de la sauvegarde** : uniquement en cas de données abîmées. Elle remet l'état de l'étape 1 et
**perd tout ce qui a été saisi depuis** (pas de restauration sans perte possible dans ce cas).

## Risques résiduels

- Un appareil resté ouvert sur l'ancienne version n'enregistre plus rien tant qu'il n'est pas rouvert (message à l'écran).
- Conflit entre deux appareils : pas de fusion automatique ; choix de David, l'autre version gardée en copie de secours.
- Les 2 foyers de juillet restent en base, fermés (suppression possible plus tard, sur demande).
- GoldAPI gratuit : CGU sans durée limite (lues le 02/11/2026) ; mention « for evaluation » dans leur doc technique
  (option temps réel). Quota protégé à 280/300 ; au-delà : dernier cours connu, jamais de facturation.
