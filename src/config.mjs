// Central configuration for the avatar-imaging service.
//
// Everything the headless renderer needs to reach the hotel's gamedata and
// .nitro assets is env-driven so the same build can point at any hotel. The
// two things you MUST set are the gamedata and asset bases.
//
// This import loads .env into process.env before anything below reads it.
import './env.mjs';

//
//
//   NITRO_GAMEDATA_URL   base that FigureData.json / FigureMap.json /
//                        EffectMap.json / HabboAvatarActions.json hang off of.
//                        Mirror the client's `gamedata.url`, e.g.
//                        https://hotel.example.com/client/gamedata
//   NITRO_ASSET_URL      base for the .nitro libraries (figure/ + effect/),
//                        mirror the client's `asset.url`, e.g.
//                        https://hotel.example.com/client/nitro/bundled
//
// Each individual URL can also be overridden outright if a hotel lays its
// gamedata out differently (see NITRO_* below).

const env = process.env;

const int = (value, fallback) => {
    const parsed = parseInt(value, 10);

    return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (value) => ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());

// Express `trust proxy` value: boolean, hop count, or a subnet string.
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

const csvSize = (value) => {
    if (!value) return null;

    const parts = value.split(',').map((entry) => parseInt(entry.trim(), 10));

    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n <= 0)) return null;

    return { width: parts[0], height: parts[1] };
};

const GAMEDATA_URL = (env.NITRO_GAMEDATA_URL || 'https://hotel.example.com/client/gamedata').replace(/\/+$/, '');
const ASSET_URL = (env.NITRO_ASSET_URL || 'https://hotel.example.com/client/nitro/bundled').replace(/\/+$/, '');

export const CONFIG = {
    host: env.AVATAR_IMAGING_HOST || '0.0.0.0',
    port: int(env.AVATAR_IMAGING_PORT, 8081),

    // How many headless renderer pages to keep warm. Each page is an isolated
    // renderer instance, so this is also the max number of images rendered in
    // parallel. More pages = more RAM. 2 is a sane default for a small CMS.
    poolSize: int(env.AVATAR_IMAGING_POOL, 2),

    // A single figure render (incl. on-demand .nitro downloads) should never
    // take longer than this. Guards against a wedged page hanging a request.
    renderTimeoutMs: int(env.AVATAR_IMAGING_RENDER_TIMEOUT_MS, 30000),

    // How long a fresh page gets to boot the renderer + load mandatory libs.
    bootTimeoutMs: int(env.AVATAR_IMAGING_BOOT_TIMEOUT_MS, 60000),

    // Animation playback rate for the APNG (frame delay = 1000 / fps). Habbo
    // avatars animate at roughly 12fps, so that's the default; lower = slower.
    // maxFrames caps a long loop so it can't produce a monstrous APNG.
    animationFps: int(env.AVATAR_IMAGING_FPS, 12),
    maxFrames: int(env.AVATAR_IMAGING_MAX_FRAMES, 60),

    // Response cache (in-memory LRU keyed by the full query). Bounded by BOTH an
    // entry count and a total byte budget; 0 entries disables it.
    cacheEntries: int(env.AVATAR_IMAGING_CACHE_ENTRIES, 512),
    cacheMaxBytes: int(env.AVATAR_IMAGING_CACHE_MAX_BYTES, 256 * 1024 * 1024),
    cacheTtlMs: int(env.AVATAR_IMAGING_CACHE_TTL_MS, 5 * 60 * 1000),

    // Recycle (close + recreate) a renderer page after this many renders, to cap
    // the memory a page accumulates from caching every asset it has ever drawn.
    // 0 disables recycling (memory then grows with the variety of requests).
    pageMaxRenders: int(env.AVATAR_IMAGING_PAGE_MAX_RENDERS, 500),

    // Optional fixed output canvas per set type. Leave unset for content-tight
    // output (cropped to the avatar, like the in-client thumbnails); set to
    // "width,height" to pad/anchor every image to a fixed box so a CMS grid
    // lines up. Values are in `size=n` pixels; s/l scale them.
    fixedCanvasFull: csvSize(env.AVATAR_IMAGING_CANVAS_FULL),
    fixedCanvasHead: csvSize(env.AVATAR_IMAGING_CANVAS_HEAD),

    // Explicit Chromium binary. Defaults to the Playwright-managed browser via
    // PLAYWRIGHT_BROWSERS_PATH; set this when running against a system Chrome.
    chromiumPath: env.CHROMIUM_PATH || env.AVATAR_IMAGING_CHROMIUM || null,

    // Verbose per-render diagnostics (effect sprite/asset resolution, frame
    // counts, …). Off by default to keep logs clean.
    debug: bool(env.AVATAR_IMAGING_DEBUG),

    // --- hardening --------------------------------------------------------
    // Behind a reverse proxy set this so the real client IP (X-Forwarded-For)
    // is used for rate limiting. Value: "true", a hop count, or a subnet.
    trustProxy: trustProxy(env.AVATAR_IMAGING_TRUST_PROXY),

    // Header carrying the real client IP behind a proxy/CDN, used for logging
    // and rate limiting. e.g. "cf-connecting-ip" (Cloudflare) or
    // "x-forwarded-for". Empty => req.ip (honours trustProxy for XFF).
    clientIpHeader: (env.AVATAR_IMAGING_CLIENT_IP_HEADER || '').toLowerCase().trim(),

    // Log each request with the client IP, method, path, status, cache + timing.
    // On by default; set to 0 to silence.
    accessLog: env.AVATAR_IMAGING_ACCESS_LOG === undefined ? true : bool(env.AVATAR_IMAGING_ACCESS_LOG),

    // Write the access log to a file with built-in size-based rotation. Unset =>
    // log to stdout (let journald/Docker capture it). Rotates to <file>.1..N.
    logFile: env.AVATAR_IMAGING_LOG_FILE || null,
    logMaxBytes: int(env.AVATAR_IMAGING_LOG_MAX_BYTES, 10 * 1024 * 1024),
    logMaxFiles: int(env.AVATAR_IMAGING_LOG_MAX_FILES, 5),

    // Per-IP rate limit (fixed window). Set max to 0 to disable.
    rateLimitWindowMs: int(env.AVATAR_IMAGING_RATELIMIT_WINDOW_MS, 60000),
    rateLimitMax: int(env.AVATAR_IMAGING_RATELIMIT_MAX, 120),

    // Shed load: reject with 503 once this many requests are already queued for
    // the render pool, instead of queueing without bound. Defaults to 8x pool.
    maxQueue: int(env.AVATAR_IMAGING_MAX_QUEUE, Math.max(8, int(env.AVATAR_IMAGING_POOL, 2) * 8)),

    // Optional API keys (comma-separated). When set, requests must present one
    // via ?key= or the X-API-Key header. Empty => public.
    apiKeys: list(env.AVATAR_IMAGING_API_KEYS, []),

    // Optional CORS allow-origin for the image endpoint (e.g. https://cms.example
    // or *). Empty => no CORS header (fine for plain <img> embedding).
    corsOrigin: (env.AVATAR_IMAGING_CORS_ORIGIN || '').trim(),

    // Hard caps on user-controlled input.
    maxFigureLength: int(env.AVATAR_IMAGING_MAX_FIGURE_LEN, 512),
    maxActionLength: int(env.AVATAR_IMAGING_MAX_ACTION_LEN, 256)
};

// The renderer config object served to the harness at /renderer-config.json.
// These keys are the exact strings AvatarRenderManager / AvatarAssetDownloadManager
// / EffectAssetDownloadManager read, mirroring the client's renderer-config.json.
export const buildRendererConfig = () => ({
    'gamedata.url': GAMEDATA_URL,
    'asset.url': ASSET_URL,

    'avatar.actions.url': env.NITRO_AVATAR_ACTIONS_URL || `${GAMEDATA_URL}/HabboAvatarActions.json`,
    'avatar.figuredata.url': env.NITRO_AVATAR_FIGUREDATA_URL || `${GAMEDATA_URL}/FigureData.json`,
    'avatar.figuremap.url': env.NITRO_AVATAR_FIGUREMAP_URL || `${GAMEDATA_URL}/FigureMap.json`,
    'avatar.effectmap.url': env.NITRO_AVATAR_EFFECTMAP_URL || `${GAMEDATA_URL}/EffectMap.json`,

    'avatar.asset.url': env.NITRO_AVATAR_ASSET_URL || `${ASSET_URL}/figure/%libname%.nitro`,
    'avatar.asset.effect.url': env.NITRO_AVATAR_ASSET_EFFECT_URL || `${ASSET_URL}/effect/%libname%.nitro`,

    'avatar.mandatory.libraries': list(env.NITRO_AVATAR_MANDATORY_LIBRARIES, ['bd:1', 'li:0']),
    'avatar.mandatory.effect.libraries': list(env.NITRO_AVATAR_MANDATORY_EFFECT_LIBRARIES, ['dance.1', 'dance.2', 'dance.3', 'dance.4']),

    'system.fps.max': CONFIG.animationFps,
    'system.log.debug': false,
    'system.log.warn': true,
    'system.log.error': true,
    'system.log.events': false,
    'system.log.packets': false
});
