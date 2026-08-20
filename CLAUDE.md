# zeste — Tâches & Courses (PWA personnelle)

Application web **PWA** ultra simple et colorée, pensée pour **iPhone** :
tâches à faire, liste de courses, films à voir, prêts.
Dépôt : `github.com/davidbouaziz89-crypto/zeste`, branche `main`.

⚠️ **Ce n'est pas un logiciel du portail de gestion.** C'est une app perso,
indépendante de `gestion.proformationplus.fr`. Elle partage seulement le
**serveur Supabase**, dans son propre schéma `zeste`.

## Nature du projet

**Une seule page HTML autonome, sans étape de build.** `index.html` (~155 Ko)
embarque tout : style, logique, données de référence. Pas de bundler, pas de
framework, pas de `npm install`. Les librairies sont chargées **depuis un CDN**
(`supabase-js`, `ZXing` pour le code-barres).

**N'introduis jamais d'étape de compilation** — l'app est servie telle quelle.

| Fichier | Rôle |
|---|---|
| `index.html` | toute l'application |
| `sw.js` | service worker (hors-ligne + cache) |
| `manifest.json` | installation PWA (thème jaune `#ffd23f`) |
| `sql/zeste-setup.sql` | schéma `zeste` + fonctions RPC de partage |
| `sql/zeste-auth.sql`, `sql/zeste-push.sql` | authentification, notifications |
| `supabase/functions/zeste-push/index.ts` | edge function d'envoi des rappels push |
| `icon-192.png`, `icon-512.png`, `favicon-32.png`, `apple-touch-icon.png` | icônes |
| `GOOGLE-SETUP.md`, `PUSH-SETUP.md` | procédures d'installation |

## Backend

Supabase **auto-hébergé** : `https://api.srv.proformationplus.fr`
(Hetzner 49.13.72.204, stack dans `/opt/supabase`), schéma **`zeste`**.

⚠️ **`PUSH-SETUP.md` est périmé sur un point** : il indique de déployer la
fonction avec `--project-ref lrslisyydbiejqzpsoxc`. Ce projet managé est une
**copie morte** depuis la migration du 11/08/2026. Tout déploiement se fait
**sur le serveur**. De même, le **MCP Supabase interroge le managé** : ne
l'utilise pas pour constater l'état réel. Pour voir la vraie base :

    ssh engco
    cd /opt/supabase && sudo docker compose exec -T db psql -U supabase_admin -d postgres

### Modèle de données — particularité importante

Le partage de foyer repose sur **une seule table** `zeste.spaces`, où **tout
l'état tient dans une colonne JSON** (`data jsonb`). Un foyer = une ligne.

**La table a la RLS activée SANS aucune policy pour `anon`** : c'est
**volontaire**, l'accès direct est impossible. Tout passe par **3 fonctions RPC
`security definer`** (`zeste_new_space`, etc.). La sécurité repose sur le fait
de **connaître le code du foyer** (un uuid).

→ N'ajoute **jamais** une policy `anon` sur `zeste.spaces` pour « débloquer »
quelque chose : ça ouvrirait les foyers de tout le monde. Passe par une
nouvelle fonction RPC.

## Services externes utilisés

- **Google Agenda** (OAuth, scope `calendar.events`) — ajout de tâches au calendrier
- **TMDB** — recherche de films/séries, affiches, bandes-annonces, plateformes
- **OpenFoodFacts** — scan de code-barres produit
- **Web Push (VAPID)** — rappels même app fermée, déclenchés par `pg_cron`

⚠️ Le **service worker ignore volontairement les requêtes externes** (TMDB,
YouTube, OpenFoodFacts) au lieu de les mettre en cache — c'est le correctif d'un
bug vécu. Ne le « répare » pas en cachant ces appels. **Si tu modifies `sw.js`,
incrémente le numéro de version du cache**, sinon les utilisateurs gardent
l'ancienne version.

## Conventions

- **Français partout** : interface, commentaires, messages de commit.
- Dates `JJ/MM/AAAA`. Ton volontairement **simple et coloré**, avec emoji.
- **Priorité iPhone** : gestion du clavier virtuel (variable `--kb`), fenêtres
  d'ajout façon iOS (contenu défilant, bouton fixé en pied), mode portrait.
- Toute chaîne visible reste en français, jamais d'anglais dans l'interface.

## Vérifier son travail

Pas de suite de tests. Avant de pousser :

```bash
~/.bun/bin/bun build index.html   # vérifie la syntaxe JS
```

Puis contrôle réel **sur iPhone** (c'est la cible) : installation PWA, clavier,
mode hors-ligne.

---

# Règles de travail — à respecter à chaque intervention

**Règle d'or : tu travailles UNIQUEMENT sur ce projet.** Tu ne touches à aucun
autre dossier ni à aucun autre logiciel de David, même si tu penses que ce
serait utile. Si le besoin déborde sur un autre projet, dis-le et arrête-toi.

## Autonomie maximale

**Tout ce que tu es capable de faire toi-même, fais-le, sans me le demander.**
Ne me demande pas de faire des choses que tu peux faire seul, et ne me demande
pas la permission pour des actions courantes et réversibles. Réserve tes
questions à **deux cas seulement** :

- **(a)** ce que **moi seul** peux faire (créer un compte, effectuer un
  paiement, obtenir une clé API, cliquer dans un service externe, faire un
  choix business) ;
- **(b)** les **validations déjà prévues dans ces règles** (proposer un plan
  avant une tâche non triviale, et ne rien supprimer / déployer / publier sans
  mon accord).

En dehors de ces deux cas, **agis directement au lieu de me demander**.

## Je suis débutant : explique-moi pas à pas

Quand il y a quelque chose que **je** dois faire moi-même, pars toujours du
principe que je suis **DÉBUTANT et non technique**. Explique-moi chaque étape,
dans l'ordre, très précisément, **sans jargon**. Donne-moi le maximum de
**liens directs** et dis-moi exactement où cliquer (« va sur ce lien, clique
ici, puis là »). Ne suppose jamais que je sais faire une manipulation
technique. Si je dois copier, choisir ou coller quelque chose, montre-moi
exactement **quoi** et **où**.

## Avant toute modification

- **Explore et comprends** le code concerné avant d'agir. Ne te base jamais sur
  une supposition : va vérifier dans le code réel.
- **Respecte la techno déjà en place** (langage, framework, base de données,
  gestionnaire de paquets). N'introduis **aucune** nouvelle technologie ni
  librairie sans demander d'abord.
- **S'il te manque une information** (un chemin, une intention, un nom), pose la
  question à David. **Ne devine pas.**

## Méthode obligatoire

- **Un seul objectif à la fois**, par **petites étapes vérifiables**.
- Pour toute tâche non triviale : **propose d'abord un plan**, attends la
  validation de David, **ensuite seulement tu codes**.
- **Teste après chaque étape** et dis précisément **comment vérifier** le
  résultat.

## Interdits (sauf accord explicite de David)

- Ne **supprime**, ne **renomme**, n'**écrase** aucun fichier sans demander.
- Ne **réécris pas** de grandes portions de code qui fonctionnent déjà.
- Ne crée **pas de doublon** : vérifie si la chose existe déjà et réutilise-la.
- Ne modifie **que ce qui est strictement nécessaire** à la demande. Ne touche à
  rien en dehors du périmètre demandé.
- Ne change **pas** la configuration, les variables d'environnement, les ports
  ni la base de données sans prévenir et expliquer pourquoi.

## Sécurité et sauvegarde

- Avant un changement important, assure-toi que l'état actuel est **bien
  sauvegardé sur git** (commit), pour qu'on puisse revenir en arrière.
- Ne **déploie / ne publie rien** sans l'accord de David.
- Ne touche pas aux **secrets et clés** (fichiers `.env`), et ne les affiche
  jamais.

## En cas de problème

- Si quelque chose casse, **explique la cause réelle** dans le code, ne la
  contourne pas, **corrige proprement**. Assume l'erreur au lieu de la rejeter.

## À la fin de chaque intervention

- Fais un **récapitulatif simple** : ce que tu as changé, dans quels fichiers,
  pourquoi, comment le tester, et ce qu'il reste à faire.

## Exécution des tâches techniques — David n'est pas technique

David ne sait pas / ne peut pas utiliser le terminal (Git Bash, commandes SQL, ouverture de fichiers de préviz).

**RÈGLE :** si une étape peut être exécutée par TOI (Claude Code) — exécuter un `.sql` sur le serveur, lancer une commande, un `git`, un build, générer un aperçu — tu la **FAIS toi-même**. Tu ne demandes **JAMAIS** à David de taper quoi que ce soit dans un terminal.

**Sécurité conservée :** avant une modification de base ou une publication, tu expliques et tu attends son « go » ; après un `.sql`, tu **VÉRIFIES** qu'il est appliqué et tu le confirmes simplement ; tu ne publies rien sans son accord.

**David décide (oui/non), TOI tu exécutes.**
