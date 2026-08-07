// avatar-imaging HTTP service.
//
//   GET /avatarimage?figure=...&action=...&size=n&...   -> image/png (or APNG)
//   GET /health                                         -> liveness/readiness
//   GET /renderer-config.json                           -> renderer config (harness)
//   GET /                                               -> usage help
//
// The heavy lifting (running the Nitro renderer) happens in a pool of headless
// Chromium pages; see browser.mjs and harness/boot.ts.

import express from 'express';
import { createHash } from 'crypto';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG, buildRendererConfig } from './config.mjs';
import { parseAvatarParams, ParamError } from './params.mjs';
import { encodeFrames } from './apng.mjs';
import { BrowserPool } from './browser.mjs';
import { createApiKeyGuard, createCors, createRateLimiter, loopbackOnly, makeClientIp, securityHeaders } from './security.mjs';
import { createAccessLogger } from './logger.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const harnessDir = resolve(here, '..', 'dist-harness');

// --- tiny TTL + LRU response cache, bounded by entry count AND total bytes ----
class ResponseCache {
    #map = new Map();
    #bytes = 0;

    #drop(key) {
        const entry = this.#map.get(key);

        if (entry) {
            this.#bytes -= entry.size;
            this.#map.delete(key);
        }
    }

    get(key) {
        if (CONFIG.cacheEntries <= 0) return null;

        const entry = this.#map.get(key);

        if (!entry) return null;

        if (entry.expires < Date.now()) {
            this.#drop(key);

            return null;
        }

        // LRU bump
        this.#map.delete(key);
        this.#map.set(key, entry);

        return entry.value;
    }

    set(key, value) {
        if (CONFIG.cacheEntries <= 0) return;

        const size = value.buffer?.length || 0;

        // A single item larger than the whole budget is never cached.
        if (CONFIG.cacheMaxBytes > 0 && size > CONFIG.cacheMaxBytes) return;

        this.#drop(key);
        this.#map.set(key, { value, size, expires: Date.now() + CONFIG.cacheTtlMs });
        this.#bytes += size;

        while (this.#map.size > CONFIG.cacheEntries || (CONFIG.cacheMaxBytes > 0 && this.#bytes > CONFIG.cacheMaxBytes)) {
            const oldest = this.#map.keys().next().value;

            if (oldest === undefined) break;

            this.#drop(oldest);
        }
    }
}

const cache = new ResponseCache();
const pool = new BrowserPool();
let ready = false;

// The renderer's AvatarStructure.updateActions() calls into an action manager
// that only exists once initActions() has run, and initActions() only runs when
// the config carries `avatar.default.actions`. The client ships that inline; we
// fetch the hotel's HabboAvatarActions.json at startup and inline it here so the
// renderer boots the same way. Populated by preflightGamedata().
let defaultActionsData = null;

const app = express();

app.disable('x-powered-by');
app.disable('etag'); // we set strong ETags ourselves on images
app.set('trust proxy', CONFIG.trustProxy);

const clientIp = makeClientIp(CONFIG.clientIpHeader);
const rateLimiter = createRateLimiter({ windowMs: CONFIG.rateLimitWindowMs, max: CONFIG.rateLimitMax, clientIp });
const cors = createCors(CONFIG.corsOrigin);
const apiKeyGuard = createApiKeyGuard(CONFIG.apiKeys);

app.use(securityHeaders);

// Access log: who accessed what. Skips health checks to stay readable, and
// redacts any ?key= so API keys never land in the logs. Writes to a rotating
// file when AVATAR_IMAGING_LOG_FILE is set, otherwise to stdout.
const accessLogger = createAccessLogger(CONFIG);

if (CONFIG.accessLog) {
    app.use((req, res, next) => {
        // Skip health checks, favicon, and the loopback-only internal routes
        // (the pool loading the harness) so the log is just real client traffic.
        if (req.path === '/health' || req.path === '/favicon.ico' || req.path === '/renderer-config.json' || req.path.startsWith('/harness')) return next();

        const start = Date.now();

        res.on('finish', () => {
            const url = req.originalUrl.replace(/([?&]key=)[^&]*/i, '$1***');
            const bytes = res.get('content-length') || 0;
            const cacheState = res.get('X-Cache') || '-';
            const stamp = new Date().toISOString();

            accessLogger.write(`${stamp} [access] ${clientIp(req)} ${req.method} ${url} -> ${res.statusCode} ${bytes}b ${cacheState} ${Date.now() - start}ms`);
        });

        next();
    });
}

app.get('/health', (req, res) => {
    res.json({ status: ready ? 'ok' : 'starting', ready, poolSize: CONFIG.poolSize });
});

// Browsers (incl. the headless harness page) auto-request this; answer 204 so it
// isn't a 404 in the logs / harness console.
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Internal routes: only the local headless Chromium needs these, and the config
// exposes internal gamedata/asset hosts — never serve them to the public.
app.get('/renderer-config.json', loopbackOnly, (req, res) => {
    const config = buildRendererConfig();

    // Inline the actions data so the renderer's initActions() runs (creates the
    // action manager) before updateActions() refreshes it from the URL.
    if (defaultActionsData) config['avatar.default.actions'] = defaultActionsData;

    res.json(config);
});

// Serve the built renderer harness to the headless pages (loopback only).
app.use('/harness', loopbackOnly, express.static(harnessDir));

app.get('/', (req, res) => {
    res.type('text/plain').send(
        [
            'Nitro avatar-imaging service',
            '',
            'GET /avatarimage',
            '  figure          figure string (required)',
            '  action          comma-separated, e.g. wlk,wav,drk=1',
            '  gesture         std | agr | sad | sml | srp   (default std)',
            '  direction       0-7                           (default 2)',
            '  head_direction  0-7                           (default 2)',
            '  headonly        0 | 1                          (default 0)',
            '  dance           0-4                            (default 0)',
            '  effect          effect id                      (default 0)',
            '  size            s | n | l                      (default n)',
            '  frame_num       still-frame index              (default 0)',
            '  img_format      png | apng | auto              (default auto)',
            '',
            'Example:',
            '  /avatarimage?figure=hd-180-1.ch-255-66.lg-280-110.sh-305-62&action=wlk,wav&direction=2&size=l',
            ''
        ].join('\n')
    );
});

// Send a rendered PNG/APNG. ETag/Cache-Control are already set by the handler
// (derived from the request), so a reverse proxy/CDN and browsers cache — the
// real CPU offload, since repeat requests never reach the renderer.
const sendImage = (res, buffer, animated, cacheState) => {
    res.set('X-Animated', String(animated));
    res.set('X-Cache', cacheState);
    res.type('image/png');

    return res.send(buffer);
};

app.get('/avatarimage', cors, rateLimiter, apiKeyGuard, async (req, res) => {
    let descriptor;

    try {
        descriptor = parseAvatarParams(req.query, {
            defaultFigure: process.env.AVATAR_IMAGING_DEFAULT_FIGURE || null,
            maxFigureLength: CONFIG.maxFigureLength,
            maxActionLength: CONFIG.maxActionLength
        });
    } catch (error) {
        if (error instanceof ParamError) return res.status(400).type('text/plain').send(error.message);

        return res.status(400).type('text/plain').send('Bad request');
    }

    const cacheKey = JSON.stringify(descriptor);

    // ETag is derived from the request (+ asset version), not the rendered bytes,
    // so a conditional request is answered 304 WITHOUT rendering.
    const etag = `"${createHash('sha1').update(`${cacheKey}|${CONFIG.assetVersion}`).digest('base64')}"`;

    res.set('ETag', etag);
    res.set('Cache-Control', `public, max-age=${Math.floor(CONFIG.cacheTtlMs / 1000)}`);

    if (req.headers['if-none-match'] === etag) {
        res.set('X-Cache', 'REVALIDATED');

        return res.status(304).end();
    }

    const cached = cache.get(cacheKey);

    if (cached) return sendImage(res, cached.buffer, cached.animated, 'HIT');

    if (!ready) return res.status(503).type('text/plain').send('Renderer still starting, try again shortly.');

    try {
        const rendered = await pool.render(descriptor);

        if (rendered?._diag) console.log('[avatar-imaging] effect diag:', JSON.stringify(rendered._diag));

        if (!rendered || !rendered.frames?.length) throw new Error('renderer produced no frames');

        const frames = rendered.frames.map((frame) => Buffer.from(frame, 'base64'));

        const buffer = encodeFrames({
            frames,
            width: rendered.width,
            height: rendered.height,
            delays: rendered.delays,
            postScale: descriptor.postScale
        });

        cache.set(cacheKey, { buffer, animated: rendered.animated });

        return sendImage(res, buffer, rendered.animated, 'MISS');
    } catch (error) {
        // Overloaded: the render queue is full — shed load.
        if (error?.code === 'OVERLOADED') {
            res.set('Retry-After', '2');

            return res.status(503).type('text/plain').send('Server busy, try again shortly.');
        }

        // Log details server-side; return a generic message so nothing internal
        // (URLs, stack traces) leaks to the client.
        console.error('[avatar-imaging] render failed:', error?.message || error);

        return res.status(500).type('text/plain').send('Render failed.');
    }
});

// Fetch each gamedata JSON from Node before launching Chromium, so a wrong path
// shows up as a clear per-URL status line instead of a harness stack trace.
const preflightGamedata = async () => {
    const cfg = buildRendererConfig();
    const checks = [
        ['avatar.actions.url', cfg['avatar.actions.url'], 'NITRO_AVATAR_ACTIONS_URL'],
        ['avatar.figuredata.url', cfg['avatar.figuredata.url'], 'NITRO_AVATAR_FIGUREDATA_URL'],
        ['avatar.figuremap.url', cfg['avatar.figuremap.url'], 'NITRO_AVATAR_FIGUREMAP_URL'],
        ['avatar.effectmap.url', cfg['avatar.effectmap.url'], 'NITRO_AVATAR_EFFECTMAP_URL']
    ];

    let anyFail = false;

    for (const [key, url] of checks) {
        let status;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, { method: 'GET', signal: controller.signal });

            clearTimeout(timer);
            status = res.status;

            // Stash the actions JSON to inline as avatar.default.actions.
            if (res.status === 200 && key === 'avatar.actions.url') {
                try {
                    defaultActionsData = await res.json();
                } catch {
                    // non-JSON (or JSONC) — leave null; the renderer will still
                    // try updateActions() and surface a clearer error if so.
                }
            }
        } catch (error) {
            status = error.name === 'AbortError' ? 'timeout' : (error.cause?.code || error.message);
        }

        const ok = status === 200;

        if (!ok) anyFail = true;

        console.log(`[avatar-imaging] gamedata ${ok ? 'OK ' : 'ERR'} ${String(status).padEnd(9)} ${key} -> ${url}`);
    }

    if (anyFail) {
        console.warn(
            '[avatar-imaging] One or more gamedata files did not return HTTP 200.\n' +
            '  If your files live under a different path, either point NITRO_GAMEDATA_URL at the\n' +
            '  directory that actually contains them, or set the per-file overrides in .env:\n' +
            '  NITRO_AVATAR_ACTIONS_URL / _FIGUREDATA_URL / _FIGUREMAP_URL / _EFFECTMAP_URL.\n' +
            '  (Also check the host is reachable from this server and the path/casing is exact.)'
        );
    }

    // Canary for the figure .nitro base: probe the universal base-body library.
    // A 404 almost always means avatar.asset.url has the wrong path (e.g. an
    // extra /figure/ segment that your layout doesn't use).
    const probeUrl = cfg['avatar.asset.url'].replace('%libname%', 'hh_human_body');
    let assetStatus;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(probeUrl, { method: 'GET', signal: controller.signal });

        clearTimeout(timer);
        assetStatus = res.status;
    } catch (error) {
        assetStatus = error.name === 'AbortError' ? 'timeout' : (error.cause?.code || error.message);
    }

    if (assetStatus === 200) {
        console.log(`[avatar-imaging] assets   OK  200       avatar.asset.url  -> ${probeUrl}`);
    } else {
        console.warn(`[avatar-imaging] assets   ERR ${String(assetStatus).padEnd(9)} avatar.asset.url  -> ${probeUrl}`);

        // Try the most common alternative layouts and, if one works, print the
        // exact override to set — so the fix is copy-paste, not guesswork.
        const candidates = [];

        if (probeUrl.includes('/figure/')) candidates.push(probeUrl.replace('/figure/', '/'));
        if (!probeUrl.includes('/figure/')) candidates.push(probeUrl.replace('hh_human_body.nitro', 'figure/hh_human_body.nitro'));

        let hint = null;

        for (const candidate of candidates) {
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 8000);
                const res = await fetch(candidate, { method: 'GET', signal: controller.signal });

                clearTimeout(timer);

                if (res.status === 200) {
                    hint = candidate.replace('hh_human_body.nitro', '%libname%.nitro');
                    break;
                }
            } catch {
                // ignore
            }
        }

        if (hint) {
            console.warn(`  Found the base body at a different path. Set this in .env and restart:\n    NITRO_AVATAR_ASSET_URL=${hint}`);
        } else {
            console.warn(
                '  The figure .nitro base looks wrong and no common variant worked. Set\n' +
                '  NITRO_AVATAR_ASSET_URL to the directory that directly holds the libraries, e.g.\n' +
                '  http://host/gamedata/clothes/%libname%.nitro — then restart. (Canary library:\n' +
                "  hh_human_body; ignore this only if you know it is named/located differently.)"
            );
        }
    }

    return !anyFail;
};

const start = async () => {
    // Loud, early warning for the most common misconfiguration: gamedata/asset
    // URLs never set, so the renderer tries to fetch the placeholder host.
    const figuredataUrl = buildRendererConfig()['avatar.figuredata.url'];

    if (figuredataUrl.includes('hotel.example.com')) {
        console.warn(
            '[avatar-imaging] WARNING: NITRO_GAMEDATA_URL / NITRO_ASSET_URL are not set —\n' +
            '  the renderer will try to fetch the placeholder host hotel.example.com and fail.\n' +
            '  Create a .env (see .env.example) or export those variables, then restart.'
        );
    }

    await preflightGamedata();

    const server = app.listen(CONFIG.port, CONFIG.host, () => {
        console.log(`[avatar-imaging] listening on http://${CONFIG.host}:${CONFIG.port}`);
    });

    const baseUrl = `http://127.0.0.1:${CONFIG.port}`;

    try {
        console.log('[avatar-imaging] launching headless renderer pool...');

        await pool.init(baseUrl);

        ready = true;

        console.log(`[avatar-imaging] ready with ${CONFIG.poolSize} renderer page(s).`);
    } catch (error) {
        console.error('[avatar-imaging] failed to start renderer pool:', error);
        process.exitCode = 1;
    }

    const shutdown = async () => {
        console.log('[avatar-imaging] shutting down...');
        server.close();
        accessLogger.close();

        try {
            await pool.close();
        } catch {
            // ignore
        }

        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
};

start();
