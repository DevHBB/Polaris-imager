import './env.mjs';
import { buildRendererConfig, FPS, MAX_FRAMES } from './renderer-config.mjs';

export { buildRendererConfig, FPS, MAX_FRAMES };

const env = process.env;

const int = (value, fallback) => {
    const parsed = parseInt(value, 10);

    return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value) => ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());

const trustProxy = (value) => {
    if (value === undefined || value === '') return false;
    if (value === 'true') return true;
    if (value === 'false') return false;

    const n = parseInt(value, 10);

    return Number.isFinite(n) && String(n) === value.trim() ? n : value;
};

const list = (value, fallback) => {
    if (!value || !value.trim().length) return fallback;

    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
};

export const CONFIG = {
    host: env.AVATAR_IMAGING_HOST || '0.0.0.0',
    port: int(env.AVATAR_IMAGING_PORT, 8082),

    concurrency: 1,

    renderTimeoutMs: int(env.AVATAR_IMAGING_RENDER_TIMEOUT_MS, 30000),

    bootTimeoutMs: int(env.AVATAR_IMAGING_BOOT_TIMEOUT_MS, 60000),

    animationFps: FPS,
    maxFrames: MAX_FRAMES,

    cacheEntries: int(env.AVATAR_IMAGING_CACHE_ENTRIES, 512),
    cacheMaxBytes: int(env.AVATAR_IMAGING_CACHE_MAX_BYTES, 256 * 1024 * 1024),
    cacheTtlMs: int(env.AVATAR_IMAGING_CACHE_TTL_MS, 5 * 60 * 1000),

    assetVersion: (env.AVATAR_IMAGING_ASSET_VERSION || '').trim(),

    debug: bool(env.AVATAR_IMAGING_DEBUG),

    trustProxy: trustProxy(env.AVATAR_IMAGING_TRUST_PROXY),

    clientIpHeader: (env.AVATAR_IMAGING_CLIENT_IP_HEADER || '').toLowerCase().trim(),

    accessLog: env.AVATAR_IMAGING_ACCESS_LOG === undefined ? true : bool(env.AVATAR_IMAGING_ACCESS_LOG),

    logFile: env.AVATAR_IMAGING_LOG_FILE || null,
    logMaxBytes: int(env.AVATAR_IMAGING_LOG_MAX_BYTES, 10 * 1024 * 1024),
    logMaxFiles: int(env.AVATAR_IMAGING_LOG_MAX_FILES, 5),

    rateLimitWindowMs: int(env.AVATAR_IMAGING_RATELIMIT_WINDOW_MS, 60000),
    rateLimitMax: int(env.AVATAR_IMAGING_RATELIMIT_MAX, 120),

    maxQueue: int(env.AVATAR_IMAGING_MAX_QUEUE, 16),

    apiKeys: list(env.AVATAR_IMAGING_API_KEYS, []),

    corsOrigin: (env.AVATAR_IMAGING_CORS_ORIGIN || '').trim(),

    maxFigureLength: int(env.AVATAR_IMAGING_MAX_FIGURE_LEN, 512),
    maxActionLength: int(env.AVATAR_IMAGING_MAX_ACTION_LEN, 256),
    maxTextLength: int(env.AVATAR_IMAGING_MAX_TEXT_LEN, 100),

    // -----------------------------------------------------------------------
    // [EN] Generator UI (GET /Generate). Everything here is optional: with an
    //      empty .env the page is served publicly on the service's own origin
    //      and the username lookup is hidden.
    // [FR] Interface du générateur (GET /Generate). Tout est optionnel ici :
    //      avec un .env vide, la page est servie publiquement sur l'origine du
    //      service et la recherche par pseudo est masquée.
    // -----------------------------------------------------------------------
    generate: {
        // [EN] Master switch. [FR] Interrupteur principal.
        enabled: env.AVATAR_IMAGING_GENERATE_UI === undefined ? true : bool(env.AVATAR_IMAGING_GENERATE_UI),

        // [EN] Path the page is mounted on. [FR] Chemin sur lequel la page est montée.
        path: (env.AVATAR_IMAGING_GENERATE_PATH || '/Generate').trim(),

        // [EN] Browser title / brand shown in the header.
        // [FR] Titre du navigateur / marque affichée dans l'en-tête.
        title: (env.AVATAR_IMAGING_GENERATE_TITLE || 'Avatar Studio').trim(),

        // [EN] Public base URL of this service (no trailing slash), e.g.
        //      https://avatar.mon-hotel.fr. Empty => same-origin relative URLs.
        // [FR] URL publique de base de ce service (sans slash final), ex.
        //      https://avatar.mon-hotel.fr. Vide => URLs relatives de même origine.
        publicUrl: (env.AVATAR_IMAGING_PUBLIC_URL || '').trim().replace(/\/+$/, ''),

        // [EN] Shared secret required as ?token= to open the page. Empty => public.
        // [FR] Secret partagé exigé en ?token= pour ouvrir la page. Vide => publique.
        token: (env.AVATAR_IMAGING_GENERATE_TOKEN || '').trim(),

        // [EN] Key the page appends to image URLs when AVATAR_IMAGING_API_KEYS is
        //      set. It ends up in the HTML, so use a dedicated key, not an admin one.
        // [FR] Clé que la page ajoute aux URLs d'images quand
        //      AVATAR_IMAGING_API_KEYS est défini. Elle se retrouve dans le HTML :
        //      utilisez une clé dédiée, pas une clé d'administration.
        uiApiKey: (env.AVATAR_IMAGING_GENERATE_KEY || '').trim(),

        // [EN] Figure shown when the panel opens with no ?figure=. It falls back
        //      to a plain default outfit so the panel is never blank on a fresh
        //      install — an empty preview looks broken, not empty.
        // [FR] Figure affichée quand le panel s'ouvre sans ?figure=. Elle retombe
        //      sur une tenue par défaut simple pour que le panel ne soit jamais
        //      vide sur une installation neuve — un aperçu vide a l'air cassé, pas
        //      vide.
        defaultFigure: (env.AVATAR_IMAGING_DEFAULT_FIGURE || '').trim()
            || 'hd-180-1.ch-255-66.lg-280-110.sh-305-62',

        // [EN] Login form. false (default) => the panel is public.
        // [FR] Formulaire de connexion. false (défaut) => panel public.
        authEnabled: bool(env.AVATAR_IMAGING_GENERATE_AUTH),

        // [EN] Two modes:
        //        'password' — one shared account defined right here in .env.
        //                     No database needed; no player account is exposed.
        //        'hotel'    — sign in with a real hotel account, checked against
        //                     the users table, with a minimum rank. REQUIRES
        //                     AVATAR_IMAGING_DB_ENABLED=true.
        // [FR] Deux modes :
        //        'password' — un compte partagé défini ici même dans le .env.
        //                     Aucune base nécessaire ; aucun compte joueur exposé.
        //        'hotel'    — connexion avec un vrai compte de l'hôtel, vérifié
        //                     dans la table des utilisateurs, avec un rang
        //                     minimum. NÉCESSITE AVATAR_IMAGING_DB_ENABLED=true.
        authMode: ['password', 'hotel'].includes((env.AVATAR_IMAGING_GENERATE_AUTH_MODE || 'password').trim().toLowerCase())
            ? (env.AVATAR_IMAGING_GENERATE_AUTH_MODE || 'password').trim().toLowerCase()
            : 'password',

        // [EN] Mode 'password' only. Username optional: leave it empty for a
        //      password-only form. [FR] Mode 'password' uniquement. Identifiant
        //      optionnel : laissez-le vide pour un formulaire mot de passe seul.
        authUser: (env.AVATAR_IMAGING_GENERATE_USER || '').trim(),
        authPassword: (env.AVATAR_IMAGING_GENERATE_PASSWORD || '').trim(),

        // [EN] Mode 'hotel' only: minimum rank allowed into the panel.
        // [FR] Mode 'hotel' uniquement : rang minimum autorisé dans le panel.
        authMinRank: int(env.AVATAR_IMAGING_GENERATE_MIN_RANK, 6),

        // [EN] Brute-force guard on the login form: after this many failures from
        //      one IP, that IP is locked out for the cooldown. Matters most in
        //      'hotel' mode, where a real player account is at stake.
        // [FR] Garde anti-force brute sur le formulaire : après ce nombre
        //      d'échecs depuis une IP, cette IP est bloquée pendant le délai.
        //      Surtout utile en mode 'hotel', où un vrai compte joueur est en jeu.
        authMaxAttempts: int(env.AVATAR_IMAGING_GENERATE_MAX_ATTEMPTS, 8),
        authLockMs: int(env.AVATAR_IMAGING_GENERATE_LOCK_MS, 15 * 60 * 1000),

        // [EN] Cookie signing secret. Empty => random at boot, i.e. everyone is
        //      logged out on restart. Session lifetime in ms (default 12h).
        // [FR] Secret de signature du cookie. Vide => aléatoire au démarrage,
        //      donc tout le monde est déconnecté au redémarrage. Durée de session
        //      en ms (12 h par défaut).
        authSecret: (env.AVATAR_IMAGING_GENERATE_SECRET || '').trim(),
        authTtlMs: int(env.AVATAR_IMAGING_GENERATE_SESSION_MS, 12 * 60 * 60 * 1000),

        // [EN] HTTP fallback for the username lookup, for hotels that prefer not
        //      to give the imager a MySQL account. Ignored when the DB below is
        //      configured.
        // [FR] Repli HTTP pour la recherche par pseudo, pour les hôtels qui
        //      préfèrent ne pas donner de compte MySQL à l'imager. Ignoré si la
        //      base ci-dessous est configurée.
        lookupUrl: (env.AVATAR_IMAGING_LOOKUP_URL || '').trim(),
        lookupHeader: (env.AVATAR_IMAGING_LOOKUP_HEADER || 'X-API-Key').trim(),
        lookupKey: (env.AVATAR_IMAGING_LOOKUP_KEY || '').trim(),
        lookupTimeoutMs: int(env.AVATAR_IMAGING_LOOKUP_TIMEOUT_MS, 8000)
    },

    // -----------------------------------------------------------------------
    // [EN] Hotel database — OPTIONAL and off by default. It is used ONLY by the
    //      panel, and only for SELECT, to turn a username into a figure and to
    //      suggest names while typing.
    //        AVATAR_IMAGING_DB_ENABLED=false (default) => nothing ever connects;
    //          the panel offers avatar creation only, unless an HTTP lookup URL
    //          is set (AVATAR_IMAGING_LOOKUP_URL), which then provides the search.
    //        AVATAR_IMAGING_DB_ENABLED=true            => the search runs on MySQL.
    //      A read-only account with SELECT on the users table is enough.
    // [FR] Base de données de l'hôtel — OPTIONNELLE et désactivée par défaut.
    //      Utilisée UNIQUEMENT par le panel, et uniquement en SELECT, pour
    //      transformer un pseudo en figure et suggérer des noms pendant la saisie.
    //        AVATAR_IMAGING_DB_ENABLED=false (défaut) => rien ne se connecte
    //          jamais ; le panel ne propose que la création d'avatars, sauf si une
    //          URL de recherche HTTP est définie (AVATAR_IMAGING_LOOKUP_URL), qui
    //          assure alors la recherche.
    //        AVATAR_IMAGING_DB_ENABLED=true           => la recherche passe par MySQL.
    //      Un compte en lecture seule avec SELECT sur la table des utilisateurs suffit.
    // -----------------------------------------------------------------------
    db: {
        // [EN] Explicit on/off switch. It must be turned on AND given a user +
        //      database name; anything else means "no database at all" and the
        //      panel simply drops its search field.
        // [FR] Interrupteur explicite. Il doit être activé ET recevoir un
        //      utilisateur + un nom de base ; tout le reste signifie « aucune base »
        //      et le panel retire simplement son champ de recherche.
        enabled: bool(env.AVATAR_IMAGING_DB_ENABLED)
            && Boolean((env.AVATAR_IMAGING_DB_USER || '').trim() && (env.AVATAR_IMAGING_DB_NAME || '').trim()),

        // [EN] True when credentials are present but the switch is off, so the
        //      service can say so at startup instead of leaving you puzzled.
        // [FR] Vrai quand les identifiants sont présents mais l'interrupteur
        //      éteint : le service peut ainsi le signaler au démarrage au lieu de
        //      vous laisser perplexe.
        configuredButOff: !bool(env.AVATAR_IMAGING_DB_ENABLED)
            && Boolean((env.AVATAR_IMAGING_DB_USER || '').trim()),

        host: (env.AVATAR_IMAGING_DB_HOST || '127.0.0.1').trim(),
        port: int(env.AVATAR_IMAGING_DB_PORT, 3306),
        user: (env.AVATAR_IMAGING_DB_USER || '').trim(),
        password: env.AVATAR_IMAGING_DB_PASSWORD || '',
        database: (env.AVATAR_IMAGING_DB_NAME || '').trim(),
        timeoutMs: int(env.AVATAR_IMAGING_DB_TIMEOUT_MS, 8000),

        // [EN] Adjust only if your emulator's schema differs (Polaris and
        //      Arcturus both use users.username / users.look).
        // [FR] À ajuster seulement si le schéma de votre émulateur diffère
        //      (Polaris et Arcturus utilisent tous deux users.username / users.look).
        table: (env.AVATAR_IMAGING_DB_TABLE || 'users').trim(),
        usernameColumn: (env.AVATAR_IMAGING_DB_USERNAME_COLUMN || 'username').trim(),
        lookColumn: (env.AVATAR_IMAGING_DB_LOOK_COLUMN || 'look').trim(),

        // [EN] Read ONLY in auth mode 'hotel'. In every other configuration these
        //      two columns are never selected, so a read-only grant limited to
        //      (username, look) is enough.
        // [FR] Lues UNIQUEMENT en mode d'authentification 'hotel'. Dans toute
        //      autre configuration, ces deux colonnes ne sont jamais
        //      sélectionnées : un droit en lecture limité à (username, look)
        //      suffit donc.
        passwordColumn: (env.AVATAR_IMAGING_DB_PASSWORD_COLUMN || 'password').trim(),
        rankColumn: (env.AVATAR_IMAGING_DB_RANK_COLUMN || 'rank').trim()
    }
};
