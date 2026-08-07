# avatar-imaging

A server-side **avatar imaging API** for the Nitro renderer — the equivalent of
Habbo's `habbo-imaging/avatarimage`. Give it a figure string (plus optional
actions, gestures, effects, direction, size…) and it returns a **PNG** for a
still pose or an **animated APNG** for a moving one, suitable for embedding in a
CMS, forums, badges, signatures, etc.

Because it runs the *actual* Nitro renderer in headless Chromium, the output is
pixel-identical to what a player sees in-game — same canvas, same draw order,
same effects.

## How it works

```
        HTTP                      page.evaluate                 render
 CMS ───────────▶ Express server ───────────────▶ headless Chromium ───────▶ RGBA frames
                    (src/*.mjs)     (pool of pages)   (harness/boot.ts —          │
                                                       the real Nitro renderer)   │
 image/png ◀──── APNG/PNG encode (upng-js) ◀──────────────────────────────────────┘
```

1. `harness/boot.ts` is a Vite bundle of the in-repo Nitro renderer. It boots
   the renderer once per page and exposes `window.__nitroRenderAvatar(params)`.
2. `src/browser.mjs` keeps a small pool of headless Chromium pages (software
   WebGL via SwiftShader — no GPU required).
3. `src/server.mjs` parses the query, drives a page to render the frames, and
   `src/apng.mjs` encodes them into a single PNG or an animated APNG.

Each frame is rendered with `AvatarImage.processAsTexture`, which draws into the
canonical Habbo avatar canvas — so every animation frame is the same size and
the APNG lines up automatically.

## API

### `GET /avatarimage`

| Param            | Default | Description |
| ---------------- | ------- | ----------- |
| `figure`         | —       | Figure string to render (**required**) |
| `action`         | none    | Comma-separated actions, e.g. `wlk,wav,drk=1` (see below) |
| `gesture`        | `std`   | Face gesture: `std`, `agr`, `sad`, `sml`, `srp` |
| `direction`      | `2`     | Body direction, `0`–`7` |
| `head_direction` | `2`     | Head direction, `0`–`7` |
| `headonly`       | `0`     | `1` renders just the head (cropped) |
| `dance`          | `0`     | Dance id `0`–`4` |
| `effect`         | `0`     | Effect id |
| `size`           | `n`     | `s` (0.5×), `n` (1×), `l` (2×) |
| `frame_num`      | `0`     | Which frame to output for a *still* image |
| `img_format`     | `auto`  | `png`, `apng`, or `auto` (APNG when the pose animates) |
| `gender`         | none    | `M`/`F`/`U` — normally inferred from the figure |

**Actions** (comma-separated in `action=`):

- Postures (pick one): `std` (stand), `wlk`/`mv` (walk), `sit`, `lay`.
- Expressions: `wav`/`wave`, `blow` (blow a kiss), `laugh`, `respect`.
- Carry / drink (hand-item id after `=`): `crr=<id>` (carry), `drk=<id>` (drink).

Response is `image/png` (an APNG is a valid PNG). `X-Animated: true|false` tells
you which you got.

**Examples**

```
/avatarimage?figure=hd-180-1.ch-255-66.lg-280-110.sh-305-62
/avatarimage?figure=...&action=wlk,wav&direction=4&size=l
/avatarimage?figure=...&action=sit&gesture=sml&headonly=1
/avatarimage?figure=...&dance=1&effect=2&img_format=apng
```

### Other routes

- `GET /health` — `{ status, ready, poolSize }`
- `GET /` — plaintext usage help

## Setup

Requirements: Node 18+, a Chromium build, and network access to your hotel's
gamedata + `.nitro` assets.

The renderer is consumed exactly the way the client (`Nitro-UI`) consumes it —
via `yarn link`, so there is a single installed copy of the renderer and its
dependencies (pixi, pako, the image decoders, …) and nothing is vendored here.

```sh
# 1. Install + register the renderer (once)
cd Nitro-Renderer
yarn install
yarn link

# 2. Install the service's own deps, THEN link the renderer
#    (npm install prunes the link, so link afterwards)
cd ../avatar-imaging
npm install
yarn link "@nitrots/nitro-renderer"

# 3. Install a headless Chromium for the render pool (once)
npm run install:chromium      # = npx playwright install --with-deps chromium

# 4. Configure and run
cp .env.example .env          # then edit NITRO_GAMEDATA_URL / NITRO_ASSET_URL
npm run build:harness         # bundles the linked renderer into dist-harness/
npm start                     # boots the pool and serves the API
```

The render pool needs a Chromium binary. `npm run install:chromium` downloads
one via Playwright (the `--with-deps` also apt-installs the shared libraries a
headless Chromium needs on a bare server — needs root). The service auto-detects
it in the Playwright cache regardless of revision; alternatively point
`CHROMIUM_PATH` at an existing system Chromium (e.g. `/usr/bin/chromium`).

`npm run dev` (or `yarn run dev`) builds the harness and starts in one step. The
Vite build resolves `@nitrots/*` to the renderer source and `pixi.js`/
`pixi-filters`/`howler` to the renderer's `node_modules` — the same alias map as
`Nitro-UI/vite.config.mjs`.

The renderer directory does **not** have to be a sibling. The build finds it via
(in order): the `NITRO_RENDERER_PATH` env var, the `yarn link` symlink in
`node_modules/@nitrots/nitro-renderer`, then `../Nitro-Renderer`. So the service
can live anywhere (e.g. `/var/www/.../Avatar`) as long as it's linked — or point
it explicitly:

```sh
NITRO_RENDERER_PATH=/path/to/Nitro-Renderer npm run build:harness
```

### Required configuration

Set these to wherever your hotel serves the client's gamedata and assets —
mirror the client's `renderer-config.json` `gamedata.url` / `asset.url`:

```
NITRO_GAMEDATA_URL=https://hotel.example.com/client/gamedata
NITRO_ASSET_URL=https://hotel.example.com/client/nitro/bundled
```

From these the service derives `FigureData.json`, `FigureMap.json`,
`EffectMap.json`, `HabboAvatarActions.json`, and the `figure/`+`effect/` `.nitro`
libraries — exactly like the client. Every individual URL can also be overridden
(see `.env.example`). All other knobs (pool size, cache, FPS, timeouts, fixed
canvas) are optional.

### Running in the Claude web / remote environment

Chromium is pre-installed; point the service at it:

```
CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
```

(The pool auto-detects `PLAYWRIGHT_BROWSERS_PATH` too.)

## Using it from a CMS

The service is a plain HTTP image endpoint, so a CMS just uses it as an `<img>`
src:

```html
<img src="https://imaging.yourhotel.com/avatarimage?figure=hd-180-1.ch-255-66&action=wav&size=l">
```

Front it with your reverse proxy (nginx/Caddy) for TLS + caching. It pairs
naturally with the emulator's CMS HTTP API (`/api/cms`, see
`Gameserver/docs/cms-api-reference.md`): the CMS resolves a user's figure via
that API, then points an `<img>` at this service to show the avatar.

## Running as a public web service

### Hardening (built in)

- **No code injection**: request params are passed to the renderer as a
  JSON-serialized object via `page.evaluate` — never string-interpolated into
  JS. On top of that, `figure` and `action` are validated against strict
  character sets and length/token caps, so malformed input is rejected with 400.
- **Internal routes are loopback-only**: `/renderer-config.json` (which contains
  your gamedata/asset hosts) and `/harness` are served only to `127.0.0.1` — the
  headless Chromium that needs them — and return 404 to anyone else.
- **Rate limiting**: per-IP fixed window (`AVATAR_IMAGING_RATELIMIT_*`), 429 when
  exceeded. Behind a proxy set `AVATAR_IMAGING_TRUST_PROXY` so the real client IP
  is used.
- **Load shedding**: the render queue is bounded (`AVATAR_IMAGING_MAX_QUEUE`); a
  flood of unique (cache-missing) requests gets 503 instead of exhausting CPU.
- **No info leak**: render errors return a generic message; details are logged
  server-side only.
- **Security headers**: `X-Content-Type-Options: nosniff`, `X-Frame-Options`,
  `Referrer-Policy`, `Cross-Origin-Resource-Policy` on every response.
- **Optional API key** (`AVATAR_IMAGING_API_KEYS`) and **CORS allow-origin**
  (`AVATAR_IMAGING_CORS_ORIGIN`) when you want to restrict access.

Still, treat it like any internet-facing service: run it as a non-root user,
put TLS + a WAF/CDN in front, and keep it off a host with sensitive internal
network access it doesn't need.

### Caching (CPU offload)

Rendering is the only expensive part, so caching is what keeps CPU low:

1. **In-memory LRU + TTL** (`AVATAR_IMAGING_CACHE_*`): identical requests are
   served from memory and never re-rendered.
2. **HTTP caching**: every image carries a strong `ETag` and a `Cache-Control:
   public, max-age=…`. Conditional requests (`If-None-Match`) get a cheap `304`.
   **Put a reverse proxy or CDN in front** (nginx `proxy_cache`, Varnish,
   Cloudflare) and the vast majority of requests are served from that cache —
   they never reach Node or the renderer at all. This is the real offload.

Because a given figure+params always produces the same image, cache lifetimes
can be long. If a user changes their look the URL changes (different `figure`),
so you rarely need to invalidate; lower `max-age` only if you regenerate assets.

## Notes & limitations

- **Effects** download on demand; the first request for a new effect pays the
  download cost, then it's warm for the life of the page.
- **`size=l`** renders at the renderer's large scale and upscales 2× with
  nearest-neighbour (crisp pixel art), matching how the client shows big avatars.
- **Full-body** output uses the canonical Habbo avatar canvas; **headonly**
  output is cropped to the head (consistent across animation frames).
- Set `AVATAR_IMAGING_CANVAS_FULL` / `_HEAD` if you want a fixed padded canvas so
  a CMS grid lines up perfectly.
- Final pixel-parity tuning (exact canvas padding/anchoring) is best verified
  against your live gamedata + assets, since those determine the real output.
