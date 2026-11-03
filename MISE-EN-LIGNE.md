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

## B. Publication complète — procédure du jour J (préparée le 03/11/2026, NON exécutée)

Compatible avec la production actuelle (correctif du 02/11 appliqué) : le contrôle « avant » vérifie qu'elle n'a
pas bougé (validé sur une copie fidèle : les 10 empreintes de fonctions relevées le 02/11 sont retrouvées à
l'identique). **Une seule conversation sur la base et le serveur** pendant toute la durée (~45 min).
Toutes les commandes se lancent depuis le Mac, à la racine du dépôt (branche `integration-zeste`).

### Préalables (avant le jour J)
- David a validé sur iPhone l'onglet Or de l'environnement de test avec le cours réel (consigne courte sur le Bureau).
- David a donné les autorisations listées en fin de section ; aucune autre conversation ne travaille sur le serveur.

### Déroulé

| # | Qui | Étape | Commande / geste | Interruption | Si ça se passe mal |
|---|---|---|---|---|---|
| 1 | Claude | **Coordination** : verrou de déploiement libre, aucune session longue | `git -C ~/comptes-engco show origin/main:outils/verrou-deploiement.sh > <scratch>/verrou.sh` puis `bash <scratch>/verrou.sh etat` | aucune | on attend / on reporte |
| 2 | Claude | **Sauvegarde vérifiée** | `ssh engco 'bash -s' < outils/sauvegarde-zeste.sh` puis `node outils/verifier-sauvegarde.mjs` (rechargement dans une base jetable, empreintes comparées) | aucune | on s'arrête |
| 3 | Claude | **Contrôle « avant »** (lecture seule) : rien n'a bougé depuis le correctif | `ssh engco 'MODE=avant bash -s' < outils/controle-production.sh` → 8 conformes ; **noter** l'empreinte des données et l'heure de démarrage du conteneur des fonctions | aucune | un seul écart = on s'arrête et on analyse |
| 4 | Claude | **Prendre le verrou de déploiement** (jeton en tête de chaque session psql) | `bash <scratch>/verrou.sh prendre` | aucune | — |
| 5 | Claude | **Migrations**, chacune essayée à blanc (`begin … rollback`) puis réelle : `zeste-sync-v2.sql` → `zeste-securite.sql` → `zeste-or.sql` | psql sous jeton | aucune : l'appli en ligne (correctif) continue de fonctionner (testé) ; verrou de quelques millisecondes sur `zeste.user_data` | `zeste-or-retour.sql` → `zeste-securite-retour-apres-correctif.sql` → `zeste-sync-v2-retour.sql` : retour **exact** à la production actuelle, failles toujours fermées (testé) |
| 6 | Claude | **Fonction `zeste-or-cours`** | `bash outils/deployer-fonctions.sh production zeste-or-cours` (sauvegarde + empreinte, sans redémarrage) | aucune ; onglet Or en « Cours indisponible » jusqu'à l'étape 12 | `bash outils/deployer-fonctions.sh retour production <dossier de sauvegarde affiché>` |
| 7a | Claude | ⏱ **Début de la fenêtre de 5 min** (David n'utilise pas Zeste) — **verrou des anciennes versions** | `sql/zeste-verrou-anciennes-versions.sql` sous jeton | l'appli encore en ligne ne peut plus enregistrer (message « version périmée ») pendant ≤ 3 min : **voulu** | voir « Retours arrière » |
| 7b | Claude | **Publication de l'appli** : fusion `integration-zeste` → `main`, poussée ; attendre GitHub Pages (1-2 min) | `git merge` + `git push` ; la page servie doit contenir `zeste_save_mine_v2` | fin de la fenêtre | publier `retour-securise` (voir plus bas) |
| 8 | Claude | **`zeste-suggest`** (idées IA réservées aux connectés) — APRÈS l'appli (l'ancienne n'envoie pas la session) | `bash outils/deployer-fonctions.sh production zeste-suggest` | aucune | `deployer-fonctions.sh retour production <dossier>` |
| 9 | Claude | **Rendre le verrou de déploiement** | `bash <scratch>/verrou.sh rendre` | — | — |
| 10 | Claude | **Contrôle « après »** (lecture seule) | `ssh engco "MODE=apres DONNEES=<…> DEMARRAGE=<…> F_OR=$(md5 -q supabase/functions/zeste-or-cours/index.ts) F_SUGGEST=$(md5 -q supabase/functions/zeste-suggest/index.ts) bash -s" < outils/controle-production.sh` : colonnes, données identiques, verrou complet, 8 tables Or, fonctions identiques au dépôt, **conteneur des fonctions non redémarré**, page publiée, 5 appels anonymes refusés | aucune | selon l'écart |
| 11 | David | **iPhone (2 min)** : fermer complètement Zeste (balayer vers le haut), rouvrir → « ● Synchronisé » ; une petite modification ; elle apparaît sur un 2ᵉ appareil ; onglet Or : « Cours indisponible » (normal avant la clé). Fermer/rouvrir Zeste sur **chaque** appareil (et recharger les onglets d'ordinateur) | — | aucune | Claude |
| 12a | Claude | **Bascule du quota GoldAPI** : l'environnement de test cesse d'utiliser la clé | `ssh engco 'bash -s' < outils/cle-goldapi/bascule-quota.sh` → clé de test retirée, repère posé, **preuve : 0 requête** avec cache vieilli et ⟳ forcé | aucune (test seulement) | — |
| 12b | Claude | Appli TEST retirée du Mac ; alias de l'appli PRODUCTION posé sur le Bureau | `rm -rf ~/Applications/"Zeste TEST – clé GoldAPI.app"` + alias ; `bash outils/cle-goldapi/fabriquer-appli.sh PRODUCTION --alias` | — | — |
| 12c | David | **Clé en production** : double-clic sur « Zeste PRODUCTION – clé GoldAPI » (citron barré « PROD »), coller la clé (⌘V), Enregistrer, confirmer « Oui, enregistrer en PRODUCTION » → ✅ avec le cours de l'or | — | **aucune** (coffre-fort seulement, aucun redémarrage) | `delete from vault.secrets where name='zeste_goldapi'` (« Cours indisponible ») |
| 12d | Claude | **Contrôle « après » refait** : clé présente, report du quota du test, clé absente des journaux (fonctions, base, statistiques, système) et de la page | même commande qu'en 10 | aucune | — |
| 12e | David | Onglet Or : le vrai cours, la valeur et les gains s'affichent | — | — | — |

### Pourquoi cet ordre
- **Migrations avant l'appli** : la nouvelle appli a besoin de `zeste_save_mine_v2` ; l'appli en ligne reste compatible
  avec les migrations (testé). La fonction du cours avant l'appli : l'onglet Or doit la trouver.
- **Verrou des anciennes versions AVANT la publication (7a puis 7b)** : l'exposition par les anciennes instances
  s'arrête à la seconde où le verrou est posé (au lieu de rester ouverte pendant la publication). Prix : ≤ 3 min
  pendant lesquelles l'appli encore en ligne ne peut pas enregistrer, à une heure choisie avec David.
- **`zeste-suggest` après l'appli** : sa nouvelle version exige la session, que seule la nouvelle appli envoie.
- **GoldAPI en dernier**, une fois tout le reste vérifié ; **test désactivé avant la production** : à aucun moment
  les deux environnements n'utilisent la clé ensemble (l'appli PRODUCTION refuse tant que le test a une clé).

### Retours arrière — aucun ne rouvre une faille

| Situation | Geste | Effet |
|---|---|---|
| Migration en échec (étape 5) | transaction annulée d'elle-même ; sinon les 3 scripts `*-retour*` dans l'ordre inverse | production exactement comme aujourd'hui, failles fermées. ⛔ **jamais** `zeste-securite-retour.sql` (rouvrirait les failles du 02/11) |
| Problème dans la nouvelle appli (après 7b) | publier la branche **`retour-securise`** sur `main` (`index.html` + `sw.js`) | l'appli redevient celle du 02/11 (sans canal public), branchée sur la synchro v2 : **le verrou reste**, la base ne change pas, aucune donnée perdue (les nouveautés restent en base, invisibles ; essayé : synchro avec la nouvelle appli, conflit détecté sans écrasement) |
| Fonction serveur fautive | `deployer-fonctions.sh retour production <dossier>` | version précédente remise, sans redémarrage |
| Clé GoldAPI à retirer | `delete from vault.secrets where name='zeste_goldapi'` | « Cours indisponible » / dernier cours réel connu |
| Verrou des anciennes versions | `sql/zeste-verrou-anciennes-versions-retour.sql` — ⛔ **rouvre l'exposition** ; seulement sur décision écrite de David, en dernier recours | — |
| Données abîmées | restauration de la sauvegarde de l'étape 2 | remet l'état de l'étape 2 et **perd ce qui a été saisi depuis** |

### Autorisations à donner par David (le jour J)
1. Migrations de production `zeste-sync-v2.sql`, `zeste-securite.sql`, `zeste-or.sql` et **verrou des anciennes versions**
   (`zeste-verrou-anciennes-versions.sql`), sous verrou de déploiement, après sauvegarde vérifiée et contrôle « avant » conforme.
2. Installation des fonctions serveur `zeste-or-cours` et `zeste-suggest` (copie de fichiers, sans redémarrage).
3. Publication de `integration-zeste` sur `main`.
4. Bascule GoldAPI : retrait de la clé de l'environnement de test, puis activation en production (David colle lui-même la clé).
5. (recommandé) Retour arrière sécurisé sans redemander : publication de `retour-securise` et retour des fonctions
   si la recette échoue (jamais le retour du verrou ni celui du correctif).

## Ancien canal temps réel : ce qui est réglé, ce qui ne l'est pas

- **Vérifié dans le code** : les 28 versions publiées du 05/08 au 01/10/2026 diffusent l'état COMPLET du compte sur le
  canal public `zeste-user-<uid>`, par un seul `send()`, placé **juste après un `zeste_save_mine` réussi** ; elles
  appliquent aussi ce qu'elles reçoivent sur ce canal et l'enregistrent à la modification suivante.
- **Réglé par le correctif (02/11)** : l'appli en ligne ne diffuse et n'écoute plus rien ; plus aucun accès anonyme.
- **Réglé par le verrou (jour J, étape 7a)** : `zeste_save_mine` refuse tout, pour tous les comptes, même un compte sans
  ligne (le simple drapeau par compte laissait passer un compte créé depuis une ancienne version — corrigé le 03/11).
  Une ancienne instance encore ouverte ne peut donc **plus rien diffuser** et **plus rien enregistrer**, y compris un
  état falsifié reçu par le canal. Démontré sur le banc local : 0 diffusion, 2 enregistrements refusés, faux état non enregistré.
- **Pas réglé côté serveur (risque résiduel)** : une ancienne instance restée ouverte écoute toujours le canal public.
  Quelqu'un qui connaîtrait l'identifiant interne du compte (un uuid, jamais affiché) pourrait y **afficher** un faux
  état **sur cet appareil seulement** — rien n'est enregistré, rien ne fuit — jusqu'à sa fermeture. Le service temps réel
  est commun à toutes les applis : couper les canaux publics (`private_only`) casserait les autres applis, exclu.
- **Avant le jour J** : toute ancienne instance d'avant le 02/11 encore ouverte diffuse encore à chaque enregistrement.
  Parade immédiate et gratuite : fermer complètement Zeste sur chaque appareil (balayer l'appli, recharger les onglets).

## Risques résiduels

- Ancienne instance restée ouverte après le verrou : peut afficher un faux état injecté (cet appareil seulement, rien
  d'enregistré ni de divulgué) ; n'enregistre plus rien ; disparaît à la réouverture.
- Fenêtre de ≤ 3 min (7a → 7b) où l'appli encore en ligne n'enregistre pas : choisie, annoncée.
- Retour arrière sécurisé : en cas de conflit entre deux appareils, le serveur fait foi (message affiché, la saisie
  concurrente de l'appareil en retard est perdue) ; l'onglet Or n'y existe pas (données conservées en base).
- Conflit dans la nouvelle appli : pas de fusion automatique ; choix de David, l'autre version gardée en copie de secours.
- Les 2 foyers de juillet restent en base, fermés (suppression possible plus tard, sur demande).
- GoldAPI gratuit : CGU sans durée limite (lues le 02/11/2026). Panne : dernier cours réel avec sa date ; jamais de facturation.

## Cours de l'or (GoldAPI) — réglages et quota

- Source : GoldAPI.io, `GET /api/price/XAU/EUR`, champ `price_per_unit.gram` (vérifié le 03/11 : = `price` ÷ 31,1034768,
  devise EUR, horodatage Unix ; écart avec Swissquote 0,005 %). Aucune conversion de devise côté Zeste.
- Cache serveur partagé : cours redemandé au plus toutes les **3 h** ; ⟳ au plus **1 fois par heure** ; verrou contre les
  appels simultanés (testés en réel le 03/11).
- **Quota de la clé : 300 requêtes/mois, commun à tous les environnements.** Garde-fous :
  - un seul environnement à la fois : bascule (12a) puis activation (12c) ; l'appli PRODUCTION refuse tant que le test a
    une clé ; l'appli TEST refuse après la bascule (repère `~/zeste-test/GOLDAPI-DESACTIVE`) ;
  - plafond **9 requêtes par jour** : quel que soit le jour de renouvellement chez GoldAPI, 31 jours × 9 = 279 < 300 ;
  - plafond **280 par mois**, et le quota déjà consommé par le test ce mois-ci est reporté dans le journal de production
    (une fois) ;
  - aucune requête d'historique par défaut.
- Sans cours réel : « Cours indisponible » ; fournisseur en panne / quota / clé refusée : dernier cours réel avec sa date.
- Outils : appli Mac `outils/cle-goldapi/` (versions TEST et PRODUCTION, `fabriquer-appli.sh`), banc
  `tests/or/test-appli-cle-production.sh` (2 bases jetables, 15 contrôles), contrôles réels sur le test
  `tests/or/test-cours-reel.sh` et `tests/or/test-cache-quota-reel.sh` (la clé n'est jamais affichée).
