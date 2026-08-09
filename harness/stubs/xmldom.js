// Minimal @xmldom/xmldom shim. @pixi/node's adapter imports it to back pixi's
// parseXML(), used for XML assets (bitmap-font .fnt, some spritesheets). The
// avatar render path uses binary .nitro bundles and node-canvas text — no XML —
// so this is never called here. If some path DOES need real XML parsing you'll
// get this clear error; then `npm i @xmldom/xmldom` and drop the alias in
// vite.node.config.mjs.
export class DOMParser {
    parseFromString() {
        throw new Error(
            '[pixinode spike] XML parsing is stubbed out. A code path tried to parse XML — ' +
            'install @xmldom/xmldom and remove its alias in vite.node.config.mjs.'
        );
    }
}

export class XMLSerializer {
    serializeToString() {
        return '';
    }
}

export default { DOMParser, XMLSerializer };
