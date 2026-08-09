FROM node:20-bookworm AS builder

ARG RENDERER_REPO=https://github.com/duckietm/Nitro_Render_V3.git
ARG RENDERER_REF=main

RUN apt-get update && apt-get install -y --no-install-recommends \
      git build-essential python3 pkg-config \
      libcairo2-dev libpango1.0-dev libjpeg-dev libpng-dev libgif-dev librsvg2-dev \
      libgl1-mesa-dev libxi-dev libxext-dev libx11-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /build

RUN git clone --depth 1 --branch "${RENDERER_REF}" "${RENDERER_REPO}" renderer \
 && cd renderer && yarn install --non-interactive

COPY package.json ./service/package.json
RUN cd service && npm install --no-audit --no-fund

COPY . ./service
WORKDIR /build/service
ENV NITRO_RENDERER_PATH=/build/renderer
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \
      libpixman-1-0 libfontconfig1 libfreetype6 \
      libgl1 libglx-mesa0 libgl1-mesa-dri libglu1-mesa \
      libxi6 libxext6 libx11-6 libxfixes3 libxrandr2 libxxf86vm1 \
      xvfb fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /build/service/package.json ./package.json
COPY --from=builder /build/service/node_modules ./node_modules
COPY --from=builder /build/service/src ./src
COPY --from=builder /build/service/dist-node ./dist-node

EXPOSE 8082
# Start a virtual X display for headless-gl, then exec node so it becomes PID 1's
# child and receives SIGTERM for a clean shutdown. Inlined (no script file) to
# avoid any shebang/CRLF/permission pitfalls.
ENTRYPOINT ["/bin/sh", "-c", "Xvfb :99 -screen 0 1024x768x24 -nolisten tcp >/dev/null 2>&1 & export DISPLAY=:99 && exec node src/server.mjs"]
