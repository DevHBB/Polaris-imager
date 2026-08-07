// Headless Chromium pool. Each pooled page is an isolated renderer instance
// (its own JS realm => its own renderer singletons), so the pool size is also
// the maximum number of images rendered concurrently.

import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { chromium } from 'playwright-core';
import { CONFIG } from './config.mjs';

const CHROMIUM_ARGS = [
    // Software WebGL via SwiftShader — no GPU needed, deterministic output.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    // Server-side renderer: let the harness fetch gamedata/assets cross-origin.
    '--disable-web-security',
    // Container-friendly.
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-dev-shm-usage',
    '--disable-setuid-sandbox',
    '--mute-audio'
];

// Find the newest full-chromium build inside a Playwright browsers root. We
// match by directory name rather than a version-specific path so the browser is
// found whatever revision `playwright install chromium` happened to fetch (this
// avoids the classic playwright-core / installed-browser version mismatch).
const scanForChromium = (root) => {
    if (!root || !existsSync(root)) return null;

    const dirs = readdirSync(root)
        .filter((name) => name.startsWith('chromium-') && !name.includes('headless_shell'))
        .sort()
        .reverse(); // highest revision first

    for (const dir of dirs) {
        const path = resolve(root, dir, 'chrome-linux', 'chrome');

        if (existsSync(path)) return path;
    }

    return null;
};

export const resolveChromiumPath = () => {
    if (CONFIG.chromiumPath && existsSync(CONFIG.chromiumPath)) return CONFIG.chromiumPath;

    const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache', 'ms-playwright')];

    for (const root of roots) {
        const path = scanForChromium(root);

        if (path) return path;
    }

    try {
        const path = chromium.executablePath();

        if (path && existsSync(path)) return path;
    } catch {
        // playwright-core has no managed browser; fall through.
    }

    return null;
};

export class BrowserPool {
    #browser = null;
    #baseUrl = null;
    #initScript = null;
    #pages = []; // { page, busy }
    #waiters = [];

    async init(baseUrl, initOptions) {
        this.#baseUrl = baseUrl;
        this.#initScript = initOptions;

        const executablePath = resolveChromiumPath();

        if (!executablePath) {
            throw new Error(
                'No Chromium browser found. Install one, then restart:\n' +
                '    npx playwright install --with-deps chromium\n' +
                '  (the --with-deps also apt-installs the shared libraries a headless\n' +
                '   Chromium needs on a bare server; drop it if those are already present)\n' +
                '  — or point CHROMIUM_PATH at an existing Chromium/Chrome binary\n' +
                '    (e.g. CHROMIUM_PATH=/usr/bin/chromium).'
            );
        }

        this.#browser = await chromium.launch({
            headless: true,
            executablePath,
            args: CHROMIUM_ARGS
        });

        for (let i = 0; i < CONFIG.poolSize; i++) {
            const page = await this.#createPage();

            this.#pages.push({ page, busy: false, renders: 0 });
        }
    }

    async #createPage() {
        const page = await this.#browser.newPage();

        // Inject the renderer config + tuning before any page script runs.
        await page.addInitScript((opts) => {
            window.NitroConfig = { 'config.urls': ['/renderer-config.json'] };
            window.__IMAGING_OPTS__ = opts;
        }, {
            fps: CONFIG.animationFps,
            maxFrames: CONFIG.maxFrames,
            assetTimeoutMs: Math.min(CONFIG.renderTimeoutMs, 20000),
            effectTimeoutMs: Math.min(CONFIG.renderTimeoutMs, 15000),
            debug: CONFIG.debug
        });

        page.on('console', (msg) => {
            if (msg.type() === 'error') console.error('[harness]', msg.text());
        });

        await page.goto(`${this.#baseUrl}/harness/index.html`, { waitUntil: 'load', timeout: CONFIG.bootTimeoutMs });

        await page.waitForFunction(
            () => window.__NITRO_READY__ === true || Boolean(window.__NITRO_ERROR__),
            null,
            { timeout: CONFIG.bootTimeoutMs }
        );

        const error = await page.evaluate(() => window.__NITRO_ERROR__ || null);

        if (error) throw new Error(`Harness failed to boot: ${error}`);

        return page;
    }

    #acquire() {
        const free = this.#pages.find((entry) => !entry.busy);

        if (free) {
            free.busy = true;

            return Promise.resolve(free);
        }

        // Shed load rather than queueing without bound.
        if (this.#waiters.length >= CONFIG.maxQueue) {
            const error = new Error('overloaded');

            error.code = 'OVERLOADED';

            return Promise.reject(error);
        }

        return new Promise((resolve) => this.#waiters.push(resolve));
    }

    #handOff(entry) {
        const waiter = this.#waiters.shift();

        if (waiter) {
            waiter(entry); // stays busy, handed straight to the next request
        } else {
            entry.busy = false;
        }
    }

    #release(entry) {
        // Recycle a page that has drawn enough renders, to release the assets it
        // has accumulated. It stays busy until the fresh page is ready.
        if (CONFIG.pageMaxRenders > 0 && entry.renders >= CONFIG.pageMaxRenders) {
            this.#recycle(entry).finally(() => this.#handOff(entry));

            return;
        }

        this.#handOff(entry);
    }

    async #recycle(entry) {
        entry.renders = 0;

        try {
            await entry.page.close();
        } catch {
            // ignore
        }

        try {
            entry.page = await this.#createPage();
        } catch (error) {
            console.error('[avatar-imaging] failed to recreate page:', error.message);
        }
    }

    async render(params) {
        const entry = await this.#acquire();

        try {
            const result = await Promise.race([
                entry.page.evaluate((p) => window.__nitroRenderAvatar(p), params),
                new Promise((_, reject) => setTimeout(() => reject(new Error('render timed out')), CONFIG.renderTimeoutMs))
            ]);

            entry.renders += 1;

            return result;
        } catch (error) {
            // A thrown render can leave the renderer in a bad state; recycle.
            await this.#recycle(entry);

            throw error;
        } finally {
            this.#release(entry);
        }
    }

    async close() {
        for (const entry of this.#pages) {
            try {
                await entry.page.close();
            } catch {
                // ignore
            }
        }

        if (this.#browser) await this.#browser.close();
    }
}
