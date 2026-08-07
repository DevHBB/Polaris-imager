// Encode rendered RGBA frames into a single PNG (one frame) or an animated
// APNG (many frames) using upng-js. An APNG is a valid PNG, so both are served
// as image/png and understood by browsers and most CMS software.

import UPNGImport from 'upng-js';

// upng-js is CommonJS; the encoder lives on the default export (or the module
// namespace itself depending on the interop path).
const UPNG = UPNGImport?.encode ? UPNGImport : (UPNGImport?.default ?? UPNGImport);

const toArrayBuffer = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

// Nearest-neighbour upscale by an integer factor. Avatars are pixel art, so
// nearest-neighbour is exactly what we want (crisp, no blur) and matches how
// the client renders larger avatars with imageRendering: pixelated.
const upscaleNearest = (rgba, width, height, factor) => {
    const outWidth = width * factor;
    const outHeight = height * factor;
    const out = Buffer.allocUnsafe(outWidth * outHeight * 4);

    for (let y = 0; y < outHeight; y++) {
        const srcRow = ((y / factor) | 0) * width * 4;
        const dstRow = y * outWidth * 4;

        for (let x = 0; x < outWidth; x++) {
            const src = srcRow + ((x / factor) | 0) * 4;
            const dst = dstRow + x * 4;

            out[dst] = rgba[src];
            out[dst + 1] = rgba[src + 1];
            out[dst + 2] = rgba[src + 2];
            out[dst + 3] = rgba[src + 3];
        }
    }

    return out;
};

// frames: array of Buffer (raw RGBA, length width*height*4)
// delays: per-frame delay in ms (only used when there is more than one frame)
// postScale: integer upscale factor applied to every frame (size=l -> 2)
export const encodeFrames = ({ frames, width, height, delays = [], postScale = 1 }) => {
    if (!frames || !frames.length) throw new Error('No frames to encode.');

    let outWidth = width;
    let outHeight = height;
    let outFrames = frames;

    if (postScale && postScale !== 1) {
        outFrames = frames.map((frame) => upscaleNearest(frame, width, height, postScale));
        outWidth = width * postScale;
        outHeight = height * postScale;
    }

    const buffers = outFrames.map(toArrayBuffer);

    // cnum = 0 -> full 32-bit truecolour + alpha, lossless (no quantisation).
    // For a single frame, omitting delays yields a plain PNG.
    const animated = buffers.length > 1;
    const encoded = UPNG.encode(buffers, outWidth, outHeight, 0, animated ? delays : undefined);

    return Buffer.from(encoded);
};
