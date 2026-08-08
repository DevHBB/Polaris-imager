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
    maxTextLength: int(env.AVATAR_IMAGING_MAX_TEXT_LEN, 100)
};
