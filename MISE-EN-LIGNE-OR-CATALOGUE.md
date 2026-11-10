# Mise en ligne — Onglet Or : cours réparé, catalogue de pièces, tableau de bord

Branche `or-cours-catalogue` (partie de `main` = `4739584`, version en ligne depuis le 03/11/2026).
**Rien n'est publié tant que David n'a pas donné son accord.**

## Pourquoi le cours ne s'affichait pas

En production, **aucune clé GoldAPI n'a jamais été posée** (coffre Vault sans secret `zeste_goldapi`,
0 appel au fournisseur depuis le 03/11) : la fonction répondait « clé non configurée » et l'écran
« Cours indisponible ». Constaté en lecture seule le 11/11/2026.

## Ce que contient le lot

| Partie | Fichier | Effet |
|---|---|---|
| Fonction du cours | `supabase/functions/zeste-or-cours/index.ts` | Source principale **Swissquote** (cotation publique XAU/EUR, sans clé ni quota) ; GoldAPI gardé en **secours** (s'il a une clé un jour). Cache 15 min, « Actualiser » 1×/min. Cotation figée (> 4 j), incohérente, hors bornes ou saut > 20 % : refusée, dernier cours fiable conservé. |
| Base | `sql/zeste-or-catalogue.sql` | `zeste.or_types` : colonnes `pays`, `annees`, `source` + 73 nouvelles fiches (81 au total). Les 8 fiches existantes gardent leurs poids. **Aucun achat ni vente modifié.** Rejouable. |
| Retour base | `sql/zeste-or-catalogue-retour.sql` | Retire les fiches ajoutées et les colonnes ; **refusé** si un achat utilise une nouvelle fiche. |
| Appli | `index.html` | Tableau de bord (cours €/g + heure du dernier relevé réussi + « Actualiser le cours », total investi, valeur actuelle, plus/moins-value), cartes par référence (prix moyen pondéré, par pièce / total), recherche dans le catalogue, rattachement proposé d'une pièce saisie à la main. |

## Ordre (compatibilité vérifiée)

L'appli actuelle fonctionne avec la nouvelle base et la nouvelle fonction ; la nouvelle appli a besoin
des nouvelles fiches. Donc : **base → fonction → appli**. Aucune interruption, aucun redémarrage.

| # | Étape | Commande | Si ça se passe mal |
|---|---|---|---|
| 1 | Verrou de déploiement libre ? puis le prendre | `git -C ~/comptes-engco show origin/main:outils/verrou-deploiement.sh > <scratch>/verrou.sh` ; `bash <scratch>/verrou.sh etat` puis `prendre` | on attend |
| 2 | Sauvegarde vérifiée | `ssh engco 'bash -s' < outils/sauvegarde-zeste.sh` puis `node outils/verifier-sauvegarde.mjs` | on s'arrête |
| 3 | Empreinte des achats/ventes AVANT | `select md5(string_agg(to_jsonb(l)::text,'|' order by id)) from zeste.or_lots l` (idem `or_ventes`) | — |
| 4 | Catalogue : essai à blanc (`begin; … rollback;`) puis réel, sous jeton | `sql/zeste-or-catalogue.sql` | `sql/zeste-or-catalogue-retour.sql` |
| 5 | Contrôle : 81 fiches, empreintes identiques à l'étape 3 | psql lecture | retour étape 4 |
| 6 | Fonction du cours (sauvegarde + empreinte, sans redémarrage) | `bash outils/deployer-fonctions.sh production zeste-or-cours` | `bash outils/deployer-fonctions.sh retour production <dossier affiché>` |
| 7 | Appli : fusion de `or-cours-catalogue` dans `main`, poussée ; attendre GitHub Pages | `git merge` + `git push` ; la page servie doit contenir `orChercher` | `git revert` de la fusion |
| 8 | Rendre le verrou | `bash <scratch>/verrou.sh rendre` | — |
| 9 | Contrôle réel : David ouvre l'onglet Or ; `zeste.or_appels_api` reçoit une ligne `swissquote` ok, `or_cours_actuel` est rempli | psql lecture | — |

## Tests (tous passés le 11/11/2026)

```bash
node --test tests/or/calculs.test.mjs                                   # 22 : catalogue = base, recherche, regroupement, calculs
PGLITE_DIR=… node --experimental-strip-types --test tests/or/catalogue.test.mjs tests/or/sql.test.mjs tests/or/edge.test.mjs tests/sync/serveur.test.mjs   # 52
PGLITE_DIR=… node --experimental-strip-types tests/or/test-swissquote-reel.mjs   # vraie cotation Swissquote, base jetable
```

## Risques résiduels

- Swissquote publie ce flux pour son site, sans documentation ni contrat : s'il change, la fonction
  refuse la réponse, garde le dernier cours fiable (avec son heure) et bascule sur GoldAPI **si** une clé
  est posée (appli Mac « Zeste PRODUCTION – clé GoldAPI », gratuite, 300 requêtes/mois).
- Valeur métal = poids d'or fin × cours : ce n'est pas un prix de revente (affiché comme tel).
