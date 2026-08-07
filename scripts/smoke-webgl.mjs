// Infra smoke test: launch headless Chromium exactly the way the service does,
// load the built harness in self-test mode, and confirm pixi + SwiftShader
// WebGL can render and read back pixels. No gamedata/assets required.
//
// Run:  npm run build:harness && node scripts/smoke-webgl.mjs

import assert from 'assert';
import express from 'express';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { chromium } from 'playwright-core';
import { resolveChromiumPath } from '../src/browser.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const harnessDir = resolve(here, '..', 'dist-harness');

if (!existsSync(resolve(harnessDir, 'index.html'))) {
    console.error('Harness not built. Run: npm run build:harness');
    process.exit(1);
}

const chromiumPath = resolveChromiumPath();

if (!chromiumPath) {
    console.error('No Chromium found. Install one:  npx playwright install --with-deps chromium');
    process.exit(1);
}

const app = express();
app.use('/harness', express.static(harnessDir));
const server = await new Promise((res) => { const s = app.listen(0, '127.0.0.1', () => res(s)); });
const port = server.address().port;

const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath,
    args: [
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist', '--enable-webgl', '--no-sandbox',
        '--disable-gpu-sandbox', '--disable-dev-shm-usage'
    ]
});

try {
    const page = await browser.newPage();

    page.on('console', (m) => { if (m.type() === 'error') console.error('[harness]', m.text()); });

    await page.addInitScript(() => {
        window.NitroConfig = { 'config.urls': [] };
        window.__IMAGING_SELFTEST__ = true;
    });

    await page.goto(`http://127.0.0.1:${port}/harness/index.html`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => window.__NITRO_READY__ === true || Boolean(window.__NITRO_ERROR__), null, { timeout: 60000 });

    const error = await page.evaluate(() => window.__NITRO_ERROR__ || null);
    assert.ok(!error, `harness error: ${error}`);

    const result = await page.evaluate(() => window.__SELFTEST_RESULT__);
    console.log('  self-test result:', JSON.stringify(result));

    assert.ok(result, 'no self-test result');
    assert.equal(result.width, 8);
    assert.equal(result.height, 8);
    assert.ok(result.r > 200 && result.g < 60 && result.b < 60 && result.a > 200, 'expected an opaque red pixel');

    if (result.textPixels > 0) {
        console.log(`  text bubble rendered ${result.textPixels} glyph pixels (fonts OK)`);
    } else {
        console.warn('  WARNING: text bubble rendered no glyph pixels — no font installed? Install fonts-dejavu-core / fonts-liberation for the text= feature.');
    }

    console.log('smoke-webgl: PASSED (pixi + SwiftShader WebGL render/readback works)');
} finally {
    await browser.close();
    server.close();
}
