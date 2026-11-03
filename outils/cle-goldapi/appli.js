// Zeste 🍋 — petite appli Mac « Zeste TEST – clé GoldAPI » : enregistre la clé GoldAPI dans le
// coffre-fort chiffré de l'environnement de TEST, sans Terminal et sans jamais l'afficher.
// Fabriquée par outils/cle-goldapi/fabriquer-appli.sh (osacompile, JavaScript for Automation).
//
// Parcours : 1. connexion au serveur vérifiée AVANT de demander la clé ; 2. fenêtre de saisie masquée
// (des points s'affichent) ; 3. nettoyage (espaces, retours à la ligne, caractères invisibles) et
// contrôle du format ; 4. envoi par SSH dans le flux d'entrée — jamais en argument de commande ;
// 5. côté serveur (serveur-test.sh) : GoldAPI doit accepter la clé, sinon rien n'est enregistré ;
// 6. message clair, avec le cours réel obtenu.
// Journal de diagnostic SANS la clé : ~/Library/Logs/zeste-goldapi.log
//
// Banc d'essai (Claude uniquement, jamais par double-clic) :
//   osascript -l JavaScript appli.js --essai <serveur-test.sh> [sans-goldapi]   ← clé lue sur l'entrée
ObjC.import('Foundation');

var TITRE = 'Zeste TEST — clé GoldAPI';
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
      deux(d.getHours()) + ':' + deux(d.getMinutes()) + ':' + deux(d.getSeconds()) + '  TEST  appli  ' + msg + '\n';
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

// envoi : 1re ligne = la clé, puis le script exécuté sur le serveur
function envoyer(cle, scriptServeur, sansGoldapi) {
  var commande = sansGoldapi ? 'IFS= read -r K; export K; ESSAI_SANS_GOLDAPI=1 bash -s' : COMMANDE;
  var res = ssh([commande], cle + '\n' + scriptServeur);
  var r = lireLignes(res.out, cle);
  r.code = res.code;
  r.err = premiereLigne(res.err).split(cle).join('•••');
  return r;
}

function messageResultat(r) {
  var fin = '\n\nTu peux fermer : écris simplement à Claude « clé GoldAPI ajoutée ».';
  if (r.STOCKAGE === 'ok' && r.VERIF === 'ok') {
    var g = parseFloat(r.COURS_G), cote = new Date(parseInt(r.COTE_LE, 10) * 1000);
    return { ok: true, texte: '✅ C\'est fait !\n\nGoldAPI a accepté ta clé, et elle est enregistrée dans le coffre-fort ' +
      'de l\'environnement de TEST.\n\nCours de l\'or reçu à l\'instant : 1 g = ' + euros(g) +
      ' (coté le ' + dateFr(cote) + ').\nPour te repérer : l\'or d\'un Napoléon 20 F (5,81 g) vaut environ ' +
      euros(g * GRAMMES_NAPOLEON) + '.' + fin };
  }
  if (r.STOCKAGE === 'ok' && r.VERIF === 'quota')
    return { ok: true, texte: '✅ Clé enregistrée dans le coffre-fort de TEST.\n\nGoldAPI répond que le quota de ' +
      'requêtes du mois est atteint : le cours reviendra au renouvellement de ton forfait.' + fin };
  if (r.STOCKAGE === 'ok')
    return { ok: true, texte: '✅ Clé enregistrée dans le coffre-fort de TEST.\n\n⚠️ GoldAPI n\'a pas pu la confirmer ' +
      'à l\'instant (' + (r.VERIF === 'injoignable' ? 'site GoldAPI injoignable' : (r.DETAIL || r.VERIF)) +
      ') : Claude la testera.' + fin };
  if (r.VERIF === 'refusee')
    return { ok: false, refusee: true, texte: '❌ GoldAPI refuse cette clé' + (r.DETAIL ? ' (réponse : « ' + r.DETAIL + ' »)' : '') +
      '.\nRien n\'a été enregistré.\n\nOuvre ton espace GoldAPI (bouton ci-dessous), clique sur l\'icône de copie ' +
      'à côté de « API Key », puis relance cette appli.' };
  if (r.ETAPE === 'base-test-arretee')
    return { ok: false, texte: '❌ La base de l\'environnement de TEST est arrêtée. Rien n\'a été enregistré.\n\nPréviens Claude.' };
  return { ok: false, texte: '❌ L\'enregistrement n\'a pas abouti (' + (r.STOCKAGE === 'echec' ? 'coffre-fort' : (r.err || 'serveur')) +
    '). Rien n\'a changé.\n\nPréviens Claude : il lira le journal de diagnostic (sans la clé).' };
}

function icone() {
  var p = $.NSBundle.mainBundle.resourcePath.js + '/applet.icns';
  return $.NSFileManager.defaultManager.fileExistsAtPath(p) ? Path(p) : 'note';
}

function fenetre(texteMessage, boutons, defaut) {
  try {
    return app.displayDialog(texteMessage, { withTitle: TITRE, buttons: boutons, defaultButton: defaut, withIcon: icone() }).buttonReturned;
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

var INTRO = 'Colle ta clé GoldAPI ci-dessous (Cmd ⌘ + V), puis clique sur « Enregistrer ».\n\n' +
  'Des points s\'affichent à la place des caractères : c\'est normal, la clé reste cachée.\n\n' +
  'Environnement de TEST uniquement : ta vraie Zeste n\'est pas touchée.';

function interactif() {
  app.activate();
  noter('lancement');
  var scriptServeur = lireFichier($.NSBundle.mainBundle.resourcePath.js + '/serveur-test.sh');
  if (!scriptServeur) { noter('appli incomplète (serveur-test.sh absent)'); fenetre('❌ Appli incomplète : préviens Claude.', ['OK'], 'OK'); return; }

  var c = ssh(['echo zeste-ok'], '');
  if (c.out.indexOf('zeste-ok') < 0) {
    var raison = raisonConnexion(c.err);
    noter('connexion au serveur impossible : ' + raison + ' [' + premiereLigne(c.err) + ']');
    fenetre('❌ Ce Mac n\'arrive pas à joindre le serveur : ' + raison + '.\n\nRien n\'a été demandé ni envoyé.\n\n' +
      'Lance cette appli sur ton MacBook habituel (celui où Claude Code est installé), connecté à Internet.', ['OK'], 'OK');
    return;
  }
  noter('connexion au serveur : OK');

  var texteMessage = INTRO;
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
    var r = envoyer(n.cle, scriptServeur, false);
    n = null;
    noter('résultat : vérification GoldAPI = ' + (r.VERIF || r.ETAPE || '?') + ', coffre-fort = ' + (r.STOCKAGE || '?') +
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
function essai(cheminServeur, sansGoldapi) {
  var brut = texte($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile);
  var n = nettoyer(brut.replace(/\n$/, ''));
  var lignes = ['nettoyage : texte de ' + n.collee + ' caractères, clé ' + (n.extraite ? 'trouvée dedans' : 'telle quelle') +
    ' (' + n.cle.length + ' caractères), début goldapi- : ' + (n.debut ? 'oui' : 'non') + ', format ' + (n.valide ? 'valide' : 'refusé')];
  if (n.valide) {
    var c = ssh(['echo zeste-ok'], '');
    lignes.push('connexion : ' + (c.out.indexOf('zeste-ok') >= 0 ? 'OK' : 'échec (' + raisonConnexion(c.err) + ')'));
    var r = envoyer(n.cle, lireFichier(cheminServeur), sansGoldapi);
    lignes.push('serveur : ' + JSON.stringify(r));
    lignes.push('message : ' + messageResultat(r).texte.replace(/\n+/g, ' ⏎ '));
  }
  return lignes.join('\n');
}

function run(argv) {
  if (argv && argv.length && argv[0] === '--essai') return essai(argv[1], argv[2] === 'sans-goldapi');
  interactif();
}
