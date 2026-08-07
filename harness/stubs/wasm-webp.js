// Stub for wasm-webp. The renderer only `await import('wasm-webp')` to decode an
// animated/static WebP asset, which never happens on the avatar-render path.
// Stubbing it keeps the ~0.5MB WebP wasm out of the harness bundle.

const unavailable = async () => {
    throw new Error('wasm-webp is not bundled in the avatar-imaging harness');
};

export const decodeAnimation = unavailable;
export const decodeRGBA = unavailable;

export default { decodeAnimation, decodeRGBA };
