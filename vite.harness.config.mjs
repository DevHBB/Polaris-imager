import { existsSync, realpathSync } from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'vite';

// Locate the renderer, consumed the same way the client does. Resolution order:
//   1. NITRO_RENDERER_PATH env override (explicit path to the renderer root)
//   2. the `yarn link "@nitrots/nitro-renderer"` symlink in node_modules
//   3. a sibling ../Nitro-Renderer directory (the monorepo layout)
// This way the service directory and the renderer can live anywhere, as long as
// they're linked — exactly the Nitro-UI workflow.
const resolveRenderer = () => {
    if (process.env.NITRO_RENDERER_PATH) return resolve(process.env.NITRO_RENDERER_PATH);

    const linked = resolve(import.meta.dirname, 'node_modules', '@nitrots', 'nitro-renderer');

    if (existsSync(linked)) {
        try {
            return realpathSync(linked);
        } catch {
            // fall through
        }
    }

    return resolve(import.meta.dirname, '..', 'Nitro-Renderer');
};

const RENDERER = resolveRenderer();

if (!existsSync(resolve(RENDERER, 'index.ts'))) {
    throw new Error(
        `[avatar-imaging] Nitro renderer not found at ${RENDERER}.\n` +
        '  Link it (like Nitro-UI):  cd <renderer> && yarn install && yarn link\n' +
        '                            cd <this service> && yarn link "@nitrots/nitro-renderer"\n' +
        '  Or set NITRO_RENDERER_PATH to the renderer directory.'
    );
}

if (!existsSync(resolve(RENDERER, 'node_modules', 'pixi.js'))) {
    throw new Error(`[avatar-imaging] Renderer dependencies not installed. Run: (cd ${RENDERER} && yarn install)`);
}

// Same alias map the client (Nitro-UI/vite.config.mjs) uses: force the @nitrots
// packages to source (not a stale dist), and dedupe pixi/howler onto the
// renderer's installed copy. Everything else the renderer imports (pako,
// apng-js, @pixi/gif, wasm-webp, @jsquash/avif, strip-json-comments, …) resolves
// naturally from the renderer's node_modules.
const alias = {
    '@nitrots/nitro-renderer': resolve(RENDERER, 'index.ts'),
    '@nitrots/api': resolve(RENDERER, 'packages/api/src/index.ts'),
    '@nitrots/assets': resolve(RENDERER, 'packages/assets/src/index.ts'),
    '@nitrots/avatar': resolve(RENDERER, 'packages/avatar/src/index.ts'),
    '@nitrots/camera': resolve(RENDERER, 'packages/camera/src/index.ts'),
    '@nitrots/communication': resolve(RENDERER, 'packages/communication/src/index.ts'),
    '@nitrots/configuration': resolve(RENDERER, 'packages/configuration/src/index.ts'),
    '@nitrots/events': resolve(RENDERER, 'packages/events/src/index.ts'),
    '@nitrots/localization': resolve(RENDERER, 'packages/localization/src/index.ts'),
    '@nitrots/room': resolve(RENDERER, 'packages/room/src/index.ts'),
    '@nitrots/session': resolve(RENDERER, 'packages/session/src/index.ts'),
    '@nitrots/sound': resolve(RENDERER, 'packages/sound/src/index.ts'),
    '@nitrots/utils/src': resolve(RENDERER, 'packages/utils/src'),
    '@nitrots/utils': resolve(RENDERER, 'packages/utils/src/index.ts'),
    'pixi.js': resolve(RENDERER, 'node_modules', 'pixi.js'),
    'pixi-filters': resolve(RENDERER, 'node_modules', 'pixi-filters'),
    'howler': resolve(RENDERER, 'node_modules', 'howler')
};

export default defineConfig({
    root: resolve(import.meta.dirname, 'harness'),
    base: './',
    logLevel: 'info',
    resolve: {
        alias,
        dedupe: ['pixi.js']
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify('production')
    },
    build: {
        outDir: resolve(import.meta.dirname, 'dist-harness'),
        emptyOutDir: true,
        target: 'esnext',
        sourcemap: false,
        chunkSizeWarningLimit: 4096
    }
});
