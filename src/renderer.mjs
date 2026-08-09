import './browser-globals.mjs';
import { dirname, resolve } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { CONFIG, buildRendererConfig } from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = resolve(HERE, '..', 'dist-node', 'boot-node.mjs');

const fetchDefaultActions = async (actionsUrl) => {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(actionsUrl, { signal: controller.signal });

        clearTimeout(timer);

        if (response.status === 200) return await response.json();

        console.warn(`[pixinode] actions fetch returned HTTP ${ response.status } for ${ actionsUrl }`);
    } catch (error) {
        console.warn(`[pixinode] could not pre-fetch avatar actions (${ error?.message || error })`);
    }

    return null;
};

export class RendererPool {
    #renderAvatar = null;
    #initRenderer = null;
    #ready = false;
    #busy = false;
    #needsReinit = false;
    #queue = [];

    get ready() {
        return this.#ready;
    }

    async init() {
        if (!existsSync(BUNDLE)) {
            throw new Error(`Renderer bundle not found at ${ BUNDLE } — run:  npm run build`);
        }

        const config = buildRendererConfig();

        config['avatar.default.actions'] = await fetchDefaultActions(config['avatar.actions.url']);

        globalThis.NitroConfig = config;
        globalThis.__IMAGING_OPTS__ = { fps: CONFIG.animationFps, maxFrames: CONFIG.maxFrames, debug: CONFIG.debug };

        const module = await import(BUNDLE);

        this.#initRenderer = module.initRenderer;
        this.#renderAvatar = module.renderAvatar;

        await this.#bootRenderer();

        this.#ready = true;
    }

    async #bootRenderer() {
        await Promise.race([
            this.#initRenderer(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('renderer boot timed out')), CONFIG.bootTimeoutMs))
        ]);
    }

    render(descriptor) {
        return new Promise((resolve, reject) => {
            if (this.#queue.length >= CONFIG.maxQueue) {
                const error = new Error('overloaded');

                error.code = 'OVERLOADED';

                return reject(error);
            }

            this.#queue.push({ descriptor, resolve, reject });
            this.#drain();
        });
    }

    async #drain() {
        if (this.#busy) return;

        const job = this.#queue.shift();

        if (!job) return;

        this.#busy = true;

        try {
            if (this.#needsReinit) {
                await this.#bootRenderer();
                this.#needsReinit = false;
            }

            job.resolve(await Promise.race([
                this.#renderAvatar(job.descriptor),
                new Promise((_, reject) => setTimeout(() => reject(new Error('render timed out')), CONFIG.renderTimeoutMs))
            ]));
        } catch (error) {
            if (error?.message === 'render timed out') this.#needsReinit = true;

            job.reject(error);
        } finally {
            this.#busy = false;
            this.#drain();
        }
    }

    async close() {
        this.#ready = false;
    }
}
