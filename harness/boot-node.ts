import './node-env';
import {
    AvatarAction,
    AvatarSetType,
    GetAssetManager,
    GetAvatarRenderManager,
    GetConfiguration,
    GetTicker,
    PrepareRenderer,
    TextureUtils
} from '@nitrots/nitro-renderer';
import { Container, Graphics, Sprite, Text } from 'pixi.js';

declare global {
    interface Window {
        NitroConfig: Record<string, unknown>;
        __IMAGING_OPTS__?: {
            fps?: number;
            maxFrames?: number;
            assetTimeoutMs?: number;
            effectTimeoutMs?: number;
            debug?: boolean;
        };
        __NITRO_READY__?: boolean;
        __NITRO_ERROR__?: string;
        __IMAGING_SELFTEST__?: boolean;
        __SELFTEST_RESULT__?: unknown;
        __nitroRenderAvatar?: (params: RenderParams) => Promise<RenderResult>;
    }
}

interface RenderParams {
    figure: string;
    gender: string | null;
    scale: string;
    setType: string;
    direction: number;
    headDirection: number;
    frameNum: number;
    posture: string;
    gesture: string | null;
    dance: number;
    effect: number;
    expressions: string[];
    handItem: { action: string; id: string } | null;
    format: string;
    text: string | null;
    textColor: number;
    bubbleColor: number;
}

interface RenderResult {
    animated: boolean;
    width: number;
    height: number;
    delays: number[];
    frames: string[];
    _diag?: Record<string, unknown>;
}

interface Frame {
    pixels: Uint8Array;
    width: number;
    height: number;
}

const OPTS = () => window.__IMAGING_OPTS__ ?? {};
const FPS = () => OPTS().fps ?? 24;
const MAX_FRAMES = () => OPTS().maxFrames ?? 60;
const ASSET_TIMEOUT = () => OPTS().assetTimeoutMs ?? 20000;
const EFFECT_TIMEOUT = () => OPTS().effectTimeoutMs ?? 4000;
const DEBUG = () => Boolean(OPTS().debug);

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const mgr = () => GetAvatarRenderManager();

const u8ToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    const chunk = 0x8000;

    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
    }

    return btoa(binary);
};

const createReadyAvatarImage = (figure: string, scale: string, gender: string | null, effectListener: any): Promise<any> =>
    new Promise((resolve, reject) => {
        let settled = false;

        const timeout = setTimeout(() => {
            if (settled) return;

            settled = true;
            reject(new Error('figure asset download timed out'));
        }, ASSET_TIMEOUT());

        const listener = {
            resetFigure: () => {
                if (settled) return;

                const image = mgr().createAvatarImage(figure, scale, gender, listener, effectListener);

                if (image && !image.isPlaceholder()) {
                    settled = true;
                    clearTimeout(timeout);
                    resolve(image);
                } else if (image && typeof image.dispose === 'function') {
                    image.dispose();
                }
            },
            dispose: () => {},
            disposed: false
        };

        const image = mgr().createAvatarImage(figure, scale, gender, listener, effectListener);

        if (image && !image.isPlaceholder()) {
            settled = true;
            clearTimeout(timeout);
            resolve(image);
        }
    });

const seekFrame = (avatarImage: any, frame: number): void => {
    avatarImage.resetAnimationFrameCounter();

    if (frame > 0) avatarImage.updateAnimationByFrames(frame);
};

const frameHash = (pixels: Uint8Array): number => {
    let h = 2166136261;
    const step = Math.max(4, (((pixels.length / 4096) | 0) * 4) || 4);

    for (let i = 0; i + 3 < pixels.length; i += step) {
        h = Math.imul(h ^ pixels[i], 16777619);
        h = Math.imul(h ^ pixels[i + 1], 16777619);
        h = Math.imul(h ^ pixels[i + 2], 16777619);
        h = Math.imul(h ^ pixels[i + 3], 16777619);
    }

    return h >>> 0;
};

const hashString = (h: number, s: string): number => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);

    return h >>> 0;
};

const scalePx = (scaleStr: string): number => (scaleStr === 'sh' ? 32 : 64);

const AVATAR_SPRITE_ID = 'avatar';
const AVATAR_DEFAULT_DEPTH = -0.01;

interface Placement {
    texture: any;
    x: number;
    y: number;
    depth: number;
    flipH: boolean;
    blend: string;
    key: string;
    isBody: boolean;
}

const collectPlacements = (avatarImage: any, setType: string, frame: number): Placement[] => {
    seekFrame(avatarImage, frame);

    const scaleStr: string = avatarImage.getScale();
    const scale = scalePx(scaleStr);
    const direction: number = avatarImage.getDirection();
    const canvasOffsets: number[] = avatarImage.getCanvasOffsets?.() || [0, 0, 0];
    const cvo0 = canvasOffsets[0] || 0;
    const cvo1 = canvasOffsets[1] || 0;
    const cvo2 = canvasOffsets[2] || 0;

    const placements: Placement[] = [];

    const bodyTexture = avatarImage.processAsTexture(setType, false);
    let bodyX = 0;
    let bodyY = 0;

    if (bodyTexture) {
        bodyX = (-scale / 2 + cvo0) - ((bodyTexture.width - scale) / 2);
        bodyY = -bodyTexture.height + scale / 4 + cvo1;
    }

    const sprites: any[] = (setType === AvatarSetType.FULL && avatarImage.getSprites?.()) || [];
    const totalSprites = sprites.length || 1;

    for (const spriteData of sprites) {
        const layerData: any = avatarImage.getLayerData(spriteData);

        if (spriteData.id === AVATAR_SPRITE_ID) {
            let ox = spriteData.getDirectionOffsetX(direction);
            let oy = spriteData.getDirectionOffsetY(direction);

            if (layerData) { ox += layerData.dx; oy += layerData.dy; }
            if (scale < 48) { ox /= 2; oy /= 2; }

            bodyX += ox;
            bodyY += oy;

            continue;
        }

        let frameNumber = 0;
        let ox = spriteData.getDirectionOffsetX(direction);
        let oy = spriteData.getDirectionOffsetY(direction);
        const oz = spriteData.getDirectionOffsetZ(direction);
        let dd = spriteData.hasDirections ? direction : 0;

        if (layerData) { frameNumber = layerData.animationFrame; ox += layerData.dx; oy += layerData.dy; dd += layerData.dd; }
        if (scale < 48) { ox /= 2; oy /= 2; }

        dd = ((dd % 8) + 8) % 8;

        const key = `${scaleStr}_${spriteData.member}_${dd}_${frameNumber}`;
        const asset = GetAssetManager().getAsset(key);

        if (!asset || !asset.texture) continue;

        placements.push({
            texture: asset.texture,
            x: asset.offsetX - scale / 2 + ox,
            y: asset.offsetY + oy,
            depth: AVATAR_DEFAULT_DEPTH - 0.001 * totalSprites * oz,
            flipH: Boolean(asset.flipH),
            blend: spriteData.ink === 33 ? 'add' : 'normal',
            key,
            isBody: false
        });
    }

    if (bodyTexture) {
        placements.push({ texture: bodyTexture, x: bodyX, y: bodyY, depth: AVATAR_DEFAULT_DEPTH + cvo2, flipH: false, blend: 'normal', key: 'avatar', isBody: true });
    }

    return placements;
};

const frameSignature = (avatarImage: any, setType: string, frame: number): number => {
    const placements = collectPlacements(avatarImage, setType, frame);

    let h = 2166136261;

    for (const placement of placements) {
        h = hashString(h, `${placement.key}|${Math.round(placement.x)}|${Math.round(placement.y)}|${placement.flipH ? 1 : 0}`);

        if (placement.isBody) h = (h ^ frameHash(TextureUtils.getPixels(placement.texture).pixels as Uint8Array)) >>> 0;
    }

    return h >>> 0;
};

const detectLoopLength = (avatarImage: any, setType: string, maxFrames: number): number => {
    const window = Math.max(2, Math.min(maxFrames, 48));
    const signatures: number[] = [];

    for (let i = 0; i < window; i++) signatures.push(frameSignature(avatarImage, setType, i));

    for (let period = 1; period < window; period++) {
        let holds = true;

        for (let k = period; k < window; k++) {
            if (signatures[k] !== signatures[k - period]) { holds = false; break; }
        }

        if (holds) return period;
    }

    return window;
};

const unpremultiplyAlpha = (pixels: Uint8Array): Uint8Array => {
    for (let i = 0; i < pixels.length; i += 4) {
        const a = pixels[i + 3];

        if (a === 0 || a === 255) continue;

        const inv = 255 / a;

        pixels[i] = Math.min(255, Math.round(pixels[i] * inv));
        pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] * inv));
        pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2] * inv));
    }

    return pixels;
};

interface Bubble {
    texture: any;
    width: number;
    height: number;
}

const buildTextBubble = (text: string, textColor: number, bubbleColor: number): Bubble | null => {
    const padX = 9;
    const padY = 6;
    const radius = 9;
    const tailW = 12;
    const tailH = 9;
    const border = 0x000000;

    const label = new Text({
        text,
        style: {
            fontFamily: 'Arial, Helvetica, sans-serif',
            fontSize: 14,
            fontWeight: 'bold',
            fill: textColor,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: 220,
            breakWords: true
        } as any
    });

    const textW = Math.ceil(label.width);
    const textH = Math.ceil(label.height);
    const bodyW = textW + padX * 2;
    const bodyH = textH + padY * 2;
    const totalW = bodyW + 2;
    const totalH = bodyH + tailH + 2;
    const cx = bodyW / 2;

    const graphics = new Graphics();

    graphics
        .roundRect(1, 1, bodyW, bodyH, radius)
        .fill({ color: bubbleColor })
        .stroke({ color: border, width: 1, alignment: 0.5 });

    graphics
        .moveTo(cx - tailW / 2, bodyH)
        .lineTo(cx + tailW / 2, bodyH)
        .lineTo(cx, bodyH + tailH)
        .closePath()
        .fill({ color: bubbleColor })
        .stroke({ color: border, width: 1 });

    graphics.rect(cx - tailW / 2 + 1, bodyH - 1, tailW - 2, 2).fill({ color: bubbleColor });

    label.x = 1 + padX;
    label.y = 1 + padY;

    const container = new Container();

    container.addChild(graphics);
    container.addChild(label);

    const texture = TextureUtils.createAndWriteRenderTexture(totalW, totalH, container);
    const bubble: Bubble = { texture, width: texture.width, height: texture.height };

    container.destroy({ children: true });

    return bubble;
};

const compositeFrame = (placements: Placement[], rx: number, ry: number, rw: number, rh: number): Frame => {
    const container = new Container();

    placements.sort((a, b) => b.depth - a.depth);

    for (const placement of placements) {
        const sprite = new Sprite(placement.texture);

        sprite.blendMode = placement.blend as any;

        let sx = Math.floor(placement.x - rx);
        const sy = Math.floor(placement.y - ry);

        if (placement.flipH) {
            sprite.scale.x = -1;
            sx += placement.texture.width;
        }

        sprite.x = sx;
        sprite.y = sy;

        container.addChild(sprite);
    }

    const texture = TextureUtils.createAndWriteRenderTexture(rw, rh, container);
    const data = TextureUtils.getPixels(texture);
    const frame: Frame = { pixels: unpremultiplyAlpha(new Uint8Array(data.pixels as Uint8Array)), width: data.width, height: data.height };

    texture.destroy(true);
    container.destroy({ children: true });

    return frame;
};

const renderFrames = (avatarImage: any, setType: string, absoluteFrames: number[], bubble: Bubble | null = null): Frame[] => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const frame of absoluteFrames) {
        for (const placement of collectPlacements(avatarImage, setType, frame)) {
            const w = placement.texture.width;
            const h = placement.texture.height;

            if (w <= 0 || h <= 0) continue;

            minX = Math.min(minX, placement.x);
            minY = Math.min(minY, placement.y);
            maxX = Math.max(maxX, placement.x + w);
            maxY = Math.max(maxY, placement.y + h);
        }
    }

    if (!Number.isFinite(minX)) return [{ pixels: new Uint8Array(4), width: 1, height: 1 }];

    let bubblePlacement: Placement | null = null;

    if (bubble) {
        const bubbleGap = 2;
        const bx = Math.round((minX + maxX) / 2 - bubble.width / 2);
        const by = Math.round(minY - bubble.height - bubbleGap);

        bubblePlacement = { texture: bubble.texture, x: bx, y: by, depth: -1e9, flipH: false, blend: 'normal', key: 'bubble', isBody: false };

        minX = Math.min(minX, bx);
        minY = Math.min(minY, by);
        maxX = Math.max(maxX, bx + bubble.width);
        maxY = Math.max(maxY, by + bubble.height);
    }

    const rx = Math.floor(minX);
    const ry = Math.floor(minY);
    const rw = Math.max(1, Math.ceil(maxX) - rx);
    const rh = Math.max(1, Math.ceil(maxY) - ry);

    return absoluteFrames.map((frame) => {
        const placements = collectPlacements(avatarImage, setType, frame);

        if (bubblePlacement) placements.push(bubblePlacement);

        return compositeFrame(placements, rx, ry, rw, rh);
    });
};

const unionOpaqueBox = (frames: Frame[]): { x: number; y: number; w: number; h: number } | null => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -1;
    let maxY = -1;

    for (const { pixels, width, height } of frames) {
        for (let y = 0; y < height; y++) {
            const row = y * width * 4;

            for (let x = 0; x < width; x++) {
                if (pixels[row + x * 4 + 3] > 8) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
    }

    if (maxX < minX || maxY < minY) return null;

    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
};

const cropFrame = (frame: Frame, box: { x: number; y: number; w: number; h: number }): Frame => {
    const { pixels, width } = frame;
    const out = new Uint8Array(box.w * box.h * 4);

    for (let y = 0; y < box.h; y++) {
        const srcStart = ((box.y + y) * width + box.x) * 4;
        const dstStart = y * box.w * 4;

        out.set(pixels.subarray(srcStart, srcStart + box.w * 4), dstStart);
    }

    return { pixels: out, width: box.w, height: box.h };
};

const renderAvatar = async (params: RenderParams): Promise<RenderResult> => {
    let resolveEffect: (() => void) | null = null;
    let effectResolved = false;
    const effectReady = new Promise<void>((resolve) => { resolveEffect = resolve; });
    const effectListener = {
        resetEffect: () => { effectResolved = true; if (resolveEffect) resolveEffect(); },
        dispose: () => {},
        disposed: false
    };

    const avatarImage = await createReadyAvatarImage(params.figure, params.scale, params.gender, effectListener);

    try {
        avatarImage.setDirection(AvatarSetType.FULL, params.direction);
        avatarImage.setDirection(AvatarSetType.HEAD, params.headDirection);

        avatarImage.initActionAppends();
        avatarImage.appendAction(AvatarAction.POSTURE, params.posture);

        if (params.gesture) avatarImage.appendAction(AvatarAction.GESTURE, params.gesture);
        if (params.dance > 0) avatarImage.appendAction(AvatarAction.DANCE, params.dance);

        for (const expression of params.expressions) avatarImage.appendAction(expression);

        if (params.handItem) {
            const action = params.handItem.action === 'usei' ? AvatarAction.USE_OBJECT : AvatarAction.CARRY_OBJECT;

            avatarImage.appendAction(action, params.handItem.id);
        }

        if (params.effect > 0) avatarImage.appendAction(AvatarAction.EFFECT, params.effect);

        avatarImage.endActionAppends();

        if (params.effect > 0) {
            await Promise.race([effectReady, wait(EFFECT_TIMEOUT())]);
            avatarImage.endActionAppends();
        }

        const baseFrameCount = Math.max(1, (avatarImage as any)._animationFrameCount | 0);
        const setType = params.setType === 'head' ? AvatarSetType.HEAD : AvatarSetType.FULL;

        const animates = Boolean(avatarImage.isAnimating && avatarImage.isAnimating()) || baseFrameCount > 1 || params.effect > 0;

        let wantAnimation: boolean;

        if (params.format === 'png') wantAnimation = false;
        else wantAnimation = animates;

        let loopLength;

        if (!wantAnimation) loopLength = 1;
        else if (params.effect > 0) loopLength = detectLoopLength(avatarImage, setType, MAX_FRAMES());
        else loopLength = baseFrameCount;

        const frameCount = Math.max(1, Math.min(MAX_FRAMES(), loopLength));

        const absoluteFrames = wantAnimation
            ? Array.from({ length: frameCount }, (_, i) => i)
            : [params.frameNum];

        const bubble = params.text ? buildTextBubble(params.text, params.textColor, params.bubbleColor) : null;

        let frames = renderFrames(avatarImage, setType, absoluteFrames, bubble);

        if (bubble) {
            try {
                bubble.texture.destroy(true);
            } catch {
            }
        }

        if (setType === AvatarSetType.HEAD) {
            const box = unionOpaqueBox(frames);

            if (box) frames = frames.map((frame) => cropFrame(frame, box));
        }

        const width = frames[0].width;
        const height = frames[0].height;
        const delayMs = Math.round(1000 / FPS());

        let diag: Record<string, unknown> | undefined;

        if (DEBUG() && params.effect > 0) {
            let effectAssetReady: boolean | string = 'unknown';
            let spriteCount: number | string = 'n/a';
            const animLookups: Record<string, unknown> = {};

            try {
                const effectManager = (avatarImage as any)._effectManager;

                effectAssetReady = effectManager?.isAvatarEffectReady
                    ? Boolean(effectManager.isAvatarEffectReady(params.effect))
                    : 'unknown';
            } catch (error) {
                effectAssetReady = `err:${(error as Error)?.message}`;
            }

            try {
                const sprites = avatarImage.getSprites?.();

                spriteCount = Array.isArray(sprites) ? sprites.length : 'n/a';
            } catch {
                spriteCount = 'err';
            }

            try {
                const structure = (avatarImage as any)._structure;

                for (const key of [`fx.${params.effect}`, `fx.${params.effect}.1`, `effect.${params.effect}`]) {
                    const anim = structure?.getAnimation?.(key);

                    animLookups[key] = anim ? { spriteData: anim.spriteData?.length ?? 0, hasAvatarData: Boolean(anim.hasAvatarData?.()) } : false;
                }
            } catch (error) {
                animLookups.error = (error as Error)?.message;
            }

            let effectAssetsResolved = 0;
            const missingSamples: string[] = [];
            const layers: unknown[] = [];

            try {
                seekFrame(avatarImage, 0);

                const scaleStr: string = avatarImage.getScale();
                const dir: number = avatarImage.getDirection();

                for (const spriteData of avatarImage.getSprites?.() || []) {
                    if (spriteData.id === AVATAR_SPRITE_ID) continue;

                    const layerData: any = avatarImage.getLayerData(spriteData);
                    const frameNumber = layerData ? layerData.animationFrame : 0;
                    let dd = (spriteData.hasDirections ? dir : 0) + (layerData ? layerData.dd : 0);

                    dd = ((dd % 8) + 8) % 8;

                    const name = `${scaleStr}_${spriteData.member}_${dd}_${frameNumber}`;
                    const asset = GetAssetManager().getAsset(name);

                    if (asset) effectAssetsResolved++;
                    else if (missingSamples.length < 3) missingSamples.push(name);

                    let alphaRange = 'n/a';

                    if (asset?.texture) {
                        try {
                            const probe = TextureUtils.createAndWriteRenderTexture(asset.texture.width, asset.texture.height, new Sprite(asset.texture));
                            const px = TextureUtils.getPixels(probe).pixels as Uint8Array;
                            let lo = 255;
                            let hi = 0;

                            for (let i = 3; i < px.length; i += 4) { if (px[i] < lo) lo = px[i]; if (px[i] > hi) hi = px[i]; }

                            alphaRange = `${lo}-${hi}`;
                            probe.destroy(true);
                        } catch {
                            alphaRange = 'err';
                        }
                    }

                    layers.push({ id: spriteData.id, member: spriteData.member, ink: spriteData.ink, hasDirections: spriteData.hasDirections, asset: name, resolved: Boolean(asset), alpha: alphaRange });
                }
            } catch {
            }

            diag = {
                effect: params.effect,
                effectListenerFired: effectResolved,
                effectAssetReady,
                effectIdInUse: typeof avatarImage.getEffectId === 'function' ? avatarImage.getEffectId() : undefined,
                frameCount,
                renderedFrames: frames.length,
                frameSize: `${width}x${height}`,
                spriteCount,
                effectAssetsResolved,
                missingSamples,
                layers,
                anim: animLookups
            };
        }

        return {
            animated: frames.length > 1,
            width,
            height,
            delays: frames.map(() => delayMs),
            frames: frames.map((frame) => u8ToBase64(frame.pixels)),
            ...(diag ? { _diag: diag } : {})
        };
    } finally {
        try {
            avatarImage.dispose();
        } catch {
        }
    }
};

export const initRenderer = async (): Promise<void> => {
    await PrepareRenderer({
        width: 64,
        height: 128,
        preference: 'webgl',
        skipExtensionImports: true,
        preferWebGLVersion: 1,
        backgroundAlpha: 0,
        antialias: false,
        autoDensity: false,
        resolution: 1,
        roundPixels: true,
        eventMode: 'none',
        failIfMajorPerformanceCaveat: false,
        clearBeforeRender: true
    } as any);

    if (window.__IMAGING_SELFTEST__) {
        const graphics = new Graphics().rect(0, 0, 8, 8).fill(0xff0000);
        const texture = TextureUtils.createAndWriteRenderTexture(8, 8, graphics);
        const data = TextureUtils.getPixels(texture);

        let textPixels = 0;

        try {
            const bubble = buildTextBubble('Ag', 0x000000, 0xffffff);

            if (bubble) {
                const bp = TextureUtils.getPixels(bubble.texture).pixels as Uint8Array;

                for (let i = 0; i < bp.length; i += 4) {
                    if (bp[i + 3] > 128 && bp[i] < 128) textPixels++;
                }

                bubble.texture.destroy(true);
            }
        } catch {
            textPixels = -1;
        }

        window.__SELFTEST_RESULT__ = {
            width: data.width,
            height: data.height,
            r: data.pixels[0],
            g: data.pixels[1],
            b: data.pixels[2],
            a: data.pixels[3],
            textPixels
        };
        window.__NITRO_READY__ = true;

        return;
    }

    await GetConfiguration().init();

    GetTicker().maxFPS = GetConfiguration().getValue<number>('system.fps.max', 24);

    await GetAvatarRenderManager().init();
};

export { renderAvatar };
