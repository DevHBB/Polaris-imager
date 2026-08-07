// Stub for @jsquash/avif. Only the renderer's static-image decoder uses it to
// decode AVIF assets, which never happens on the avatar-render path. Stubbing it
// keeps the multi-MB AVIF wasm out of the harness bundle.

export const decode = async () => {
    throw new Error('@jsquash/avif is not bundled in the avatar-imaging harness');
};

export default { decode };
