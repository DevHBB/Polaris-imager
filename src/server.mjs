import express from 'express';
import { createHash } from 'crypto';
import { CONFIG, buildRendererConfig } from './config.mjs';
import { parseAvatarParams, ParamError } from './params.mjs';
import { encodeFrames } from './apng.mjs';
import { RendererPool } from './renderer.mjs';
import { createApiKeyGuard, createCors, createRateLimiter, makeClientIp, securityHeaders } from './security.mjs';
import { createAccessLogger } from './logger.mjs';

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

        this.#map.delete(key);
        this.#map.set(key, entry);

        return entry.value;
    }

    set(key, value) {
        if (CONFIG.cacheEntries <= 0) return;

        const size = value.buffer?.length || 0;

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
const renderer = new RendererPool();

const app = express();

app.disable('x-powered-by');
app.disable('etag');
app.set('trust proxy', CONFIG.trustProxy);

const clientIp = makeClientIp(CONFIG.clientIpHeader);
const rateLimiter = createRateLimiter({ windowMs: CONFIG.rateLimitWindowMs, max: CONFIG.rateLimitMax, clientIp });
const cors = createCors(CONFIG.corsOrigin);
const apiKeyGuard = createApiKeyGuard(CONFIG.apiKeys);

app.use(securityHeaders);

const accessLogger = createAccessLogger(CONFIG);

if (CONFIG.accessLog) {
    app.use((req, res, next) => {
        if (req.path === '/health' || req.path === '/favicon.ico') return next();

        const start = Date.now();

        res.on('finish', () => {
            const url = req.originalUrl.replace(/([?&]key=)[^&]*/i, '$1***');
            const bytes = res.get('content-length') || 0;
            const cacheState = res.get('X-Cache') || '-';
            const stamp = new Date().toISOString();

            accessLogger.write(`${ stamp } [access] ${ clientIp(req) } ${ req.method } ${ url } -> ${ res.statusCode } ${ bytes }b ${ cacheState } ${ Date.now() - start }ms`);
        });

        next();
    });
}

app.get('/health', (req, res) => {
    res.json({ status: renderer.ready ? 'ok' : 'starting', ready: renderer.ready, engine: '@pixi/node', concurrency: CONFIG.concurrency });
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get('/', (req, res) => {
    res.type('text/plain').send(
        [
            'Nitro avatar-imaging service (@pixi/node, headless — no browser)',
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
            '  text            speech-bubble text above the avatar',
            '  text_color      bubble text colour, hex        (default 000000)',
            '  bubble_color    bubble background colour, hex  (default ffffff)',
            '',
            'Example:',
            '  /avatarimage?figure=hd-180-1.ch-255-66.lg-280-110.sh-305-62&action=wlk,wav&direction=2&size=l',
            '  /avatarimage?figure=hd-180-1.ch-255-66&text=Hello!&bubble_color=2266cc&text_color=ffffff',
            ''
        ].join('\n')
    );
});

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
            maxActionLength: CONFIG.maxActionLength,
            maxTextLength: CONFIG.maxTextLength
        });
    } catch (error) {
        if (error instanceof ParamError) return res.status(400).type('text/plain').send(error.message);

        return res.status(400).type('text/plain').send('Bad request');
    }

    const cacheKey = JSON.stringify(descriptor);

    const etag = `"${ createHash('sha1').update(`${ cacheKey }|${ CONFIG.assetVersion }`).digest('base64') }"`;

    res.set('ETag', etag);
    res.set('Cache-Control', `public, max-age=${ Math.floor(CONFIG.cacheTtlMs / 1000) }`);

    if (req.headers['if-none-match'] === etag) {
        res.set('X-Cache', 'REVALIDATED');

        return res.status(304).end();
    }

    const cached = cache.get(cacheKey);

    if (cached) return sendImage(res, cached.buffer, cached.animated, 'HIT');

    if (!renderer.ready) return res.status(503).type('text/plain').send('Renderer still starting, try again shortly.');

    try {
        const rendered = await renderer.render(descriptor);

        if (rendered?._diag) console.log('[pixinode] effect diag:', JSON.stringify(rendered._diag));

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
        if (error?.code === 'OVERLOADED') {
            res.set('Retry-After', '2');

            return res.status(503).type('text/plain').send('Server busy, try again shortly.');
        }

        console.error('[pixinode] render failed:', error?.message || error);

        return res.status(500).type('text/plain').send('Render failed.');
    }
});

const preflightGamedata = async () => {
    const cfg = buildRendererConfig();
    const checks = [
        ['avatar.actions.url', cfg['avatar.actions.url']],
        ['avatar.figuredata.url', cfg['avatar.figuredata.url']],
        ['avatar.figuremap.url', cfg['avatar.figuremap.url']],
        ['avatar.effectmap.url', cfg['avatar.effectmap.url']]
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
        } catch (error) {
            status = error.name === 'AbortError' ? 'timeout' : (error.cause?.code || error.message);
        }

        const ok = status === 200;

        if (!ok) anyFail = true;

        console.log(`[pixinode] gamedata ${ ok ? 'OK ' : 'ERR' } ${ String(status).padEnd(9) } ${ key } -> ${ url }`);
    }

    if (anyFail) {
        console.warn(
            '[pixinode] One or more gamedata files did not return HTTP 200.\n' +
            '  Point NITRO_GAMEDATA_URL at the directory that actually contains them, or set the\n' +
            '  per-file overrides in .env (NITRO_AVATAR_ACTIONS_URL / _FIGUREDATA_URL /\n' +
            '  _FIGUREMAP_URL / _EFFECTMAP_URL). Check the host is reachable and the path/casing.'
        );
    }

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
        console.log(`[pixinode] assets   OK  200       avatar.asset.url  -> ${ probeUrl }`);
    } else {
        console.warn(`[pixinode] assets   ERR ${ String(assetStatus).padEnd(9) } avatar.asset.url  -> ${ probeUrl }`);
        console.warn(
            '  The figure .nitro base looks wrong. Set NITRO_AVATAR_ASSET_URL to the directory\n' +
            '  that directly holds the libraries, e.g. http://host/gamedata/clothes/%libname%.nitro\n' +
            '  (canary library: hh_human_body), then restart.'
        );
    }

    return !anyFail;
};

const start = async () => {
    const figuredataUrl = buildRendererConfig()['avatar.figuredata.url'];

    if (figuredataUrl.includes('hotel.example.com')) {
        console.warn(
            '[pixinode] WARNING: NITRO_GAMEDATA_URL / NITRO_ASSET_URL are not set —\n' +
            '  the renderer will try to fetch the placeholder host hotel.example.com and fail.\n' +
            '  Create a .env (see .env.example) or export those variables, then restart.'
        );
    }

    await preflightGamedata();

    const server = app.listen(CONFIG.port, CONFIG.host, () => {
        console.log(`[pixinode] listening on http://${ CONFIG.host }:${ CONFIG.port }`);
    });

    try {
        console.log('[pixinode] booting in-process @pixi/node renderer...');

        await renderer.init();

        console.log('[pixinode] ready (headless WebGL, serialized renders).');
    } catch (error) {
        console.error('[pixinode] failed to start renderer:', error?.message || error);
        process.exitCode = 1;
    }

    const shutdown = async () => {
        console.log('[pixinode] shutting down...');
        server.close();
        accessLogger.close();

        try {
            await renderer.close();
        } catch {
        }

        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
};

start();
