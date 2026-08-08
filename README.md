# avatar-imaging-pixinode

Render Nitro avatars server-side with **`@pixi/node`** — a real WebGL context via
headless-gl, **no headless browser**. Same public API as the browser service in
[`../avatar-imaging`](../avatar-imaging), a fraction of the footprint.

The browser service is left completely untouched; this is a parallel engine.

## Status: working ✅

The full Nitro renderer runs in-process on `@pixi/node` with a real headless-gl
WebGL 1 context — no Chromium, no Playwright. Verified on a headless VPS:

- **Plain avatars** — pixel-correct.
- **Static effects** (e.g. `effect=110`) — correct compositing.
- **Animated effects with blend modes** (e.g. `effect=14`, the hoverboard) —
  16-frame APNG, additive glow (`ink: 33`) composited correctly.

Typical timing: ~350–470ms one-time renderer boot, then ~130–400ms per render.

## Why

`@pixi/node@8` targets pixi.js v8 (which the Nitro renderer uses) and runs the
**actual** renderer in-process. The render *logic* is the byte-for-byte browser
harness (`harness/boot-node.ts` is a copy of `../avatar-imaging/harness/boot.ts`);
only the boot/environment differs (`harness/node-env.ts`). No Chromium means RAM
drops from hundreds of MB per worker to tens, faster cold start, and a simpler
deploy — worthwhile at volume (e.g. ~10k renders/day).

## Prerequisites

- **Node 20+ (22 recommended).**
- **Native build toolchain** — `@pixi/node@8` declares its natives as *peer*
  deps, so this package lists them explicitly: `canvas` (node-canvas `^3.2.0`)
  and `gl` (headless-gl `^8.1.6`). Both compile from source on `npm install`:
  - Debian/Ubuntu:
    ```
    sudo apt-get install -y build-essential python3 pkg-config \
      libcairo2-dev libpango1.0-dev libjpeg-dev libpng-dev libgif-dev librsvg2-dev \
      libgl1-mesa-dev libxi-dev libxext-dev libx11-dev \
      fonts-liberation
    ```
  - `fonts-liberation` is for the speech-bubble text (`?text=`): node-canvas has
    no bundled fonts, so `node-env.ts` registers Liberation Sans (Arial-metric-
    compatible) as family "Arial". Without a font installed the bubble is blank —
    or set `AVATAR_IMAGING_FONT_FILE` to a specific `.ttf` for byte-identical text.
  - (`pixi.js` comes from the linked renderer; `cross-fetch` / `@xmldom/xmldom`
    are shimmed at build time — see `harness/stubs/`.)
- **`xvfb` (headless).** Depending on your GL stack, headless-gl may need an X
  display to create its context. Running under `xvfb-run -a` is the safe default:
  ```
  sudo apt-get install -y xvfb
  ```
  (The old "pixi falls back to a canvas renderer without a display" problem is
  fixed in `node-env.ts` — the Node adapter is forced, not auto-detected — but
  `gl` itself can still want a display on some systems.)
- The **Nitro renderer**, linked exactly like the browser service / Nitro-UI:
  ```
  cd ../Nitro-Renderer && yarn install && yarn link
  cd ../avatar-imaging-pixinode && yarn link "@nitrots/nitro-renderer"
  ```
  (or set `NITRO_RENDERER_PATH` to the renderer directory).

## Setup

```
npm install                       # pulls @pixi/node (+ native gl/canvas), express, vite
cp .env.example .env              # point NITRO_GAMEDATA_URL / NITRO_ASSET_URL at your hotel
npm run build                     # bundles harness/boot-node.ts -> dist-node/boot-node.mjs
```

## Run — HTTP service

Same contract as the browser service (`GET /avatarimage`, `/health`, `/`):

```
xvfb-run -a npm start             # boots the renderer once, listens on :8082 (AVATAR_IMAGING_PORT)
# then:
curl 'http://localhost:8082/avatarimage?figure=hd-180-1.ch-255-66.lg-280-110.sh-305-62&effect=14&img_format=apng' -o out.png
```

`npm run serve` does `build` + `start`. The renderer is initialized **once** and
reused across requests. Because there is a single WebGL context, renders are
**serialized** (one at a time) with a bounded queue that sheds load with `503`
past `AVATAR_IMAGING_MAX_QUEUE`. A per-request response cache + ETags mean repeat
requests never reach the renderer. All `AVATAR_IMAGING_*` knobs (port, cache,
rate limit, API keys, CORS, proxy/real-IP, access log) are in `.env.example` and
match the browser service's names.

### Query parameters

`figure` (required) · `action=wlk,wav,drk=1` · `gesture=std|agr|sad|sml|srp` ·
`direction=0-7` · `head_direction=0-7` · `headonly=0|1` · `dance=0-4` ·
`effect=N` · `size=s|n|l` · `frame_num=N` · `img_format=png|apng|auto` ·
`text=` `text_color=` `bubble_color=`

## Run — one-shot CLI

```
xvfb-run -a node render.mjs --figure=hd-180-1.ch-255-66.lg-280-110.sh-305-62 --out=out/plain.png
xvfb-run -a node render.mjs --figure=<fig> --effect=14 --format=apng --out=out/effect.png
```

CLI flags: `--figure=` (required) · `--effect=N` · `--direction=0-7` ·
`--head_direction=` · `--action=std|wlk|sit|lay|wav` · `--gesture=sml|sad|agr|srp` ·
`--dance=1-4` · `--headonly` · `--scale=h|sh` · `--format=auto|png|apng` ·
`--post-scale=N` · `--text=` `--text-color=` `--bubble-color=` · `--debug` ·
`--out=path.png`

## Comparing against the browser service

Render the **same** figure from both and diff:

```
# browser service (in ../avatar-imaging, running on :8081):
curl 'http://localhost:8081/avatarimage?figure=<fig>&effect=14&img_format=apng' -o browser.png
# this service (:8082):
curl 'http://localhost:8082/avatarimage?figure=<fig>&effect=14&img_format=apng' -o pixinode.png
```

The one known subtlety is **premultiplied alpha**: this engine decodes `.nitro`
PNGs by drawing them onto a node-canvas 2D context (`node-env.ts`'s
`createImageBitmap` shim), which doesn't premultiply the way a browser's
`createImageBitmap` does. Plain avatars are unaffected; if a heavy-alpha effect
shows edge differences, that's the place to look.

## How the headless boot works (`harness/node-env.ts`)

Loaded first by `boot-node.ts`. It:

1. Imports `@pixi/node` (registers the Node adapter) and **asserts + locks** it
   onto the renderer's `DOMAdapter` — pixi's `browserAll` otherwise installs the
   BrowserAdapter at import and the renderer would build its canvas from the fake
   `document` (null WebGL context).
2. Primes pixi's memoized `isWebGLSupported()` under the Node adapter.
3. Shims minimal `window`/`document`/`navigator`/`location`, and
   `createImageBitmap` (node-canvas `loadImage`) so Nitro's `StaticImageDecoder`
   can decode the `.nitro` PNGs.

Plus, in `boot-node.ts`/`vite.node.config.mjs`: `preferWebGLVersion: 1` (headless
canvas only serves WebGL 1), `skipExtensionImports: true`, and
`inlineDynamicImports` so the SSR bundle is a single file with exactly one pixi
instance.

## Scaling

This service runs **one** renderer and serializes renders — ample for ~10k/day
(one render ≈ 130–400ms → hundreds of thousands/day of headroom). For higher
burst concurrency, the natural next step is a `worker_threads` / process pool
(each worker its own renderer + GL context, like the browser service's page
pool), fronted by the same queue. Not needed yet, so not built.
