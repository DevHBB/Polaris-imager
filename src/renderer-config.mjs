import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');

if (existsSync(envPath) && typeof process.loadEnvFile === 'function') {
    try {
        process.loadEnvFile(envPath);
    } catch {
    }
}

const env = process.env;

const list = (value, fallback) => {
    if (!value || !value.trim().length) return fallback;

    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
};

const int = (value, fallback) => {
    const parsed = parseInt(value, 10);

    return Number.isFinite(parsed) ? parsed : fallback;
};

const GAMEDATA_URL = (env.NITRO_GAMEDATA_URL || 'https://hotel.example.com/client/gamedata').replace(/\/+$/, '');
const ASSET_URL = (env.NITRO_ASSET_URL || 'https://hotel.example.com/client/nitro/bundled').replace(/\/+$/, '');

export const FPS = int(env.AVATAR_IMAGING_FPS, 12);
export const MAX_FRAMES = int(env.AVATAR_IMAGING_MAX_FRAMES, 60);

export const buildRendererConfig = () => ({
    'config.urls': ['data:application/json,{}'],

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

    'system.fps.max': FPS,
    'system.log.debug': false,
    'system.log.warn': true,
    'system.log.error': true,
    'system.log.events': false,
    'system.log.packets': false
});
