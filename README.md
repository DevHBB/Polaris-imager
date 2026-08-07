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
| `text`           | none    | Speech-bubble text shown above the avatar |
| `text_color`     | `000000`| Bubble text colour (hex, `rgb` or `rrggbb`) |
| `bubble_color`   | `ffffff`| Bubble background colour (hex) |

**Actions** (comma-separated in `action=`):

- Postures (pick one): `std` (stand), `wlk`/`mv` (walk), `sit`, `lay`.
- Expressions: `wav`/`wave`, `blow` (blow a kiss), `laugh`, `respect`.
- Carry / drink (hand-item id after `=`): `crr=<id>` (carry), `drk=<id>` (drink).

Response is `image/png` (an APNG is a valid PNG). `X-Animated: true|false` tells
you which you got.

**Speech bubble**: `text=` draws a Habbo-style rounded balloon (with a downward
tail) centred above the avatar; the canvas grows to fit it and it's overlaid on
every animation frame. Colours are configurable via `text_color`/`bubble_color`.
Text length is capped by `AVATAR_IMAGING_MAX_TEXT_LEN` (default 100) and long
lines wrap automatically.

- **Spaces**: URL-encode them — `text=Hello%20World` (or `+`: `text=Hello+World`).
- **Line breaks**: use `%0A`, or a literal `\n` in the query —
  `text=Hello%0AWorld` or `text=Hello\nWorld` both render two centred lines.

**Requires a font on the server** — see the Ubuntu deploy step (install
`fonts-dejavu-core`); without one the bubble renders empty text.

**Examples**

```
/avatarimage?figure=hd-180-1.ch-255-66.lg-280-110.sh-305-62
/avatarimage?figure=...&action=wlk,wav&direction=4&size=l
/avatarimage?figure=...&action=sit&gesture=sml&headonly=1
/avatarimage?figure=...&dance=1&effect=2&img_format=apng
/avatarimage?figure=...&text=Hello!&bubble_color=2266cc&text_color=ffffff
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

## Deploying on Ubuntu (systemd)

A hardened unit file is provided at
[`deploy/avatar-imaging.service`](deploy/avatar-imaging.service). Full walkthrough
(assumes the service lives at `/opt/avatar-imaging` and the renderer at
`/opt/Nitro-Renderer` — adjust to taste):

```sh
# 1. Node 20 LTS + git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 2. A dedicated, unprivileged user
sudo useradd --system --home /opt/avatar-imaging --shell /usr/sbin/nologin avatar

# 3. Put the code in place (copy/clone your renderer + this service), e.g.:
sudo mkdir -p /opt/avatar-imaging /opt/Nitro-Renderer
#   ...copy the avatar-imaging/ contents to /opt/avatar-imaging and the
#      Nitro-Renderer/ contents to /opt/Nitro-Renderer...
sudo chown -R avatar:avatar /opt/avatar-imaging /opt/Nitro-Renderer

# 4. Install deps + link the renderer, as the service user
sudo -u avatar bash -lc '
  cd /opt/Nitro-Renderer && yarn install && yarn link
  cd /opt/avatar-imaging && npm install && yarn link "@nitrots/nitro-renderer"
'

# 5. Install Chromium into the pinned browser path (root, for --with-deps libs)
sudo PLAYWRIGHT_BROWSERS_PATH=/opt/avatar-imaging/pw-browsers \
     npx --yes playwright install --with-deps chromium
sudo chown -R avatar:avatar /opt/avatar-imaging/pw-browsers

# 5b. A font so the text= speech-bubble feature renders (skip if unused)
sudo apt-get install -y fonts-dejavu-core

# 6. Build the harness bundle
sudo -u avatar bash -lc 'cd /opt/avatar-imaging && npm run build:harness'

# 7. Configure. Bind to loopback (nginx faces the internet) and set your hosts.
sudo -u avatar cp /opt/avatar-imaging/.env.example /opt/avatar-imaging/.env
sudo -u avatar $EDITOR /opt/avatar-imaging/.env
#   AVATAR_IMAGING_HOST=127.0.0.1
#   AVATAR_IMAGING_TRUST_PROXY=true
#   AVATAR_IMAGING_CLIENT_IP_HEADER=x-forwarded-for   # or cf-connecting-ip
#   AVATAR_IMAGING_LOG_FILE=/var/log/avatar-imaging/access.log
#   NITRO_GAMEDATA_URL=... / NITRO_ASSET_URL=... (+ your overrides)

# 8. Log directory
sudo mkdir -p /var/log/avatar-imaging
sudo chown avatar:avatar /var/log/avatar-imaging

# 9. Install + start the service
sudo cp /opt/avatar-imaging/deploy/avatar-imaging.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now avatar-imaging

# 10. Verify
systemctl status avatar-imaging
journalctl -u avatar-imaging -f          # startup + operational logs
curl -s http://127.0.0.1:8081/health     # {"status":"ok","ready":true,...}
```

The unit runs as the `avatar` user with `NoNewPrivileges`, `ProtectSystem=strict`,
`ProtectHome`, `PrivateTmp`, a `MemoryMax=2G` ceiling, and auto-restart. The
access log rotates itself (see above); operational logs go to the journal. Then
put the [nginx config](deploy/nginx.conf.example) in front for TLS + caching.

To update later: deploy the new code, then
`sudo -u avatar bash -lc 'cd /opt/avatar-imaging && npm run build:harness'` and
`sudo systemctl restart avatar-imaging`.

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
- **Real client IP behind a CDN**: set `AVATAR_IMAGING_CLIENT_IP_HEADER` to the
  header your edge sets — `cf-connecting-ip` (Cloudflare) or `x-forwarded-for`
  (nginx) — and both logging and rate limiting use it instead of the proxy's IP.
- **Access log**: on by default (`AVATAR_IMAGING_ACCESS_LOG=0` to silence). One
  line per client request with the resolved IP, method, path, status, cache hit,
  and timing (any `?key=` is redacted):

  ```
  [access] 203.0.113.99 GET /avatarimage?figure=hd-180-1&size=l -> 200 5183b HIT 1ms
  ```

  Health checks and the internal harness/config routes are excluded to keep it
  readable. By default it goes to stdout (systemd journal, Docker logs, etc.).

  **Log rotation**: set `AVATAR_IMAGING_LOG_FILE` to write to a file with
  built-in size-based rotation — it rolls to `<file>.1 … <file>.N` at
  `AVATAR_IMAGING_LOG_MAX_BYTES` (default 10 MB), keeping
  `AVATAR_IMAGING_LOG_MAX_FILES` (default 5). No external tooling needed, so it
  works the same in Docker. If you'd rather rotate by time with the OS, use
  [`deploy/logrotate.example`](deploy/logrotate.example) (with `copytruncate`)
  and set a large `LOG_MAX_BYTES` so the built-in rotation stays out of the way.
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
2. **HTTP caching**: every image carries an `ETag` (derived from the request, so
   a conditional `If-None-Match` is answered `304` **without rendering** — ~1 ms
   instead of a full render) and a `Cache-Control: public, max-age=…`.
   The `X-Cache` header (and access log) shows which path a request took:
   `HIT` (served from the in-memory cache), `MISS` (rendered fresh), or
   `REVALIDATED` (304, client's copy still valid — no render, no bytes).
   Because the ETag is request-based, bump `AVATAR_IMAGING_ASSET_VERSION` when
   you regenerate gamedata/assets to invalidate clients' cached copies.
   **Put a reverse proxy or CDN in front** (nginx `proxy_cache`, Varnish,
   Cloudflare) and the vast majority of requests are served from that cache —
   they never reach Node or the renderer at all. This is the real offload. A
   ready-to-adapt config (proxy cache, cache-lock, rate limit, real-IP
   forwarding, blocked internal routes) is in
   [`deploy/nginx.conf.example`](deploy/nginx.conf.example) — bind the service to
   `127.0.0.1` and let nginx face the internet.

Because a given figure+params always produces the same image, cache lifetimes
can be long. If a user changes their look the URL changes (different `figure`),
so you rarely need to invalidate; lower `max-age` only if you regenerate assets.

### Memory & sizing

Most of the footprint is Chromium — each pool page is a full renderer instance.

| Part | Rough RAM |
| ---- | --------- |
| Node process | ~60–90 MB |
| Chromium (browser + `AVATAR_IMAGING_POOL` pages) | ~250 MB + ~250–500 MB per page |
| Response cache | up to `AVATAR_IMAGING_CACHE_MAX_BYTES` (default 256 MB) |

So a default **pool of 2 sits around ~1–1.5 GB warmed**, growing ~linearly with
the pool size. **Budget ~1.5–2 GB** for a small deploy; give it more if you
raise `AVATAR_IMAGING_POOL`.

Each renderer page caches every clothing/effect texture it has ever drawn and
never evicts, so without limits a long-running page creeps upward with the
*variety* of requests. Two bounds keep it flat:

- **`AVATAR_IMAGING_PAGE_MAX_RENDERS`** (default 500) — recycles a page (close +
  recreate) after N renders, releasing its accumulated assets. Set `0` to
  disable if you have plenty of RAM and want to avoid the occasional recycle.
- **`AVATAR_IMAGING_CACHE_MAX_BYTES`** (default 256 MB) — hard cap on the
  in-memory image cache, evicted LRU alongside the entry-count cap.

Tuning: lower `AVATAR_IMAGING_POOL` (fewer concurrent renders, less RAM), lower
`PAGE_MAX_RENDERS` (recycle sooner, flatter memory, slightly more churn), or lean
harder on the nginx/CDN cache so fewer requests hit the renderer at all.

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
