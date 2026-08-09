// cross-fetch shim: @pixi/node's adapter imports cross-fetch, but Node 18+ has a
// native global fetch (and Headers/Request/Response), so use that instead of the
// polyfill. Avoids bundling/resolving the extra dep and uses the platform impl.
const doFetch = (...args) => globalThis.fetch(...args);

export default doFetch;
export const fetch = doFetch;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
