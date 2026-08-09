const g = globalThis;

if (!g.window) g.window = g;
if (!g.self) g.self = g;
if (!g.navigator) g.navigator = { userAgent: 'nitro-imaging-node', language: 'en', platform: 'node' };
if (!g.location) {
    g.location = { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', pathname: '/', search: '' };
}
if (!g.document) {
    g.document = {
        createElement: () => ({ style: {}, setAttribute() {}, getContext: () => null, addEventListener() {}, removeEventListener() {} }),
        addEventListener() {},
        removeEventListener() {},
        getElementsByTagName: () => [],
        querySelector: () => null,
        documentElement: { style: {} },
        body: { style: {}, appendChild() {}, removeChild() {} }
    };
}
