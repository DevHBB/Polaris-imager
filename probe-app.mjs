import { mkdirSync, writeFileSync } from 'fs';

const PIXI = await import('@pixi/node');
const { Application, Graphics } = PIXI;

const rendererName = (r) => (r ? `${r.constructor?.name} (type=${r.type})` : 'none');

const tryInit = async (label, opts) => {
    console.log(`\n[probe-app] --- ${label}: init(${JSON.stringify(opts)}) ---`);

    const app = new Application();

    try {
        await app.init({ width: 32, height: 32, backgroundAlpha: 0, ...opts });
    } catch (e) {
        console.log(`[probe-app] ${label}: init FAILED -> ${e.message}`);
        return false;
    }

    console.log(`[probe-app] ${label}: renderer = ${rendererName(app.renderer)}`);

    try {
        const g = new Graphics().rect(0, 0, 32, 32).fill(0xff0000);

        app.stage.addChild(g);
        app.renderer.render(app.stage);

        const canvas = app.renderer.canvas ?? app.renderer.view?.canvas;
        const dataURL = canvas?.toDataURL?.('image/png');

        if (dataURL) {
            mkdirSync('out', { recursive: true });
            writeFileSync(`out/probe-app-${label}.png`, dataURL.replace(/^data:image\/png;base64,/, ''), 'base64');
            console.log(`[probe-app] ${label}: wrote out/probe-app-${label}.png`);
        } else {
            console.log(`[probe-app] ${label}: rendered, but no canvas.toDataURL to extract`);
        }

        return true;
    } catch (e) {
        console.log(`[probe-app] ${label}: render FAILED -> ${e.message}`);
        return false;
    } finally {
        try { app.destroy(); } catch { }
    }
};

console.log('[probe-app] @pixi/node exports incl:', ['Application', 'WebGLRenderer', 'autoDetectRenderer'].filter((k) => k in PIXI).join(', ') || '(none of the probed names)');

await tryInit('default', {});
await tryInit('webgl', { preference: 'webgl' });
