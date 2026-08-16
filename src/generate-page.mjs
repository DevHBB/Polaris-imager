// ---------------------------------------------------------------------------
// [EN] generate-page.mjs — builds the standalone avatar generator page served
//      at GET /Generate. It is a port of the CMS page `console/media.php`
//      (tab "Générateur d'avatar") with every PHP/CMS dependency removed:
//      no database, no session, no CSRF, no Bootstrap. Everything (HTML, CSS,
//      JS) is inlined in a single response so the page also works on a LAN with
//      no internet access, and so redistributing the service needs no extra
//      asset files.
//
// [FR] generate-page.mjs — construit la page autonome du générateur d'avatars
//      servie sur GET /Generate. C'est le portage de la page CMS
//      `console/media.php` (onglet « Générateur d'avatar ») dont on a retiré
//      toutes les dépendances PHP/CMS : pas de base de données, pas de session,
//      pas de CSRF, pas de Bootstrap. Tout (HTML, CSS, JS) est intégré dans une
//      seule réponse pour que la page fonctionne aussi sur un réseau local sans
//      internet, et pour que la redistribution du service ne demande aucun
//      fichier annexe.
// ---------------------------------------------------------------------------

// [EN] Minimal HTML escaper for the few server-injected strings.
// [FR] Échappement HTML minimal pour les quelques chaînes injectées côté serveur.
const esc = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// [EN] Server-side values are handed to the page's JS as JSON, never as raw
//      HTML, and "</" is broken up so a value can never close the <script> tag.
// [FR] Les valeurs serveur sont transmises au JS de la page en JSON, jamais en
//      HTML brut, et « </ » est coupé pour qu'une valeur ne puisse jamais
//      fermer la balise <script>.
const js = (value) => JSON.stringify(value ?? null).replace(/</g, '\\u003c');

/**
 * [EN] Render the full HTML document of the generator page.
 * [FR] Génère le document HTML complet de la page du générateur.
 *
 * @param {object}  options
 * @param {string}  options.imagerUrl   [EN] URL of the /avatarimage endpoint the page calls.
 *                                      [FR] URL du point d'entrée /avatarimage appelé par la page.
 * @param {string}  options.base        [EN] Path the panel is mounted on (for its own API calls).
 *                                      [FR] Chemin de montage du panel (pour ses propres appels d'API).
 * @param {boolean} options.lookupEnabled [EN] Show the "load a player" field.
 *                                        [FR] Afficher le champ « charger un joueur ».
 * @param {boolean} options.searchEnabled [EN] Show live username suggestions (DB only).
 *                                        [FR] Afficher les suggestions de pseudos en direct (base seulement).
 * @param {boolean} options.logoutEnabled [EN] Show the sign-out link.
 *                                        [FR] Afficher le lien de déconnexion.
 * @param {string}  options.apiKey      [EN] API key appended to image URLs (optional).
 *                                      [FR] Clé d'API ajoutée aux URLs d'images (optionnelle).
 * @param {string}  options.token       [EN] Shared secret to keep in the URL, if one is required.
 *                                      [FR] Secret partagé à conserver dans l'URL, s'il est exigé.
 * @param {string}  options.title       [EN] Page/brand title. [FR] Titre de la page / de la marque.
 * @param {string}  options.figure      [EN] Figure pre-filled on load. [FR] Figure pré-remplie au chargement.
 * @param {object}  options.query       [EN] Query params used to pre-fill the form.
 *                                      [FR] Paramètres d'URL utilisés pour pré-remplir le formulaire.
 * @returns {string} [EN] The HTML document. [FR] Le document HTML.
 */
export const renderGeneratePage = ({
    imagerUrl = '/avatarimage',
    base = '/Generate',
    lookupEnabled = false,
    searchEnabled = false,
    logoutEnabled = false,
    apiKey = '',
    token = '',
    title = 'Avatar Studio',
    figure = '',
    query = {}
} = {}) => `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
/* =====================================================================
   [EN] Design tokens. Light "studio" palette: white surfaces on a barely
        tinted background, sky blue as the single accent, one soft shadow
        level. No web fonts are loaded so the page renders offline.
   [FR] Jetons de design. Palette claire « studio » : surfaces blanches sur
        un fond à peine teinté, bleu ciel comme unique accent, un seul
        niveau d'ombre douce. Aucune police web n'est chargée : la page
        s'affiche hors ligne.
   ===================================================================== */
:root{
  --bg:#f4f8fc; --panel:#ffffff; --panel2:#f7fafd; --line:#e2ebf4;
  --text:#16212f; --muted:#69798e; --sky:#2f9bf0; --sky-dark:#1a7fd0;
  --sky-soft:#e8f4fe; --ok:#0f9b5c; --err:#d63b46;
  --mono:ui-monospace,"SFMono-Regular","JetBrains Mono",Menlo,Consolas,monospace;
  --body:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --r:12px;
  --shadow:0 1px 2px rgba(20,40,70,.05), 0 10px 26px -18px rgba(20,40,70,.35);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{
  background:var(--bg); color:var(--text); font-family:var(--body); font-size:14px;
  line-height:1.5; -webkit-font-smoothing:antialiased;
  background-image:radial-gradient(circle at 12% -8%,rgba(47,155,240,.10),transparent 42%),
                   radial-gradient(circle at 95% 2%,rgba(47,155,240,.07),transparent 38%);
  background-attachment:fixed;
}
a{color:var(--sky-dark)}

/* --- [EN] Header / [FR] En-tête ------------------------------------- */
.top{border-bottom:1px solid var(--line); background:rgba(255,255,255,.88); backdrop-filter:blur(8px);
     position:sticky; top:0; z-index:20}
.topIn{max-width:1240px; margin:0 auto; padding:14px 22px; display:flex; align-items:center; gap:14px}
.brand{font-family:var(--mono); font-size:13px; font-weight:700; letter-spacing:.18em; text-transform:uppercase}
.brand b{color:var(--sky)}
.tagline{color:var(--muted); font-size:12px; margin-left:auto; font-family:var(--mono); letter-spacing:.05em}
@media(max-width:700px){.tagline{display:none}}

/* --- [EN] Layout / [FR] Mise en page -------------------------------- */
.wrap{max-width:1240px; margin:0 auto; padding:22px}
.grid{display:grid; grid-template-columns:352px 1fr; gap:22px; align-items:start}
@media(max-width:980px){.grid{grid-template-columns:1fr}}
.col-left{position:sticky; top:76px}
@media(max-width:980px){.col-left{position:static}}
.card{background:var(--panel); border:1px solid var(--line); border-radius:var(--r); padding:18px;
      margin-bottom:18px; box-shadow:var(--shadow)}
.card h2{font-family:var(--mono); font-size:11px; letter-spacing:.16em; text-transform:uppercase;
         color:var(--muted); margin:0 0 14px; font-weight:700}

/* --- [EN] Preview: the signature block. Checkerboard = transparency,
         sky-blue corner brackets = the "viewfinder" of the studio.
     [FR] Aperçu : le bloc signature. Damier = transparence, équerres bleu
         ciel = le « viseur » du studio. ---------------------------- */
.preview{position:relative; border:1px solid var(--line); border-radius:var(--r); min-height:288px;
  display:flex; align-items:center; justify-content:center; padding:26px; overflow:hidden;
  background-color:#ffffff;
  background-image:linear-gradient(45deg,#eef4fa 25%,transparent 25%,transparent 75%,#eef4fa 75%),
                   linear-gradient(45deg,#eef4fa 25%,transparent 25%,transparent 75%,#eef4fa 75%);
  background-size:18px 18px; background-position:0 0,9px 9px;
}
.preview img{max-width:100%; image-rendering:pixelated; display:block}
/* [EN] An <img> with no src draws a broken icon and its alt text; hide it until
        a real URL is set. [FR] Une <img> sans src affiche une icône cassée et son
        texte alternatif ; on la masque tant qu'aucune URL réelle n'est définie. */
.preview img:not([src]){display:none}
.preview::before,.preview::after{content:""; position:absolute; width:16px; height:16px; pointer-events:none}
.preview::before{top:9px; left:9px; border-top:2px solid var(--sky); border-left:2px solid var(--sky)}
.preview::after{bottom:9px; right:9px; border-bottom:2px solid var(--sky); border-right:2px solid var(--sky)}
.load{position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
      background:rgba(255,255,255,.66)}
.spin{width:24px; height:24px; border-radius:50%;
      border:3px solid #d7e5f3; border-top-color:var(--sky); animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}

/* --- [EN] Readout of the live URL / [FR] Affichage de l'URL en cours --- */
.term{margin-top:14px; background:var(--panel2); border:1px solid var(--line); border-radius:9px;
      padding:11px 12px; font-family:var(--mono); font-size:11px; line-height:1.65;
      color:#3d5a78; word-break:break-all; max-height:132px; overflow:auto}
.term .k{color:var(--sky-dark); font-weight:600}

/* --- [EN] Form controls / [FR] Contrôles de formulaire -------------- */
.field{margin-bottom:15px}
.field>label{display:block; font-family:var(--mono); font-size:10.5px; letter-spacing:.13em;
  text-transform:uppercase; color:var(--muted); font-weight:700; margin-bottom:6px}
.field small{display:block; color:#8494a8; font-size:11.5px; margin-top:5px}
.row{display:grid; grid-template-columns:1fr 1fr; gap:14px}
@media(max-width:600px){.row{grid-template-columns:1fr}}
input[type=text],input[type=number],select{
  width:100%; background:#fff; color:var(--text); border:1px solid #d9e4ef;
  border-radius:9px; padding:10px 12px; font-size:13.5px; font-family:var(--body); outline:none;
  transition:border-color .15s, box-shadow .15s}
input[type=text]{font-family:var(--mono); font-size:12.5px}
input[type=text]:hover,input[type=number]:hover,select:hover{border-color:#bed3e7}
input:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible{
  outline:none; border-color:var(--sky); box-shadow:0 0 0 3px rgba(47,155,240,.22)}
a:focus-visible,button:focus-visible{outline:2px solid var(--sky); outline-offset:2px}
input::placeholder{color:#a9b8c9}
select{appearance:none; background-image:linear-gradient(45deg,transparent 50%,var(--muted) 50%),
  linear-gradient(135deg,var(--muted) 50%,transparent 50%);
  background-position:calc(100% - 17px) 50%,calc(100% - 12px) 50%;
  background-size:5px 5px,5px 5px; background-repeat:no-repeat; padding-right:34px}
input[type=color]{width:100%; height:42px; padding:3px; background:#fff;
  border:1px solid #d9e4ef; border-radius:9px; cursor:pointer}

.btn{display:inline-flex; align-items:center; justify-content:center; gap:7px; cursor:pointer;
  border:1px solid #d9e4ef; background:#fff; color:var(--text); border-radius:9px;
  padding:10px 14px; font-size:12.5px; font-weight:600; font-family:var(--body); text-decoration:none;
  transition:border-color .15s, background .15s, color .15s}
.btn:hover{border-color:var(--sky); color:var(--sky-dark); background:var(--sky-soft)}
.btn-primary{background:var(--sky); border-color:var(--sky); color:#fff; font-weight:700}
.btn-primary:hover{background:var(--sky-dark); border-color:var(--sky-dark); color:#fff}
.btn-block{display:flex; width:100%}
.btnRow{display:flex; gap:8px; flex-wrap:wrap}
.btnRow .btn{flex:1; min-width:120px}

/* --- [EN] Direction pickers / [FR] Sélecteurs de direction ---------- */
.dirs{display:grid; grid-template-columns:repeat(8,1fr); gap:6px}
@media(max-width:1200px){.dirs{grid-template-columns:repeat(4,1fr)}}
.dir{position:relative; border:1px solid #dde8f2; border-radius:9px; background:#fff;
  cursor:pointer; padding:2px; overflow:hidden; transition:border-color .15s, background .15s, box-shadow .15s}
.dir:hover{border-color:#b6d3ee; background:var(--panel2)}
.dir.on{border-color:var(--sky); background:var(--sky-soft); box-shadow:0 0 0 2px rgba(47,155,240,.18)}
.dir img{width:100%; display:block; image-rendering:pixelated; min-height:34px}
.dir img:not([src]){display:none}
.dir:has(img:not([src])){min-height:44px}
.dir i{position:absolute; top:3px; left:4px; font-style:normal; font-family:var(--mono);
  font-size:9px; color:#a3b3c6}
.dir.on i{color:var(--sky-dark)}

/* --- [EN] Action chips / [FR] Puces d'action ------------------------ */
.chips{display:flex; flex-wrap:wrap; gap:8px}
.chip{border:1px solid #d9e4ef; background:#fff; color:var(--text); border-radius:999px;
  padding:7px 14px; font-size:12.5px; font-weight:600; cursor:pointer; font-family:var(--body);
  transition:border-color .15s, background .15s, color .15s}
.chip:hover{border-color:#b6d3ee; background:var(--panel2)}
.chip.on{border-color:var(--sky); background:var(--sky-soft); color:var(--sky-dark)}

/* --- [EN] Inline messages / [FR] Messages en ligne ------------------ */
.msg{margin-top:12px; font-size:13px; min-height:19px}
.msg .ok{color:var(--ok); font-weight:600}
.msg .err{color:var(--err)}
.msg .wait{color:var(--muted)}
.note{border:1px solid #cfe6fb; background:var(--sky-soft); color:#155a8a; border-radius:9px;
  padding:11px 13px; font-size:12.5px; margin-bottom:16px}
.inline{display:flex; gap:8px}
.inline input{flex:1}

/* --- [EN] Username suggestions / [FR] Suggestions de pseudos -------- */
.sugList{margin-top:6px; border:1px solid var(--line); border-radius:9px; background:#fff;
  overflow:hidden; max-height:262px; overflow-y:auto; box-shadow:var(--shadow)}
.sug{display:flex; align-items:center; gap:10px; width:100%; text-align:left; cursor:pointer;
  background:none; border:0; border-bottom:1px solid var(--line); padding:6px 10px;
  color:var(--text); font-family:var(--body); font-size:13px}
.sug:last-child{border-bottom:0}
.sug:hover{background:var(--sky-soft)}
.sug img{width:28px; height:28px; object-fit:contain; image-rendering:pixelated; flex:none}
.foot{max-width:1240px; margin:0 auto; padding:6px 22px 34px; color:#93a3b6; font-size:11.5px;
  font-family:var(--mono); letter-spacing:.04em}
@media (prefers-reduced-motion:reduce){*{animation:none!important; transition:none!important}}
</style>
</head>
<body>

<header class="top">
  <div class="topIn">
    <div class="brand"><b>&#9632;</b> ${esc(title)}</div>
    <div class="tagline">nitro render &middot; @pixi/node &middot; /avatarimage</div>
    ${ logoutEnabled
        // [EN] Only rendered when the login gate is on.
        // [FR] Affiché uniquement quand le portail de connexion est actif.
        ? `<a class="btn" style="padding:6px 12px;font-size:12px" href="${ esc(base) }/logout">Se déconnecter</a>`
        : '' }
  </div>
</header>

<div class="wrap">
<div class="grid">

  <!-- [EN] LEFT: live preview, URL and export actions.
       [FR] GAUCHE : aperçu en direct, URL et actions d'export. -->
  <div class="col-left">
    <div class="card">
      <h2>Aperçu</h2>
      <div class="preview" id="pv">
        <img id="pvImg" alt="Aperçu de l'avatar">
        <div class="load" id="pvLoad" style="display:none"><div class="spin"></div></div>
      </div>
      <div class="term" id="urlBox">—</div>
      <div class="btnRow" style="margin-top:12px">
        <button type="button" class="btn" id="copyUrl">Copier l'adresse</button>
        <a class="btn" id="dl" download="avatar.png">Télécharger</a>
      </div>
      <button type="button" class="btn btn-block" id="copyImg" style="margin-top:8px">Copier la balise &lt;img&gt;</button>
      <button type="button" class="btn btn-block" id="copyPage" style="margin-top:8px">Copier le lien de ce réglage</button>
      <div class="msg" id="msg"></div>
    </div>
  </div>

  <!-- [EN] RIGHT: every render parameter. [FR] DROITE : tous les paramètres de rendu. -->
  <div>
    <div class="card">
      <h2>Personnage</h2>
      <!-- [EN] The "load a player" field only exists when a lookup backend is
               available (database or HTTP link). With neither, the panel is a
               pure creation tool and the figure field takes the full width.
           [FR] Le champ « charger un joueur » n'existe que si une source de
               recherche est disponible (base de données ou lien HTTP). Sans
               aucune des deux, le panel est un pur outil de création et le champ
               figure occupe toute la largeur. -->
      <div class="${ lookupEnabled ? 'row' : '' }">
        ${ lookupEnabled ? `<div class="field" id="userField">
          <label for="fUser">Pseudo du joueur</label>
          <div class="inline">
            <input type="text" id="fUser" placeholder="Pseudo…" autocomplete="off" spellcheck="false">
            <button type="button" class="btn" id="fetchLook" style="white-space:nowrap">Charger</button>
          </div>
          <!-- [EN] Suggestions are injected here. [FR] Les suggestions sont injectées ici. -->
          <div class="sugList" id="sugList" style="display:none"></div>
          <small>${ searchEnabled ? 'Tape 2 lettres pour voir les suggestions.' : 'Récupère la tenue actuelle du joueur.' }</small>
        </div>` : '' }
        <div class="field" style="margin-bottom:0">
          <label for="fFigure">Figure</label>
          <input type="text" id="fFigure" value="${esc(figure)}" spellcheck="false" autocomplete="off"
                 placeholder="hd-180-1.ch-255-66.lg-280-110">
          <small>Modifiable directement.</small>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Orientation</h2>
      <div class="field">
        <label>Direction du corps</label>
        <div class="dirs" id="bodyDirs"></div>
      </div>
      <div class="field" style="margin-bottom:0">
        <label>Direction de la tête</label>
        <div class="dirs" id="headDirs"></div>
      </div>
    </div>

    <div class="card">
      <h2>Pose</h2>
      <div class="row">
        <div class="field">
          <label>Action</label>
          <div class="chips" id="actChips">
            <button type="button" class="chip on" data-act="">Aucune</button>
            <button type="button" class="chip" data-act="wlk">Marche</button>
            <button type="button" class="chip" data-act="sit">Assis</button>
            <button type="button" class="chip" data-act="lay">Allongé</button>
            <button type="button" class="chip" data-act="wav">Salue</button>
            <button type="button" class="chip" data-act="drk=1">Boit</button>
            <button type="button" class="chip" data-act="crr=1">Tient</button>
          </div>
        </div>
        <div class="field">
          <label for="fGesture">Expression</label>
          <select id="fGesture">
            <option value="std">Normale</option>
            <option value="sml">Sourire</option>
            <option value="sad">Triste</option>
            <option value="agr">En colère</option>
            <option value="srp">Surprise</option>
          </select>
        </div>
      </div>
      <div class="row">
        <div class="field">
          <label for="fSize">Taille</label>
          <select id="fSize">
            <option value="s">Petite</option>
            <option value="n" selected>Normale</option>
            <option value="l">Grande</option>
          </select>
        </div>
        <div class="field">
          <label for="fHeadonly">Cadrage</label>
          <select id="fHeadonly">
            <option value="0">Corps entier</option>
            <option value="1">Tête seule</option>
          </select>
        </div>
      </div>
      <div class="row" style="margin-bottom:0">
        <div class="field" style="margin-bottom:0">
          <label for="fEffect">Effet</label>
          <input type="number" id="fEffect" value="0" min="0" max="500">
          <small>0 = aucun.</small>
        </div>
        <div class="field" style="margin-bottom:0">
          <label for="fDance">Danse</label>
          <select id="fDance">
            <option value="0">Aucune</option>
            <option value="1">Danse 1</option>
            <option value="2">Danse 2</option>
            <option value="3">Danse 3</option>
            <option value="4">Danse 4</option>
          </select>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Bulle de texte</h2>
      <div class="field">
        <label for="fText">Message</label>
        <input type="text" id="fText" maxlength="100" placeholder="Laisse vide pour ne pas afficher de bulle">
      </div>
      <div class="row" style="margin-bottom:0">
        <div class="field" style="margin-bottom:0">
          <label for="fTextColor">Couleur du texte</label>
          <input type="color" id="fTextColor" value="#000000">
        </div>
        <div class="field" style="margin-bottom:0">
          <label for="fBubbleColor">Couleur de la bulle</label>
          <input type="color" id="fBubbleColor" value="#ffffff">
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Sortie</h2>
      <div class="row" style="margin-bottom:0">
        <div class="field" style="margin-bottom:0">
          <label for="fFormat">Format</label>
          <select id="fFormat">
            <option value="auto">Automatique</option>
            <option value="png">PNG fixe</option>
            <option value="apng">APNG animé</option>
          </select>
          <small>Les danses et effets nécessitent l'APNG.</small>
        </div>
        <div class="field" style="margin-bottom:0">
          <label for="fFrame">Image de l'animation</label>
          <input type="number" id="fFrame" value="0" min="0" max="60">
          <small>Utile en PNG fixe.</small>
        </div>
      </div>
      <div class="btnRow" style="margin-top:16px">
        <button type="button" class="btn" id="reset">Réinitialiser</button>
        <button type="button" class="btn btn-primary" id="refresh">Régénérer l'aperçu</button>
      </div>
    </div>
  </div>

</div>
</div>
<div class="foot">GET /avatarimage &middot; figure · action · gesture · direction · head_direction · headonly · dance · effect · size · frame_num · img_format · text · text_color · bubble_color</div>

<script>
/* =====================================================================
   [EN] Page logic. Same behaviour as the CMS page, minus the CMS: the
        preview is a plain <img> pointed at /avatarimage, so what you see
        is exactly what any site embedding that URL will get.
   [FR] Logique de la page. Même comportement que la page CMS, sans le
        CMS : l'aperçu est un simple <img> pointé sur /avatarimage, donc
        ce que vous voyez est exactement ce qu'obtiendra tout site qui
        intègre cette URL.
   ===================================================================== */
(function () {
  'use strict';

  /* [EN] Values injected by the server. [FR] Valeurs injectées par le serveur. */
  var IMAGER   = ${js(imagerUrl)};   // [EN] /avatarimage endpoint  [FR] point d'entrée /avatarimage
  var BASE     = ${js(base)};        // [EN] this panel's own path  [FR] chemin propre au panel
  var LOOKUP   = ${js(lookupEnabled)};  // [EN] pseudo -> figure on  [FR] pseudo -> figure activé
  var SEARCH   = ${js(searchEnabled)};  // [EN] live suggestions on  [FR] suggestions activées
  var API_KEY  = ${js(apiKey)};      // [EN] optional ?key=         [FR] ?key= optionnel
  var TOKEN    = ${js(token)};       // [EN] page access token      [FR] jeton d'accès à la page
  var PRESET   = ${js(query)};       // [EN] pre-fill from the URL  [FR] pré-remplissage depuis l'URL

  var $ = function (id) { return document.getElementById(id); };
  var val = function (id) { var e = $(id); return e ? e.value : ''; };
  var hex = function (id) { return (val(id) || '').replace('#', ''); };

  /* [EN] The only mutable state not held by an input.
     [FR] Le seul état mutable qui n'est pas porté par un champ. */
  var state = { direction: 2, head_direction: 2, action: '' };

  var $fig = $('fFigure');
  var $img = $('pvImg');
  var $load = $('pvLoad');
  var $urlBox = $('urlBox');
  var $dl = $('dl');
  var $msg = $('msg');
  var timer = null;

  /* ----------------------------------------------------------------
     [EN] Build the /avatarimage query from the form. Mirrors the
          buildParams() of media.php: only non-default values are sent so
          the produced URL stays short and cache-friendly.
     [FR] Construit la requête /avatarimage à partir du formulaire.
          Reprend le buildParams() de media.php : seules les valeurs non
          par défaut sont envoyées, pour garder une URL courte et bien
          mise en cache.
     ---------------------------------------------------------------- */
  function buildParams(extra) {
    var p = {};
    p.figure = ($fig.value || '').trim();
    p.direction = state.direction;
    p.head_direction = state.head_direction;
    p.gesture = val('fGesture') || 'std';
    p.size = val('fSize') || 'n';

    if (state.action) { p.action = state.action; }
    if (val('fHeadonly') === '1') { p.headonly = 1; }
    if (parseInt(val('fEffect'), 10) > 0) { p.effect = parseInt(val('fEffect'), 10); }
    if (parseInt(val('fDance'), 10) > 0) { p.dance = parseInt(val('fDance'), 10); }
    if (parseInt(val('fFrame'), 10) > 0) { p.frame_num = parseInt(val('fFrame'), 10); }
    if (val('fFormat') !== 'auto') { p.img_format = val('fFormat'); }

    var txt = (val('fText') || '').trim();
    if (txt) {
      p.text = txt;
      p.text_color = hex('fTextColor') || '000000';
      p.bubble_color = hex('fBubbleColor') || 'ffffff';
    }
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    return p;
  }

  function qs(p) {
    return Object.keys(p).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]);
    }).join('&');
  }

  /* [EN] Append the API key only when the service actually requires one.
     [FR] N'ajoute la clé d'API que si le service en exige une. */
  function imageUrl(p) {
    var q = qs(p);
    if (API_KEY) { q += '&key=' + encodeURIComponent(API_KEY); }
    return IMAGER + '?' + q;
  }

  /* [EN] Colourise the query string in the terminal readout.
     [FR] Colorise la chaîne de requête dans l'affichage terminal. */
  function paintUrl(url) {
    var cut = url.indexOf('?');
    var head = cut === -1 ? url : url.slice(0, cut + 1);
    var tail = cut === -1 ? '' : url.slice(cut + 1);
    var html = head.replace(/[<>&]/g, '') +
      tail.split('&').map(function (pair) {
        var i = pair.indexOf('=');
        var k = i === -1 ? pair : pair.slice(0, i);
        var v = i === -1 ? '' : pair.slice(i + 1);
        return '<span class="k">' + k.replace(/[<>&]/g, '') + '</span>=' + v.replace(/[<>&]/g, '');
      }).join('&amp;');
    $urlBox.innerHTML = html;
  }

  /* ----------------------------------------------------------------
     [EN] Refresh preview + URL + thumbnails, and keep the page URL in
          sync so the current settings can simply be bookmarked/shared.
     [FR] Rafraîchit l'aperçu, l'URL et les vignettes, et garde l'URL de
          la page synchronisée : le réglage courant est donc partageable
          par simple copie du lien.
     ---------------------------------------------------------------- */
  function refresh() {
    var params = buildParams();
    if (!params.figure) {
      $urlBox.textContent = 'Indique une figure pour lancer le rendu.';
      $img.removeAttribute('src');
      return;
    }
    var url = imageUrl(params);
    paintUrl(url);
    $dl.href = url;
    $dl.setAttribute('download', 'avatar-' + params.figure.slice(0, 24) + '.png');
    $load.style.display = 'flex';
    $img.onload = $img.onerror = function () { $load.style.display = 'none'; };
    $img.src = url;

    /* [EN] Keep the access token in the address bar, or reloading the page
           would 404. [FR] Garde le jeton d'accès dans la barre d'adresse, sinon
           un rechargement de la page renverrait une 404. */
    try {
      var pageQs = qs(params) + (TOKEN ? '&token=' + encodeURIComponent(TOKEN) : '');
      history.replaceState(null, '', location.pathname + '?' + pageQs);
    } catch (e) {}
    drawDirs();
  }

  /* [EN] Debounce for text/number inputs. [FR] Anti-rebond pour les champs texte/nombre. */
  function schedule() { clearTimeout(timer); timer = setTimeout(refresh, 350); }

  /* ----------------------------------------------------------------
     [EN] The two 8-way direction strips. Each cell is itself a tiny
          render (size=s), so the picker shows the real avatar rather
          than an arrow icon.
     [FR] Les deux bandes de direction sur 8 positions. Chaque case est
          elle-même un mini-rendu (size=s) : le sélecteur montre donc le
          vrai avatar plutôt qu'une icône de flèche.
     ---------------------------------------------------------------- */
  function buildDirGrids() {
    var host = { direction: $('bodyDirs'), head_direction: $('headDirs') };
    for (var d = 0; d < 8; d++) {
      ['direction', 'head_direction'].forEach(function (kind) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'dir';
        b.dataset.kind = kind;
        b.dataset.dir = d;
        b.title = 'Direction ' + d;
        b.innerHTML = '<i>' + d + '</i><img alt="">';
        b.addEventListener('click', function () {
          state[this.dataset.kind] = parseInt(this.dataset.dir, 10);
          refresh();
        });
        host[kind].appendChild(b);
      });
    }
  }

  function drawDirs() {
    var f = ($fig.value || '').trim();
    if (!f) { return; }
    var list = document.querySelectorAll('.dir');
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var kind = b.dataset.kind;
      var d = parseInt(b.dataset.dir, 10);
      b.classList.toggle('on', state[kind] === d);

      var p = { figure: f, size: 's', gesture: val('fGesture') || 'std' };
      if (kind === 'direction') {
        p.direction = d; p.head_direction = d;
      } else {
        p.direction = state.direction; p.head_direction = d; p.headonly = 1;
      }
      var u = imageUrl(p);
      var im = b.querySelector('img');
      /* [EN] Only touch src when it changed, or the browser refetches 16
             images on every keystroke. [FR] On ne touche à src que s'il a
             changé, sinon le navigateur recharge 16 images à chaque frappe. */
      if (im.getAttribute('src') !== u) { im.src = u; }
    }
  }

  /* ----------------------------------------------------------------
     [EN] Wire up the inputs.
     [FR] Branchement des champs.
     ---------------------------------------------------------------- */
  var chips = document.querySelectorAll('#actChips .chip');
  for (var c = 0; c < chips.length; c++) {
    chips[c].addEventListener('click', function () {
      for (var k = 0; k < chips.length; k++) { chips[k].classList.remove('on'); }
      this.classList.add('on');
      state.action = this.dataset.act;
      refresh();
    });
  }

  ['fGesture', 'fSize', 'fHeadonly', 'fEffect', 'fDance', 'fFormat', 'fFrame',
   'fText', 'fTextColor', 'fBubbleColor'].forEach(function (id) {
    var e = $(id);
    if (!e) { return; }
    e.addEventListener('change', refresh);
    e.addEventListener('input', schedule);
  });
  $fig.addEventListener('input', schedule);
  $('refresh').addEventListener('click', refresh);

  /* [EN] Reset returns every control to the service defaults.
     [FR] La réinitialisation remet chaque contrôle aux valeurs par défaut. */
  $('reset').addEventListener('click', function () {
    state = { direction: 2, head_direction: 2, action: '' };
    $('fGesture').value = 'std'; $('fSize').value = 'n'; $('fHeadonly').value = '0';
    $('fEffect').value = '0'; $('fDance').value = '0'; $('fFormat').value = 'auto';
    $('fFrame').value = '0'; $('fText').value = '';
    $('fTextColor').value = '#000000'; $('fBubbleColor').value = '#ffffff';
    for (var k = 0; k < chips.length; k++) { chips[k].classList.toggle('on', chips[k].dataset.act === ''); }
    refresh();
  });

  /* ----------------------------------------------------------------
     [EN] Username -> figure. Replaces the CMS SQL query: the service
          proxies the lookup to whatever endpoint the hotel configured
          (AVATAR_IMAGING_LOOKUP_URL), so no database driver is needed.
          When it is not configured the field is hidden entirely.
     [FR] Pseudo -> figure. Remplace la requête SQL du CMS : le service
          relaie la recherche vers le point d'entrée configuré par
          l'hôtel (AVATAR_IMAGING_LOOKUP_URL), aucun pilote de base de
          données n'est donc nécessaire. Si ce n'est pas configuré, le
          champ est simplement masqué.
     ---------------------------------------------------------------- */
  var tokenQs = TOKEN ? '&token=' + encodeURIComponent(TOKEN) : '';

  /* [EN] No lookup backend => the field was never rendered, nothing to wire.
     [FR] Aucune source de recherche => le champ n'a jamais été rendu, rien à brancher. */
  if (LOOKUP && $('fUser')) {
    var $sug = $('sugList');
    var sugTimer = null;

    /* [EN] Exact pseudo -> figure (the "Charger" button and Enter).
       [FR] Pseudo exact -> figure (le bouton « Charger » et Entrée). */
    var doLookup = function (name) {
      var u = (name || val('fUser') || '').trim();
      if (!u) { return; }
      hideSug();
      $msg.innerHTML = '<span class="wait">Recherche de ' + u.replace(/[<>&]/g, '') + '…</span>';
      fetch(BASE + '/look?username=' + encodeURIComponent(u) + tokenQs, { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.figure) {
            $fig.value = d.figure;
            $('fUser').value = d.username || u;
            $msg.innerHTML = '<span class="ok">Tenue de ' + (d.username || u).replace(/[<>&]/g, '') + ' chargée.</span>';
            refresh();
          } else {
            $msg.innerHTML = '<span class="err">' + ((d && d.error) || 'Joueur introuvable.') + '</span>';
          }
        })
        .catch(function () { $msg.innerHTML = '<span class="err">Recherche indisponible.</span>'; });
    };

    function hideSug() { if ($sug) { $sug.style.display = 'none'; $sug.innerHTML = ''; } }

    /* ----------------------------------------------------------------
       [EN] Live suggestions while typing (database mode only). Each row
            shows the player's real head next to the name, so picking the
            right "Val" among five is a glance rather than a guess.
       [FR] Suggestions en direct pendant la saisie (mode base de données
            uniquement). Chaque ligne montre la vraie tête du joueur à côté
            du nom : choisir le bon « Val » parmi cinq se fait d'un coup
            d'œil plutôt qu'au hasard.
       ---------------------------------------------------------------- */
    function suggest() {
      if (!SEARCH || !$sug) { return; }
      var q = (val('fUser') || '').trim();
      if (q.length < 2) { hideSug(); return; }

      fetch(BASE + '/search?q=' + encodeURIComponent(q) + tokenQs, { headers: { 'Accept': 'application/json' } })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok || !d.results || !d.results.length) { hideSug(); return; }
          $sug.innerHTML = '';
          d.results.forEach(function (row) {
            var li = document.createElement('button');
            li.type = 'button';
            li.className = 'sug';
            var head = imageUrl({ figure: row.figure, headonly: 1, size: 's', direction: 2, head_direction: 2 });
            li.innerHTML = '<img alt="" src="' + head + '"><span></span>';
            li.querySelector('span').textContent = row.username;
            li.addEventListener('click', function () {
              $('fUser').value = row.username;
              $fig.value = row.figure;
              hideSug();
              $msg.innerHTML = '<span class="ok">Tenue de ' + row.username.replace(/[<>&]/g, '') + ' chargée.</span>';
              refresh();
            });
            $sug.appendChild(li);
          });
          $sug.style.display = 'block';
        })
        .catch(hideSug);
    }

    $('fetchLook').addEventListener('click', function () { doLookup(); });
    $('fUser').addEventListener('input', function () {
      clearTimeout(sugTimer);
      sugTimer = setTimeout(suggest, 250);
    });
    $('fUser').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doLookup(); }
      if (e.key === 'Escape') { hideSug(); }
    });
    /* [EN] Close the list when clicking elsewhere. [FR] Ferme la liste au clic ailleurs. */
    document.addEventListener('click', function (e) {
      if ($sug && !$('userField').contains(e.target)) { hideSug(); }
    });
  }

  /* ----------------------------------------------------------------
     [EN] Export helpers. The CMS version saved into the media library;
          standalone, the useful equivalents are: copy the image URL,
          copy a ready-made <img> tag, copy a link to this exact setup,
          and download the file.
     [FR] Aides à l'export. La version CMS enregistrait dans la
          médiathèque ; en autonome, les équivalents utiles sont : copier
          l'URL de l'image, copier une balise <img> prête à l'emploi,
          copier un lien vers ce réglage exact, et télécharger le fichier.
     ---------------------------------------------------------------- */
  function copy(text, btn, label) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = label;
      setTimeout(function () { btn.textContent = old; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        $msg.innerHTML = '<span class="err">Copie refusée par le navigateur (HTTPS requis).</span>';
      });
    } else {
      /* [EN] Fallback for plain-HTTP origins. [FR] Repli pour les origines en HTTP simple. */
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
    }
  }

  $('copyUrl').addEventListener('click', function () {
    copy(imageUrl(buildParams()), this, 'Copié !');
  });
  $('copyImg').addEventListener('click', function () {
    copy('<img src="' + imageUrl(buildParams()) + '" alt="avatar">', this, 'Balise copiée !');
  });
  $('copyPage').addEventListener('click', function () {
    var link = location.origin + location.pathname + '?' + qs(buildParams()) +
               (TOKEN ? '&token=' + encodeURIComponent(TOKEN) : '');
    copy(link, this, 'Lien copié !');
  });

  /* ----------------------------------------------------------------
     [EN] Pre-fill from the page's own query string, so /Generate?figure=…
          &effect=14 opens ready to tweak (and the "copy this setup" link
          round-trips).
     [FR] Pré-remplissage depuis la chaîne de requête de la page :
          /Generate?figure=…&effect=14 s'ouvre donc prêt à être ajusté (et
          le lien « copier ce réglage » fait bien l'aller-retour).
     ---------------------------------------------------------------- */
  function applyPreset(p) {
    if (!p) { return; }
    if (p.figure) { $fig.value = p.figure; }
    if (p.direction !== undefined) { state.direction = parseInt(p.direction, 10) || 0; }
    if (p.head_direction !== undefined) { state.head_direction = parseInt(p.head_direction, 10) || 0; }
    if (p.action) {
      state.action = p.action;
      for (var k = 0; k < chips.length; k++) { chips[k].classList.toggle('on', chips[k].dataset.act === p.action); }
    }
    var map = { gesture: 'fGesture', size: 'fSize', headonly: 'fHeadonly', effect: 'fEffect',
                dance: 'fDance', img_format: 'fFormat', frame_num: 'fFrame', text: 'fText' };
    Object.keys(map).forEach(function (key) {
      if (p[key] !== undefined && p[key] !== '') { var e = $(map[key]); if (e) { e.value = p[key]; } }
    });
    if (p.text_color) { $('fTextColor').value = '#' + String(p.text_color).replace('#', ''); }
    if (p.bubble_color) { $('fBubbleColor').value = '#' + String(p.bubble_color).replace('#', ''); }
  }

  buildDirGrids();
  applyPreset(PRESET);
  refresh();
})();
</script>
</body>
</html>`;

export default renderGeneratePage;
