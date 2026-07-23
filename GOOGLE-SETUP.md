# 📅 Google Agenda automatique (brique 3) — créer l'identifiant Google

Pour que les tâches partent **toutes seules** dans ton agenda (sans le tap de
confirmation), l'appli a besoin d'un « ID client OAuth » Google. ~5 min, gratuit.

## 1. Console Google Cloud
Va sur https://console.cloud.google.com/ (connecté avec ton compte Google).
- Crée un projet (ou réutilise-en un) : en haut, sélecteur de projet → **Nouveau projet** → nom « Zeste » → Créer.

## 2. Activer l'API Google Calendar
- Menu → **APIs & Services** → **Library** (Bibliothèque)
- Cherche **Google Calendar API** → **Enable** (Activer).

## 3. Écran de consentement OAuth
- **APIs & Services** → **OAuth consent screen**
- Type : **External** → Créer
- Nom de l'appli : `Zeste`, e-mail d'assistance : le tien, e-mail développeur : le tien → Enregistrer
- Sur l'étape « Test users », ajoute **ton adresse Gmail** (et celle de ta femme) → Enregistrer.
  (Tant que l'appli est en mode test, seuls ces comptes peuvent l'utiliser — c'est parfait pour vous.)

## 4. Créer l'ID client
- **APIs & Services** → **Credentials** → **+ Create credentials** → **OAuth client ID**
- Type d'application : **Web application**
- Nom : `Zeste web`
- **Authorized JavaScript origins** → Add URI :
  - `https://davidbouaziz89-crypto.github.io`
- (laisse « Authorized redirect URIs » vide)
- **Create** → une fenêtre affiche ton **Client ID** (finit par `.apps.googleusercontent.com`).

## 5. Donne-moi le Client ID
Copie ce Client ID et colle-le moi dans le chat — je l'intègre à l'appli et c'est actif.
(C'est une valeur publique, sans danger à partager.)
