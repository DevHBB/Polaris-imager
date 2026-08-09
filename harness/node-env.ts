import * as PixiNode from '@pixi/node';
import { DOMAdapter, isWebGLSupported } from 'pixi.js';
import { loadImage, registerFont } from 'canvas';
import { existsSync } from 'node:fs';

const g = globalThis as any;

g.__PIXI_NODE__ = PixiNode;

const nodeAdapter = (PixiNode as any).DOMAdapter?.get?.();

if (nodeAdapter && DOMAdapter.get() !== nodeAdapter) DOMAdapter.set(nodeAdapter);

try {
    const realSet = (DOMAdapter as any).set.bind(DOMAdapter);

    (DOMAdapter as any).set = (adapter: any) => (adapter === nodeAdapter ? realSet(adapter) : undefined);
} catch {
}

try {
    isWebGLSupported(false);
} catch {
}

try {
    const firstExisting = (candidates: (string | undefined)[]): string | null => {
        for (const path of candidates) {
            if (path && existsSync(path)) return path;
        }

        return null;
    };

    const regularPath = firstExisting([
        process.env.AVATAR_IMAGING_FONT_FILE,
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
        '/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/dejavu/DejaVuSans.ttf',
        'C:\\Windows\\Fonts\\arial.ttf',
        '/Library/Fonts/Arial.ttf'
    ]);

    const boldPath = firstExisting([
        process.env.AVATAR_IMAGING_FONT_FILE_BOLD,
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
        '/usr/share/fonts/liberation-sans/LiberationSans-Bold.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
        'C:\\Windows\\Fonts\\arialbd.ttf',
        '/Library/Fonts/Arial Bold.ttf'
    ]);

    if (regularPath) registerFont(regularPath, { family: 'Arial', weight: 'normal' });

    const boldFace = boldPath || regularPath;

    if (boldFace) registerFont(boldFace, { family: 'Arial', weight: 'bold' });

    if (regularPath || boldFace) {
        console.error(`[node-env] registered bubble font (Arial) <- ${ regularPath || boldFace }`);
    } else {
        console.error('[node-env] WARNING: no bubble font found — speech-bubble text may be blank. Install one (apt-get install fonts-liberation) or set AVATAR_IMAGING_FONT_FILE.');
    }
} catch (e) {
    console.error('[node-env] font registration failed (bubble text may be blank):', (e as any)?.message);
}

if (!g.createImageBitmap) {
    g.createImageBitmap = async (source: any): Promise<any> => {
        let buffer: Buffer;

        if (source && typeof source.arrayBuffer === 'function') {
            buffer = Buffer.from(await source.arrayBuffer());
        } else if (source instanceof Uint8Array) {
            buffer = Buffer.from(source);
        } else if (Buffer.isBuffer(source)) {
            buffer = source;
        } else {
            throw new Error('createImageBitmap shim: unsupported source type');
        }

        const image = await loadImage(buffer);
        const width = image.width || (image as any).naturalWidth;
        const height = image.height || (image as any).naturalHeight;
        const canvas = DOMAdapter.get().createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        if (!ctx) throw new Error('createImageBitmap shim: node-canvas 2D context unavailable');

        ctx.drawImage(image as any, 0, 0);

        return canvas;
    };
}
