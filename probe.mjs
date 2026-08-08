console.log('node', process.version);

try {
    const createGL = (await import('gl')).default;
    const gl = createGL(64, 64, { preserveDrawingBuffer: true });

    if (!gl) {
        console.log('[probe] headless-gl: NULL  ->  no WebGL context on this box.');
        console.log('        The GL software stack (Mesa/llvmpipe) is missing or broken.');
        console.log('        Try:  sudo apt-get install -y libgl1-mesa-dev libglu1-mesa-dev mesa-utils libxi-dev');
    } else {
        console.log('[probe] headless-gl: OK');
        console.log('        VERSION :', gl.getParameter(gl.VERSION));
        console.log('        RENDERER:', gl.getParameter(gl.RENDERER));
        console.log('        VENDOR  :', gl.getParameter(gl.VENDOR));
        console.log('        GLSL    :', gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
        gl.clearColor(1, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const px = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        console.log('        readPixels (want 255,0,0,255):', Array.from(px).join(','));
    }
} catch (e) {
    console.log('[probe] headless-gl: FAILED to load/build ->', e.message);
    console.log('        `gl` did not compile. Install build libs, then: npm rebuild gl');
}

try {
    const { createCanvas } = await import('canvas');
    const c = createCanvas(8, 8);
    const ctx = c.getContext('2d');
    console.log('[probe] node-canvas 2d context:', ctx ? 'OK' : 'NULL');
} catch (e) {
    console.log('[probe] node-canvas: FAILED to load/build ->', e.message);
}
