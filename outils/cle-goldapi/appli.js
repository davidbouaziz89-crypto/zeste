// Zeste 🍋 — petite appli Mac « clé GoldAPI » : enregistre la clé GoldAPI dans le coffre-fort chiffré
// de Zeste, sans Terminal et sans jamais l'afficher. Deux versions fabriquées par
// outils/cle-goldapi/fabriquer-appli.sh (osacompile, JavaScript for Automation) :
//   « Zeste TEST – clé GoldAPI »        → environnement de test (serveur-test.sh)
//   « Zeste PRODUCTION – clé GoldAPI »  → ta vraie Zeste (serveur-production.sh), confirmation obligatoire
// Le fichier Resources/environnement.txt de l'appli dit laquelle elle est.
//
// Parcours : 1. connexion au serveur vérifiée AVANT de demander la clé ; 2. fenêtre de saisie masquée
// (des points s'affichent) ; 3. nettoyage (espaces, retours à la ligne, caractères invisibles) et
// contrôle du format ; 4. envoi par SSH dans le flux d'entrée — jamais en argument de commande ;
// 5. côté serveur (serveur-commun.sh + serveur-test.sh / serveur-production.sh) : garde-fous, GoldAPI doit
//    accepter la clé (sinon rien n'est enregistré), relecture sans afficher la clé ;
// 6. message clair, avec le cours réel obtenu.
// Journal de diagnostic SANS la clé : ~/Library/Logs/zeste-goldapi.log
//
// Banc d'essai (Claude uniquement, jamais par double-clic) :
//   osascript -l JavaScript appli.js --essai TEST|PRODUCTION <dossier des scripts> [sans-goldapi] [base-isolee]
//   (clé lue sur l'entrée standard ; base-isolee : conteneurs jetables, jamais la production)
ObjC.import('Foundation');

var ENV = 'TEST', PROD = false, TITRE = '', LIEU = '';
function choisirEnv(nom) {
  PROD = nom === 'PRODUCTION'; ENV = PROD ? 'PRODUCTION' : 'TEST';
  TITRE = PROD ? '⛔ PRODUCTION — clé GoldAPI de ta VRAIE Zeste' : 'Zeste TEST — clé GoldAPI';
  LIEU = PROD ? 'dans le coffre-fort de ta VRAIE Zeste (PRODUCTION)' : 'dans le coffre-fort de l\'environnement de TEST';
}
var JOURNAL = $.NSHomeDirectory().js + '/Library/Logs/zeste-goldapi.log';
var SSH = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=10', 'engco'];
var COMMANDE = 'IFS= read -r K; export K; bash -s';
var ESPACE_GOLDAPI = 'https://www.goldapi.io/dashboard';
var GRAMMES_NAPOLEON = 5.8064;

var app = Application.currentApplication();
app.includeStandardAdditions = true;

function deux(n) { return (n < 10 ? '0' : '') + n; }
function dateFr(d) {
  return deux(d.getDate()) + '/' + deux(d.getMonth() + 1) + '/' + d.getFullYear() + ' à ' +
    deux(d.getHours()) + ':' + deux(d.getMinutes());
}
function euros(n) {
  var t = n.toFixed(2).split('.');
  return t[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ',' + t[1] + ' €';
}

// journal de diagnostic : jamais la clé, seulement les étapes
function noter(msg) {
  try {
    var d = new Date();
    var ligne = deux(d.getDate()) + '/' + deux(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' +
      deux(d.getHours()) + ':' + deux(d.getMinutes()) + ':' + deux(d.getSeconds()) + '  ' + ENV + '  appli  ' + msg + '\n';
    var fm = $.NSFileManager.defaultManager;
    if (!fm.fileExistsAtPath(JOURNAL)) fm.createFileAtPathContentsAttributes(JOURNAL, $(), $());
    var h = $.NSFileHandle.fileHandleForWritingAtPath(JOURNAL);
    if (h.isNil()) return;
    h.seekToEndOfFile;
    h.writeData($(ligne).dataUsingEncoding($.NSUTF8StringEncoding));
    h.closeFile;
  } catch (e) {}
}

function texte(data) {
  var s = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
  return s.isNil() ? '' : s.js;
}

// lance ssh ; « entree » part dans le flux d'entrée (jamais dans les arguments)
function ssh(args, entree) {
  var t = $.NSTask.alloc.init;
  t.launchPath = '/usr/bin/ssh';
  t.arguments = $(SSH.concat(args));
  var pin = $.NSPipe.pipe, pout = $.NSPipe.pipe, perr = $.NSPipe.pipe;
  t.standardInput = pin; t.standardOutput = pout; t.standardError = perr;
  t.launch;
  var w = pin.fileHandleForWriting;
  if (entree) w.writeData($(entree).dataUsingEncoding($.NSUTF8StringEncoding));
  w.closeFile;
  var out = texte(pout.fileHandleForReading.readDataToEndOfFile);
  var err = texte(perr.fileHandleForReading.readDataToEndOfFile);
  t.waitUntilExit;
  return { code: t.terminationStatus, out: out, err: err };
}

function premiereLigne(s) {
  return (s || '').split('\n').filter(function (l) { return l.trim(); })[0] || '';
}

// pourquoi la connexion au serveur échoue, en clair
function raisonConnexion(err) {
  if (/Could not resolve hostname|nodename nor servname/i.test(err))
    return 'ce Mac ne connaît pas le serveur « engco » (ce n\'est pas le Mac habituel ?)';
  if (/Permission denied/i.test(err)) return 'le serveur refuse l\'accès de ce Mac';
  if (/timed out|No route|Network is unreachable|Connection refused/i.test(err))
    return 'pas de réponse du serveur (connexion Internet ?)';
  if (/Host key verification failed/i.test(err)) return 'l\'identité du serveur n\'a pas pu être vérifiée';
  return premiereLigne(err) || 'raison inconnue';
}

// nettoyage : ne garde que lettres, chiffres, - et _ (espaces, retours à la ligne, invisibles retirés)
// si un texte plus long a été collé (page copiée en entier…), on y cherche UNE clé « goldapi-… »
function nettoyer(brut) {
  brut = brut || '';
  var cle = brut.replace(/[^A-Za-z0-9_-]/g, '');
  var r = { cle: cle, collee: brut.length, retires: brut.length - cle.length, extraite: false, trouvees: 0 };
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(cle)) {
    var vues = {};
    (brut.match(/goldapi-[A-Za-z0-9_-]{6,120}/g) || []).forEach(function (m) { vues[m] = 1; });
    var liste = Object.keys(vues);
    r.trouvees = liste.length;
    if (liste.length === 1) { r.cle = liste[0]; r.extraite = true; }
  }
  r.debut = /^goldapi-/.test(r.cle);
  r.valide = /^[A-Za-z0-9_-]{16,128}$/.test(r.cle);
  return r;
}

function lireLignes(out, cle) {
  var r = {};
  (out || '').split('\n').forEach(function (l) {
    if (cle) l = l.split(cle).join('•••');   // ceinture et bretelles : la clé n'est jamais renvoyée
    var i = l.indexOf('=');
    if (i > 0) r[l.slice(0, i)] = l.slice(i + 1);
  });
  return r;
}

function lireFichier(chemin) {
  var s = $.NSString.stringWithContentsOfFileEncodingError(chemin, $.NSUTF8StringEncoding, $());
  return s.isNil() ? null : s.js;
}

// envoi : 1re ligne = la clé, puis les scripts exécutés sur le serveur (commun + test ou production)
function envoyer(cle, scriptServeur, essai) {
  essai = essai || {};
  var commande = 'IFS= read -r K; export K; ' + (essai.sansGoldapi ? 'ESSAI_SANS_GOLDAPI=1 ' : '') +
    (essai.baseIsolee ? 'ESSAI_BASE_ISOLEE=1 ' : '') + 'bash -s';
  var res = ssh([commande], cle + '\n' + scriptServeur);
  var r = lireLignes(res.out, cle);
  r.code = res.code;
  r.err = premiereLigne(res.err).split(cle).join('•••');
  return r;
}

function messageResultat(r) {
  var fin = '\n\nTu peux fermer : écris simplement à Claude « ' + (PROD ? 'clé GoldAPI de production ajoutée' : 'clé GoldAPI ajoutée') + ' ».';
  var relue = r.VERIFIE === 'oui' ? ', puis relue avec succès (sans l\'afficher)' : '';
  if (r.STOCKAGE === 'ok' && r.VERIFIE !== 'oui')
    return { ok: false, texte: '❌ La clé a été envoyée, mais sa relecture ne correspond pas. Préviens Claude avant toute autre action.' };
  if (r.STOCKAGE === 'ok' && r.VERIF === 'ok') {
    var g = parseFloat(r.COURS_G), cote = new Date(parseInt(r.COTE_LE, 10) * 1000);
    return { ok: true, texte: '✅ C\'est fait !\n\nGoldAPI a accepté ta clé. Elle est enregistrée ' + LIEU + relue +
      '.\n\nCours de l\'or reçu à l\'instant : 1 g = ' + euros(g) +
      ' (coté le ' + dateFr(cote) + ').\nPour te repérer : l\'or d\'un Napoléon 20 F (5,81 g) vaut environ ' +
      euros(g * GRAMMES_NAPOLEON) + '.' + fin };
  }
  if (r.STOCKAGE === 'ok' && r.VERIF === 'quota')
    return { ok: true, texte: '✅ Clé enregistrée ' + LIEU + relue + '.\n\nGoldAPI répond que le quota de ' +
      'requêtes du mois est atteint : le cours reviendra au renouvellement de ton forfait.' + fin };
  if (r.STOCKAGE === 'ok')
    return { ok: true, texte: '✅ Clé enregistrée ' + LIEU + relue + '.\n\n⚠️ GoldAPI n\'a pas pu la confirmer ' +
      'à l\'instant (' + (r.VERIF === 'injoignable' ? 'site GoldAPI injoignable' : (r.DETAIL || r.VERIF)) +
      ') : Claude la testera.' + fin };
  if (r.VERIF === 'refusee')
    return { ok: false, refusee: true, texte: '❌ GoldAPI refuse cette clé' + (r.DETAIL ? ' (réponse : « ' + r.DETAIL + ' »)' : '') +
      '.\nRien n\'a été enregistré.\n\nOuvre ton espace GoldAPI (bouton ci-dessous), clique sur l\'icône de copie ' +
      'à côté de « API Key », puis relance cette appli.' };
  var etapes = {
    'or-pas-en-ligne': 'La mise en ligne de l\'onglet Or n\'est pas encore faite sur ta vraie Zeste. Rien n\'a été envoyé à GoldAPI ni enregistré.\n\nAttends le feu vert de Claude.',
    'cle-test-active': 'Ta clé est encore active dans l\'environnement de TEST : les deux consommeraient le même quota de 300 requêtes par mois. Rien n\'a été envoyé à GoldAPI ni enregistré.\n\nClaude doit d\'abord désactiver la clé de test.',
    'test-desactive': 'L\'environnement de TEST n\'utilise plus GoldAPI depuis la mise en ligne (pour ne pas consommer ton quota). Rien n\'a été envoyé.',
    'base-arretee': 'La base de l\'environnement de TEST est arrêtée. Rien n\'a été enregistré.\n\nPréviens Claude.',
    'base-injoignable': 'La base de ta Zeste n\'a pas répondu. Rien n\'a été envoyé à GoldAPI ni enregistré.\n\nPréviens Claude.',
    'test-injoignable': 'Impossible de vérifier que l\'environnement de TEST n\'utilise plus ta clé. Rien n\'a été envoyé à GoldAPI ni enregistré.\n\nPréviens Claude.'
  };
  if (etapes[r.ETAPE]) return { ok: false, texte: '❌ ' + etapes[r.ETAPE] };
  return { ok: false, texte: '❌ L\'enregistrement n\'a pas abouti (' + (r.STOCKAGE === 'echec' ? 'coffre-fort' : (r.err || 'serveur')) +
    '). Rien n\'a changé.\n\nPréviens Claude : il lira le journal de diagnostic (sans la clé).' };
}

function icone() {
  var p = $.NSBundle.mainBundle.resourcePath.js + '/applet.icns';
  return $.NSFileManager.defaultManager.fileExistsAtPath(p) ? Path(p) : 'note';
}

function fenetre(texteMessage, boutons, defaut, annuler) {
  try {
    var o = { withTitle: TITRE, buttons: boutons, defaultButton: defaut, withIcon: icone() };
    if (annuler) o.cancelButton = annuler;
    return app.displayDialog(texteMessage, o).buttonReturned;
  } catch (e) { return null; }
}

function demanderCle(texteMessage) {
  try {
    return app.displayDialog(texteMessage, {
      withTitle: TITRE, defaultAnswer: '', hiddenAnswer: true,
      buttons: ['Annuler', 'Enregistrer'], defaultButton: 'Enregistrer', cancelButton: 'Annuler', withIcon: icone()
    }).textReturned;
  } catch (e) { return null; }   // Annuler ou fenêtre fermée
}

function intro() {
  return (PROD ? '⛔ PRODUCTION — ta VRAIE Zeste ⛔\n\n' : '') +
    'Colle ta clé GoldAPI ci-dessous (Cmd ⌘ + V), puis clique sur « Enregistrer ».\n\n' +
    'Des points s\'affichent à la place des caractères : c\'est normal, la clé reste cachée.\n\n' +
    (PROD ? 'Une confirmation te sera demandée avant tout enregistrement.'
          : 'Environnement de TEST uniquement : ta vraie Zeste n\'est pas touchée.');
}
function lireEnv() {
  var e = lireFichier($.NSBundle.mainBundle.resourcePath.js + '/environnement.txt');
  return (e || '').trim();
}

function interactif() {
  var env = lireEnv();
  choisirEnv(env);
  app.activate();
  noter('lancement');
  var res = $.NSBundle.mainBundle.resourcePath.js;
  var commun = lireFichier(res + '/serveur-commun.sh'), propre = lireFichier(res + '/serveur.sh');
  if (!commun || !propre || (env !== 'TEST' && env !== 'PRODUCTION')) {
    noter('appli incomplète (scripts ou environnement absents)'); fenetre('❌ Appli incomplète : préviens Claude.', ['OK'], 'OK'); return;
  }
  var scriptServeur = commun + '\n' + propre;

  var c = ssh(['echo zeste-ok'], '');
  if (c.out.indexOf('zeste-ok') < 0) {
    var raison = raisonConnexion(c.err);
    noter('connexion au serveur impossible : ' + raison + ' [' + premiereLigne(c.err) + ']');
    fenetre('❌ Ce Mac n\'arrive pas à joindre le serveur : ' + raison + '.\n\nRien n\'a été demandé ni envoyé.\n\n' +
      'Lance cette appli sur ton MacBook habituel (celui où Claude Code est installé), connecté à Internet.', ['OK'], 'OK');
    return;
  }
  noter('connexion au serveur : OK');

  var texteMessage = intro();
  for (var tour = 0; tour < 5; tour++) {
    var brut = demanderCle(texteMessage);
    if (brut === null) { noter('annulé — rien envoyé'); return; }
    var n = nettoyer(brut);
    brut = null;
    noter('texte collé : ' + n.collee + ' caractères' + (n.extraite ? ', clé « goldapi-… » trouvée dedans' :
      n.trouvees > 1 ? ', ' + n.trouvees + ' clés différentes dedans' : '') + ' → clé de ' + n.cle.length +
      ' caractères, début goldapi- : ' + (n.debut ? 'oui' : 'non') + ', format ' + (n.valide ? 'valide' : 'refusé') +
      (!n.extraite && n.retires ? ', ' + n.retires + ' espace(s) ou caractère(s) invisible(s) retiré(s)' : ''));
    var aide = '\n\nSur ton espace GoldAPI, copie uniquement ta clé (le code qui commence par « goldapi- »), ' +
      'reviens ici, clique dans le champ et fais Cmd ⌘ + V.';
    if (!n.collee) { texteMessage = '⚠️ Le champ était vide : rien n\'a été collé.' + aide; continue; }
    if (!n.valide) {
      texteMessage = n.trouvees > 1
        ? '⚠️ Le texte collé contient ' + n.trouvees + ' clés GoldAPI différentes : impossible de savoir laquelle est la bonne. Rien n\'a été envoyé.' + aide
        : n.collee > 200
          ? '⚠️ Tu as collé un long texte (' + n.collee + ' caractères) au lieu de la clé seule, et il ne contient pas de clé GoldAPI reconnaissable. Rien n\'a été envoyé.' + aide
          : '⚠️ Ce qui a été collé ne ressemble pas à une clé GoldAPI (' + n.cle.length + ' caractères utiles). Rien n\'a été envoyé.' + aide;
      continue;
    }
    if (PROD) {
      var ok = fenetre('⛔ CONFIRMATION — PRODUCTION ⛔\n\nTu vas enregistrer ta clé GoldAPI dans ta VRAIE Zeste.\n\n' +
        '• GoldAPI vérifie d\'abord la clé (1 requête sur ton quota) : si elle est refusée, rien n\'est enregistré.\n' +
        '• Seul le coffre-fort de Zeste est modifié : aucune autre appli, aucun redémarrage.\n' +
        '• La clé est ensuite relue pour vérification, sans jamais être affichée.\n\nConfirmes-tu ?',
        ['Annuler', 'Oui, enregistrer en PRODUCTION'], 'Annuler', 'Annuler');
      if (ok !== 'Oui, enregistrer en PRODUCTION') { n = null; noter('confirmation PRODUCTION refusée — rien envoyé'); fenetre('Annulé : rien n\'a été envoyé ni enregistré.', ['OK'], 'OK'); return; }
      noter('confirmation PRODUCTION donnée');
    }
    var r = envoyer(n.cle, scriptServeur);
    n = null;
    noter('résultat : vérification GoldAPI = ' + (r.VERIF || r.ETAPE || '?') + ', coffre-fort = ' + (r.STOCKAGE || '?') +
      ', relecture = ' + (r.VERIFIE || '—') + (r.REPORT_TEST ? ', report du quota de test = ' + r.REPORT_TEST : '') +
      (r.DETAIL ? ', détail : ' + r.DETAIL : '') + (r.err ? ', ssh : ' + r.err : '') + ' (code ' + r.code + ')');
    var m = messageResultat(r);
    if (m.refusee) {
      if (fenetre(m.texte, ['Fermer', 'Ouvrir mon espace GoldAPI'], 'Ouvrir mon espace GoldAPI') === 'Ouvrir mon espace GoldAPI')
        app.openLocation(ESPACE_GOLDAPI);
    } else {
      fenetre(m.texte, ['OK'], 'OK');
    }
    return;
  }
  noter('abandon après 5 essais — rien envoyé');
}

// banc d'essai sans fenêtre : clé lue sur l'entrée standard, résultat affiché sans la clé
function essai(envNom, dossier, options) {
  choisirEnv(envNom);
  var brut = texte($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile);
  var n = nettoyer(brut.replace(/\n$/, ''));
  var lignes = ['nettoyage : texte de ' + n.collee + ' caractères, clé ' + (n.extraite ? 'trouvée dedans' : 'telle quelle') +
    ' (' + n.cle.length + ' caractères), début goldapi- : ' + (n.debut ? 'oui' : 'non') + ', format ' + (n.valide ? 'valide' : 'refusé')];
  if (n.valide) {
    var c = ssh(['echo zeste-ok'], '');
    lignes.push('connexion : ' + (c.out.indexOf('zeste-ok') >= 0 ? 'OK' : 'échec (' + raisonConnexion(c.err) + ')'));
    var propre = lireFichier(dossier + (PROD ? '/serveur-production.sh' : '/serveur-test.sh'));
    var r = envoyer(n.cle, lireFichier(dossier + '/serveur-commun.sh') + '\n' + propre,
      { sansGoldapi: options.indexOf('sans-goldapi') >= 0, baseIsolee: options.indexOf('base-isolee') >= 0 });
    lignes.push('serveur : ' + JSON.stringify(r));
    lignes.push('message : ' + messageResultat(r).texte.replace(/\n+/g, ' ⏎ '));
  }
  return lignes.join('\n');
}

function run(argv) {
  if (argv && argv.length && argv[0] === '--essai') return essai(argv[1], argv[2], argv.slice(3));
  interactif();
}
