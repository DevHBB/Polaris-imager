// ---------------------------------------------------------------------------
// [EN] generate-route.mjs — the HTTP routes behind the generator panel:
//        GET  /Generate          the panel (see generate-page.mjs)
//        GET  /Generate/login    the login form   (only when auth is enabled)
//        POST /Generate/login    sign in          (only when auth is enabled)
//        GET  /Generate/logout   sign out         (only when auth is enabled)
//        GET  /Generate/look     username -> figure
//        GET  /Generate/search   username suggestions
//      Express routing is case-insensitive by default, so /generate works too.
//
// [FR] generate-route.mjs — les routes HTTP derrière le panel du générateur :
//        GET  /Generate          le panel (voir generate-page.mjs)
//        GET  /Generate/login    le formulaire de connexion (si auth activée)
//        POST /Generate/login    connexion                  (si auth activée)
//        GET  /Generate/logout   déconnexion                (si auth activée)
//        GET  /Generate/look     pseudo -> figure
//        GET  /Generate/search   suggestions de pseudos
//      Le routage Express est insensible à la casse : /generate fonctionne aussi.
// ---------------------------------------------------------------------------

import express from 'express';
import { renderGeneratePage } from './generate-page.mjs';
import { createAuth, renderLoginPage } from './generate-auth.mjs';
import { findUserByName, searchUsers } from './db.mjs';

// [EN] Same character set the renderer accepts for a figure, so a broken
//      upstream answer can never be injected into an <img> URL.
// [FR] Même jeu de caractères que celui accepté par le moteur pour une figure :
//      une réponse amont incorrecte ne peut donc jamais être injectée dans une
//      URL <img>.
const FIGURE_RE = /^[A-Za-z0-9._-]+$/;

// [EN] Hotel usernames: letters, digits and the usual separators.
// [FR] Pseudos d'hôtel : lettres, chiffres et les séparateurs habituels.
const USERNAME_RE = /^[A-Za-z0-9 ._:@-]{1,64}$/;

// [EN] Query keys the panel may pre-fill itself with (mirrors /avatarimage).
// [FR] Clés d'URL avec lesquelles le panel peut se pré-remplir (miroir de /avatarimage).
const PRESET_KEYS = [
    'figure', 'action', 'gesture', 'direction', 'head_direction', 'headonly',
    'dance', 'effect', 'size', 'frame_num', 'img_format', 'text', 'text_color', 'bubble_color'
];

const first = (value) => (Array.isArray(value) ? value[0] : value);

const cleanFigure = (value) => {
    const figure = String(value ?? '').trim();

    return FIGURE_RE.test(figure) && figure.includes('-') ? figure : null;
};

// [EN] Walk a JSON answer looking for a figure/look string, so the optional HTTP
//      lookup works with the shapes CMSes actually return.
// [FR] Parcourt une réponse JSON à la recherche d'une chaîne figure/look, pour
//      que la recherche HTTP optionnelle fonctionne avec les formes réellement
//      renvoyées par les CMS.
const extractFigure = (payload, depth = 0) => {
    if (typeof payload === 'string') return cleanFigure(payload);

    if (!payload || typeof payload !== 'object' || depth > 3) return null;

    for (const key of ['figure', 'look', 'figureString', 'avatar', 'data', 'user', 'result', 'player', 'habbo']) {
        const found = extractFigure(payload[key], depth + 1);

        if (found) return found;
    }

    return null;
};

const extractUsername = (payload) => {
    if (!payload || typeof payload !== 'object') return null;

    for (const key of ['username', 'name', 'user_name']) {
        if (typeof payload[key] === 'string' && payload[key].trim()) return payload[key].trim();
    }

    for (const key of ['data', 'user', 'result', 'player', 'habbo']) {
        if (payload[key] && typeof payload[key] === 'object') {
            const found = extractUsername(payload[key]);

            if (found) return found;
        }
    }

    return null;
};

/**
 * [EN] Build the router that serves the generator panel.
 * [FR] Construit le routeur qui sert le panel du générateur.
 *
 * @param {object} CONFIG [EN] The service config (see config.mjs).
 *                        [FR] La configuration du service (voir config.mjs).
 * @returns {import('express').Router}
 */
export const createGenerateRouter = (CONFIG) => {
    const router = express.Router();
    const gen = CONFIG.generate;
    const db = CONFIG.db;
    const auth = createAuth(gen, db);

    // [EN] The panel calls the imaging endpoint by its public URL when one is
    //      configured (useful behind a reverse proxy / sub-path), otherwise by a
    //      same-origin relative path — which is what works out of the box.
    // [FR] Le panel appelle le point d'entrée d'imagerie via son URL publique
    //      quand elle est configurée (utile derrière un reverse proxy / un
    //      sous-chemin), sinon via un chemin relatif de même origine — ce qui
    //      fonctionne d'emblée.
    const imagerUrl = gen.publicUrl ? `${ gen.publicUrl }/avatarimage` : '/avatarimage';

    // [EN] The username lookup needs either the database or the HTTP endpoint.
    // [FR] La recherche par pseudo nécessite soit la base, soit le point d'entrée HTTP.
    const lookupAvailable = db.enabled || Boolean(gen.lookupUrl);

    // [EN] Only the DB backend can suggest names while typing.
    // [FR] Seule la base peut suggérer des pseudos pendant la saisie.
    const searchAvailable = db.enabled;

    // [EN] Cookies must be marked Secure behind HTTPS, but not on a plain-HTTP
    //      LAN test, or the browser would silently drop them.
    // [FR] Les cookies doivent être marqués Secure derrière HTTPS, mais pas sur
    //      un test LAN en HTTP simple, sinon le navigateur les jetterait
    //      silencieusement.
    const isSecure = (req) => req.secure || req.get('x-forwarded-proto') === 'https';

    // [EN] In 'hotel' mode the username is always required (it names the
    //      account); in 'password' mode it is optional.
    // [FR] En mode « hotel » le pseudo est toujours requis (il désigne le
    //      compte) ; en mode « password » il est optionnel.
    const hotelMode = gen.authMode === 'hotel';
    const withUser = hotelMode || Boolean(gen.authUser);

    const loginPage = (req, error = '') => renderLoginPage({
        title: gen.title,
        action: `${ req.baseUrl }/login`,
        withUser,
        hotelMode,
        error
    });

    // [EN] Fail CLOSED on a broken auth setup. If the login gate was asked for
    //      but cannot possibly work, the panel must not silently fall back to
    //      being public — it answers 503 with the reason instead.
    // [FR] Échec FERMÉ en cas de configuration d'authentification cassée. Si le
    //      portail a été demandé mais ne peut pas fonctionner, le panel ne doit
    //      pas redevenir public en silence — il répond 503 avec la raison.
    const authProblem = (() => {
        if (!gen.authEnabled) return null;
        if (hotelMode && !db.enabled) {
            return 'AVATAR_IMAGING_GENERATE_AUTH_MODE=hotel requires AVATAR_IMAGING_DB_ENABLED=true.';
        }
        if (!hotelMode && !gen.authPassword) {
            return 'AVATAR_IMAGING_GENERATE_PASSWORD is empty.';
        }

        return null;
    })();

    // -----------------------------------------------------------------------
    // [EN] Access gate. Two independent, optional locks:
    //        - a shared ?token=... in the URL (simplest, shareable link)
    //        - a real login form with a cookie session
    //      Both off => the panel is public, like the rest of the service.
    // [FR] Verrou d'accès. Deux serrures indépendantes et optionnelles :
    //        - un ?token=... partagé dans l'URL (le plus simple, lien partageable)
    //        - un vrai formulaire de connexion avec session par cookie
    //      Les deux désactivées => le panel est public, comme le reste du service.
    // -----------------------------------------------------------------------
    const guard = (req, res, next) => {
        if (gen.token && first(req.query.token) !== gen.token) return res.status(404).end();

        if (authProblem) {
            return res.status(503).type('text/plain')
                .send(`Panel disabled: broken login configuration.\n${ authProblem }`);
        }

        if (!gen.authEnabled) return next();

        if (auth.session(req)) return next();

        // [EN] API calls get JSON, page loads get the form.
        // [FR] Les appels d'API reçoivent du JSON, les chargements de page le formulaire.
        if (req.path !== '/') {
            return res.status(401).json({ ok: false, error: 'Session expirée, reconnecte-toi.' });
        }

        return res.status(401).type('text/html; charset=utf-8').send(loginPage(req));
    };

    // -----------------------------------------------------------------------
    // [EN] Login / logout, declared before the guard so they stay reachable.
    // [FR] Connexion / déconnexion, déclarées avant le verrou pour rester
    //      joignables.
    // -----------------------------------------------------------------------
    if (gen.authEnabled) {
        router.get('/login', (req, res) => {
            res.set('Cache-Control', 'no-store');

            if (auth.session(req)) return res.redirect(req.baseUrl || '/Generate');

            return res.type('text/html; charset=utf-8').send(loginPage(req));
        });

        // [EN] express.urlencoded is applied to this one route only, so the rest
        //      of the service keeps parsing no request bodies at all.
        // [FR] express.urlencoded n'est appliqué qu'à cette route : le reste du
        //      service continue de n'analyser aucun corps de requête.
        router.post('/login', express.urlencoded({ extended: false, limit: '2kb' }), async (req, res) => {
            res.set('Cache-Control', 'no-store');

            if (authProblem) {
                return res.status(503).type('text/plain').send(`Panel disabled: ${ authProblem }`);
            }

            const username = String(req.body?.username ?? '').trim();
            const password = String(req.body?.password ?? '');
            const ip = req.ip || req.socket?.remoteAddress || 'unknown';

            const result = await auth.authenticate(username, password, ip);

            if (!result.ok) {
                console.warn(`[pixinode] failed panel login (${ gen.authMode }) from ${ ip }`);

                return res.status(401).type('text/html; charset=utf-8').send(loginPage(req, result.error));
            }

            auth.issue(res, result.username, isSecure(req));

            return res.redirect(req.baseUrl || '/Generate');
        });

        router.get('/logout', (req, res) => {
            auth.clear(res);

            return res.redirect(`${ req.baseUrl }/login`);
        });
    }

    router.use(guard);

    // -----------------------------------------------------------------------
    // [EN] GET /Generate — the panel itself.
    // [FR] GET /Generate — le panel lui-même.
    // -----------------------------------------------------------------------
    router.get('/', (req, res) => {
        // [EN] Forward known parameters to the page so a shared link reopens the
        //      exact same settings.
        // [FR] Transmet les paramètres connus à la page pour qu'un lien partagé
        //      rouvre exactement les mêmes réglages.
        const preset = {};

        for (const key of PRESET_KEYS) {
            const value = first(req.query[key]);

            if (value !== undefined && value !== '') preset[key] = String(value).slice(0, 512);
        }

        const html = renderGeneratePage({
            imagerUrl,
            base: req.baseUrl,
            lookupEnabled: lookupAvailable,
            searchEnabled: searchAvailable,
            logoutEnabled: gen.authEnabled,
            apiKey: gen.uiApiKey,
            token: gen.token,
            title: gen.title,
            figure: preset.figure || gen.defaultFigure || '',
            query: preset
        });

        // [EN] Generated per request: never cache it, and it needs no external
        //      script or framing.
        // [FR] Générée à chaque requête : jamais mise en cache, et sans script ni
        //      cadre externe.
        res.set('Cache-Control', 'no-store');
        res.set(
            'Content-Security-Policy',
            "default-src 'none'; img-src 'self' data: https: http:; style-src 'unsafe-inline'; " +
            "script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'"
        );

        return res.type('text/html; charset=utf-8').send(html);
    });

    // -----------------------------------------------------------------------
    // [EN] GET /Generate/look?username=… — a player's current outfit.
    //      Preferred backend is the database (AVATAR_IMAGING_DB_*), exactly like
    //      the CMS page's `SELECT look FROM users`. If no database is configured
    //      the service falls back to an HTTP endpoint (AVATAR_IMAGING_LOOKUP_URL)
    //      for hotels that would rather not expose MySQL.
    // [FR] GET /Generate/look?username=… — la tenue actuelle d'un joueur.
    //      Le mode privilégié est la base de données (AVATAR_IMAGING_DB_*),
    //      exactement comme le `SELECT look FROM users` de la page CMS. Sans base
    //      configurée, le service se rabat sur un point d'entrée HTTP
    //      (AVATAR_IMAGING_LOOKUP_URL) pour les hôtels qui préfèrent ne pas
    //      exposer MySQL.
    // -----------------------------------------------------------------------
    router.get('/look', async (req, res) => {
        res.set('Cache-Control', 'no-store');

        if (!lookupAvailable) {
            return res.status(501).json({ ok: false, error: 'La recherche par pseudo n\'est pas configurée.' });
        }

        const username = (first(req.query.username) ?? '').trim();

        if (!username) return res.status(400).json({ ok: false, error: 'Indique un pseudo.' });
        if (!USERNAME_RE.test(username)) return res.status(400).json({ ok: false, error: 'Pseudo invalide.' });

        // --- [EN] Database path / [FR] Voie base de données ---
        if (db.enabled) {
            try {
                const row = await findUserByName(db, username);

                if (!row) return res.status(404).json({ ok: false, error: 'Joueur introuvable.' });

                const figure = cleanFigure(row.figure);

                if (!figure) return res.status(422).json({ ok: false, error: 'Ce joueur n\'a pas de tenue valide.' });

                return res.json({ ok: true, username: row.username || username, figure });
            } catch (error) {
                console.error('[pixinode] DB lookup failed:', error?.message || error);

                return res.status(502).json({ ok: false, error: 'Base de données injoignable.' });
            }
        }

        // --- [EN] HTTP fallback / [FR] Repli HTTP ---
        const target = gen.lookupUrl.includes('%username%')
            ? gen.lookupUrl.replace('%username%', encodeURIComponent(username))
            : `${ gen.lookupUrl }${ gen.lookupUrl.includes('?') ? '&' : '?' }username=${ encodeURIComponent(username) }`;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), gen.lookupTimeoutMs);

        try {
            const headers = { Accept: 'application/json' };

            if (gen.lookupKey) headers[gen.lookupHeader] = gen.lookupKey;

            const upstream = await fetch(target, { headers, signal: controller.signal });

            if (!upstream.ok) return res.status(502).json({ ok: false, error: `Le site a répondu ${ upstream.status }.` });

            const raw = await upstream.text();
            let payload;

            try {
                payload = JSON.parse(raw);
            } catch {
                payload = raw;
            }

            const figure = extractFigure(payload);

            if (!figure) return res.status(404).json({ ok: false, error: 'Joueur introuvable.' });

            return res.json({ ok: true, username: extractUsername(payload) || username, figure });
        } catch (error) {
            const reason = error?.name === 'AbortError' ? 'Délai dépassé.' : 'Site injoignable.';

            console.warn('[pixinode] lookup failed:', error?.message || error);

            return res.status(502).json({ ok: false, error: reason });
        } finally {
            clearTimeout(timer);
        }
    });

    // -----------------------------------------------------------------------
    // [EN] GET /Generate/search?q=… — up to 8 usernames starting with q, each
    //      with its figure so the panel can show a real avatar next to the name.
    //      Database only; without one the panel just hides the suggestion list.
    // [FR] GET /Generate/search?q=… — jusqu'à 8 pseudos commençant par q, chacun
    //      avec sa figure pour que le panel affiche un vrai avatar à côté du nom.
    //      Base de données uniquement ; sans elle, le panel masque simplement la
    //      liste de suggestions.
    // -----------------------------------------------------------------------
    router.get('/search', async (req, res) => {
        res.set('Cache-Control', 'no-store');

        if (!searchAvailable) return res.json({ ok: true, results: [] });

        const query = (first(req.query.q) ?? '').trim();

        // [EN] At least two characters, or every keystroke would scan the table.
        // [FR] Deux caractères minimum, sinon chaque frappe scannerait la table.
        if (query.length < 2 || !USERNAME_RE.test(query)) return res.json({ ok: true, results: [] });

        try {
            const rows = await searchUsers(db, query, 8);

            return res.json({
                ok: true,
                results: rows
                    .map((row) => ({ username: row.username, figure: cleanFigure(row.figure) }))
                    .filter((row) => row.username && row.figure)
            });
        } catch (error) {
            console.error('[pixinode] DB search failed:', error?.message || error);

            return res.status(502).json({ ok: false, error: 'Base de données injoignable.' });
        }
    });

    return router;
};

export default createGenerateRouter;
