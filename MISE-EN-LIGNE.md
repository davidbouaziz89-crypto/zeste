# Mise en ligne de la version consolidée — procédure progressive

**Rien ne se fait sans l'accord explicite de David, étape par étape.** Une seule conversation
sur la base et le serveur à la fois. Branches : `integration-zeste` (version complète),
`correctif-securite` (correctif urgent seul, partant de la version en ligne).

## Déjà fait : correctif de sécurité urgent (accord écrit de David du 02/11/2026)

- **20 h 10 min 46 s** : `sql/zeste-correctif-securite.sql` appliqué sous verrou (essai à blanc puis réel).
- **20 h 12 min 59 s** : appli `correctif-securite` en ligne sur GitHub Pages (`main` = `cc2f96f`, page servie vérifiée identique).
- Contrôlé en production : 6 appels anonymes refusés (401), un autre compte refusé (« Accès refusé »),
  code foyer fermé même connecté, ton usage intact (tests en transactions annulées), données identiques
  (empreinte `27ef15c9…`), autres applis opérationnelles, fonctions serveur non redémarrées.
- Sauvegarde vérifiée avant intervention : `~/sauvegardes/zeste-20261102-190958` (serveur).

## 0. État réel constaté (production, lecture seule, 02/11/2026 vers 19 h, AVANT le correctif)

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

## A. Option « correctif de sécurité urgent » — ✅ FAIT le 02/11/2026 (voir en tête)

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
| 2 | **Contrôles de sécurité préalables** (lecture seule) : aucune fonction zeste pour anon ; empreintes = production après correctif (`zeste_save_mine 4dae0c3f…`, `zeste_save_sub a9ad1482…`, `zeste_sync_reminders 096bb726…`, liste complète dans `tests/sync/serveur.test.mjs`, test 12) ; verrou libre ; aucune session longue | détecter une modification faite entre-temps par une autre session | aucune | — |
| 3 | **Migrations** sous verrou (`outils/verrou-deploiement.sh prendre`, jeton en tête de session), essai à blanc `begin…rollback` puis réel : `zeste-sync-v2.sql` → `zeste-securite.sql` (n'ajoute plus que `zeste_rev_mine`) → `zeste-or.sql` | l'appli en ligne (correctif) reste compatible (testé) | quelques millisecondes de verrou sur la seule table `zeste.user_data` (ajout de 2 colonnes à valeur par défaut, sans réécriture) | `zeste-or-retour.sql` → `zeste-securite-retour-apres-correctif.sql` → `zeste-sync-v2-retour.sql` : retour **exact** à la production actuelle, failles toujours fermées (empreintes testées) ; les 2 colonnes et les tables `or_*` restent (sans effet). **Aucune perte.** ⛔ ne plus utiliser `zeste-securite-retour.sql` (rouvrirait les failles). |
| 4 | **Fonction serveur `zeste-or-cours`** (copie dans `volumes/functions/`) | doit exister avant l'appli pour l'onglet Or | aucune (pas de redémarrage) | supprimer le dossier : onglet Or en mode « cours indisponible » |
| 5 | **Publication de Zeste** : fusion `integration-zeste` → `main` (GitHub Pages, ~1-2 min) | la base est prête | aucune ; chaque appareil prend la nouvelle version à sa réouverture | voir ci-dessous ⚠️ |
| 5c | **Verrouillage des anciennes versions** : `sql/zeste-verrou-anciennes-versions.sql` (drapeau `v2_only` pour chaque compte), sous verrou, **dès que la nouvelle appli est en ligne** | ferme côté serveur l'ancien canal public : une ancienne instance (y compris le correctif du 02/11) ne peut plus enregistrer, donc plus rien diffuser (seul envoi = après enregistrement réussi), et un état falsifié reçu par ce canal ne peut plus être enregistré | les appareils encore sur l'ancienne version affichent « version périmée, ferme et rouvre l'appli » ; rien n'est enregistré tant qu'ils ne sont pas rouverts | `update zeste.user_data set v2_only = false` (réautorise les anciennes versions, rouvre l'exposition) |
| 5b | **`zeste-suggest`** (idées IA réservées aux connectés) | APRÈS l'appli (l'ancienne n'envoie pas la session) | aucune | recopier l'ancienne version (`main` d'avant) |
| 6 | **Clé GoldAPI** : ⚠️ passer d'abord la version PRODUCTION en appli Mac comme `outils/cle-goldapi/` (le script Terminal n'a jamais fonctionné chez David) ; à défaut David double-clique `outils/ajouter-cle-goldapi.command` (version PRODUCTION : il doit taper `PRODUCTION` pour confirmer) → coffre-fort Vault de la production | possible dès l'étape 4 | **aucune** (pas de redémarrage, autres applis non touchées). Une nouvelle version de code de fonction est prise en compte en ≤ 6 min (durée de vie des « workers ») | `delete from vault.secrets where name='zeste_goldapi'` : « Cours indisponible » / dernier cours réel connu |
| 7 | **Recette de la version publiée** (non destructive) : page servie contient `zeste_rev_mine` ; appels anonymes refusés ; David : connexion, « Synchronisé », un remboursement, Films, onglet Or (source GoldAPI) ; `v2_only` passe à vrai après sa 1re modification | | aucune | — |
| 8 | **Autres applis** : conteneur des fonctions non redémarré (même heure de démarrage qu'avant) ; une fonction témoin répond ; portail accessible ; verrou rendu ; aucune session bloquée | | aucune | — |

⚠️ **Retour arrière de l'appli après l'étape 5** : dès que David a enregistré avec la nouvelle version, la base
refuse les écritures des anciennes versions (`v2_only`). Revenir en arrière demande donc **deux gestes** :
republier `correctif-securite` (et non l'ancienne `main`, pour ne pas rouvrir le canal public) **et** appliquer
`sql/zeste-sync-v2-retour.sql`. Aucune perte de listes (même format) ; les données de l'onglet Or restent en base,
invisibles dans l'ancienne version.

**Restauration de la sauvegarde** : uniquement en cas de données abîmées. Elle remet l'état de l'étape 1 et
**perd tout ce qui a été saisi depuis** (pas de restauration sans perte possible dans ce cas).

## Ancien canal temps réel : ce que le correctif règle et ne règle pas

- Réglé : l'appli en ligne ne diffuse plus rien et n'écoute plus rien ; plus aucun accès anonyme aux fonctions.
- **Pas réglé côté serveur** : le service temps réel (commun à toutes les applis) accepte toujours les canaux
  publics. Une **ancienne instance** de Zeste encore ouverte (appli iPhone restée en arrière-plan, onglet
  d'ordinateur jamais rechargé) continue d'écouter `zeste-user-<uid>`, d'y diffuser l'état complet après
  chaque enregistrement et d'appliquer ce qu'elle y reçoit. Le journal du service ne nomme pas les canaux :
  impossible de savoir à distance s'il en reste une.
- Démontré en simulation (base identique à la production, version d'avant le correctif) : une ancienne instance
  diffuse l'état complet à chaque enregistrement (lisible par un inconnu), applique un faux état reçu, puis
  l'enregistre — la base l'accepte aujourd'hui. Aucun message n'est conservé en base (`realtime.messages` vide) :
  rien n'est lisible après coup.
- Fermeture : (1) immédiate — fermer complètement Zeste sur chaque appareil (balayer l'appli, recharger les onglets) ;
  (2) côté serveur — étape 5c (`zeste-verrou-anciennes-versions.sql`) : démontré en simulation, plus aucune diffusion,
  le faux état n'est plus enregistré. Ne peut pas être appliquée AVANT la publication complète : l'appli en ligne
  (correctif) utilise le même enregistrement que les anciennes versions et serait bloquée aussi.
  Couper les canaux publics pour tout le serveur (`private_only`) n'est PAS envisagé : cela casserait les autres applis.

## Risques résiduels

- Un appareil resté ouvert sur l'ancienne version n'enregistre plus rien tant qu'il n'est pas rouvert (message à l'écran).
- Conflit entre deux appareils : pas de fusion automatique ; choix de David, l'autre version gardée en copie de secours.
- Les 2 foyers de juillet restent en base, fermés (suppression possible plus tard, sur demande).
- GoldAPI gratuit : CGU sans durée limite (lues le 02/11/2026) ; mention « for evaluation » dans leur doc technique
  (option temps réel). Quota protégé à 280/300 ; au-delà : dernier cours connu, jamais de facturation.

## Cours de l'or (GoldAPI) — réglages retenus (testés sur l'environnement de test)

- Source : GoldAPI.io, `GET /api/price/XAU/EUR` (cours spot de l'or pur en euros, champ `price_per_unit.gram` ;
  à défaut `price` ÷ 31,1034768). Aucune conversion de devise côté Zeste.
- Cache serveur partagé : cours redemandé au plus toutes les **3 h** ; bouton ⟳ : au plus **1 fois par heure** ;
  **9 requêtes par jour au maximum** et **280 par mois** (offre gratuite : 300) ; verrou contre les appels simultanés.
- Aucune requête d'historique par défaut (plus de graphique) : seulement sur demande explicite (`historique: true`).
- Sans cours réel : « Cours indisponible » ; fournisseur en panne / quota / clé refusée : dernier cours réel avec sa date
  et son ancienneté, motif affiché. Jamais de valeur inventée.
- Environnement de test : fonctions servies par le conteneur `zt-functions` (même image que la production),
  clé dans le coffre de la base de TEST (appli Mac `outils/cle-goldapi/`, qui fait vérifier la clé par GoldAPI avant de l'enregistrer ; l'ancien `outils/ajouter-cle-goldapi-test.command` n'a jamais tourné sur le Mac de David), contrôles par
  `tests/or/test-cours-reel.sh` (la clé n'est jamais affichée).
