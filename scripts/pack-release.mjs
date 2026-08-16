// ---------------------------------------------------------------------------
// [EN] pack-release.mjs — package an ALREADY BUILT service for redistribution.
//      The expensive part of this project is the build: cloning the Nitro
//      renderer and bundling it with Vite. This script takes the result of that
//      build (dist-node/boot-node.mjs) and produces a folder + tarball that
//      other people can run with just `npm install --omit=dev && npm start` —
//      no renderer checkout, no Vite, no yarn link.
//
//      Usage:  npm run build   (once, on your machine)
//              npm run pack    (produces release/<name>-<version>.tar.gz)
//
// [FR] pack-release.mjs — empaquette un service DÉJÀ COMPILÉ pour la
//      redistribution. La partie coûteuse de ce projet est la compilation :
//      cloner le moteur Nitro et le bundler avec Vite. Ce script reprend le
//      résultat de cette compilation (dist-node/boot-node.mjs) et produit un
//      dossier + une archive que d'autres personnes peuvent lancer avec un
//      simple `npm install --omit=dev && npm start` — sans clone du moteur,
//      sans Vite, sans yarn link.
//
//      Utilisation :  npm run build   (une fois, sur votre machine)
//                     npm run pack    (produit release/<nom>-<version>.tar.gz)
// ---------------------------------------------------------------------------

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const bundle = join(root, 'dist-node', 'boot-node.mjs');

// [EN] Refuse to package a build that does not exist — the whole point is
//      shipping the bundle. [FR] Refuse d'empaqueter une compilation absente —
//      tout l'intérêt est justement de livrer le bundle.
if (!existsSync(bundle)) {
    console.error('[pack] dist-node/boot-node.mjs is missing. Run `npm run build` first.');
    console.error('[pack] dist-node/boot-node.mjs est absent. Lancez d\'abord `npm run build`.');
    process.exit(1);
}

const name = `${ pkg.name }-${ pkg.version }`;
const outDir = join(root, 'release', name);

rmSync(join(root, 'release'), { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// [EN] Runtime files only: the built bundle, the server sources, the sample env
//      and the docs. harness/, vite config and the renderer are build-time only.
// [FR] Fichiers d'exécution uniquement : le bundle compilé, les sources du
//      serveur, l'exemple d'env et la doc. harness/, la config Vite et le moteur
//      ne servent qu'à la compilation.
for (const entry of ['dist-node', 'src', 'render.mjs', '.env.example', 'README.md', 'DEMARRAGE.md']) {
    const from = join(root, entry);

    if (existsSync(from)) cpSync(from, join(outDir, entry), { recursive: true });
}

// [EN] A runtime-only package.json: dev dependencies (pixi, vite, …) are gone,
//      and `build` is replaced by a message so nobody wonders why it fails.
// [FR] Un package.json d'exécution seule : les dépendances de développement
//      (pixi, vite, …) disparaissent, et `build` est remplacé par un message
//      pour que personne ne se demande pourquoi il échoue.
const runtimePkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    type: 'module',
    description: `${ pkg.description } Prebuilt distribution — no renderer checkout or Vite build required.`,
    engines: { node: '>=20' },
    scripts: {
        start: 'node src/server.mjs',
        render: 'node render.mjs',
        build: 'node -e "console.log(\'This is a prebuilt distribution: dist-node/ is already bundled. Nothing to build.\')"'
    },
    dependencies: pkg.dependencies
};

writeFileSync(join(outDir, 'package.json'), `${ JSON.stringify(runtimePkg, null, 4) }\n`);

// [EN] Docker image built from the prebuilt bundle: no git clone, no yarn, no
//      Vite — minutes faster than the source Dockerfile, and it works offline.
// [FR] Image Docker construite depuis le bundle précompilé : pas de git clone,
//      pas de yarn, pas de Vite — plusieurs minutes de moins que le Dockerfile
//      source, et cela fonctionne hors ligne.
writeFileSync(join(outDir, 'Dockerfile'), `# [EN] Runtime image for the PREBUILT distribution. Only the native modules
# (canvas, gl) are installed here; the renderer is already inside dist-node/.
# [FR] Image d'exécution pour la distribution PRÉCOMPILÉE. Seuls les modules
# natifs (canvas, gl) sont installés ici ; le moteur est déjà dans dist-node/.

FROM node:20-bookworm AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \\
      build-essential python3 pkg-config \\
      libcairo2-dev libpango1.0-dev libjpeg-dev libpng-dev libgif-dev librsvg2-dev \\
      libgl1-mesa-dev libxi-dev libxext-dev libx11-dev \\
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \\
      libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libjpeg62-turbo libgif7 librsvg2-2 \\
      libpixman-1-0 libfontconfig1 libfreetype6 \\
      libgl1 libglx-mesa0 libgl1-mesa-dri libglu1-mesa \\
      libxi6 libxext6 libx11-6 libxfixes3 libxrandr2 libxxf86vm1 \\
      xvfb fonts-liberation \\
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
# [EN] No GPU in a container: force Mesa's software rasterizer.
# [FR] Pas de GPU dans un conteneur : force le rastériseur logiciel de Mesa.
ENV LIBGL_ALWAYS_SOFTWARE=1
ENV GALLIUM_DRIVER=llvmpipe

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY dist-node ./dist-node

EXPOSE 8082
ENTRYPOINT ["/bin/sh", "-c", "Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp >/dev/null 2>&1 & export DISPLAY=:99; for i in $(seq 1 100); do [ -S /tmp/.X11-unix/X99 ] && break; sleep 0.1; done; exec node src/server.mjs"]
`);

writeFileSync(join(outDir, 'docker-compose.yml'), `# [EN] Prebuilt distribution — copy .env.example to .env first.
# [FR] Distribution précompilée — copiez d'abord .env.example vers .env.
services:
  avatar-imager:
    build:
      context: .
    image: ${ pkg.name }:${ pkg.version }
    container_name: avatar-imager
    restart: unless-stopped
    init: true
    env_file:
      - .env
    ports:
      - "\${AVATAR_IMAGING_PORT:-8082}:\${AVATAR_IMAGING_PORT:-8082}"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:'+(process.env.AVATAR_IMAGING_PORT||8082)+'/health').then(r=>r.json()).then(j=>process.exit(j.ready?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 90s
`);

// [EN] Short install sheet aimed at whoever receives the archive.
// [FR] Notice d'installation courte destinée à qui reçoit l'archive.
writeFileSync(join(outDir, 'INSTALL.md'), `# ${ pkg.name } — distribution précompilée / prebuilt distribution

**[FR]** Le moteur de rendu Nitro est déjà compilé dans \`dist-node/\`.
Vous n'avez ni à cloner le moteur, ni à lancer Vite.
**[EN]** The Nitro renderer is already bundled into \`dist-node/\`.
You do not need to clone the renderer or run Vite.

## Docker (recommandé / recommended)

\`\`\`bash
cp .env.example .env      # éditez NITRO_GAMEDATA_URL / NITRO_ASSET_URL
docker compose up -d --build
\`\`\`

## Sans Docker / Without Docker

Node **20 LTS**, puis / then:

\`\`\`bash
# Debian / Ubuntu
sudo apt-get install -y build-essential python3 pkg-config \\
  libcairo2-dev libpango1.0-dev libjpeg-dev libpng-dev libgif-dev librsvg2-dev \\
  libgl1-mesa-dev libxi-dev libxext-dev libx11-dev fonts-liberation xvfb

cp .env.example .env      # éditez NITRO_GAMEDATA_URL / NITRO_ASSET_URL
npm install --omit=dev    # binaires précompilés de canvas + gl
xvfb-run -a npm start     # Windows/macOS : npm start (pas de xvfb)
\`\`\`

## Vérifier / Check

- API   : \`http://VOTRE-IP:8082/avatarimage?figure=hd-180-1.ch-255-66.lg-280-110\`
- Studio: \`http://VOTRE-IP:8082/Generate\`
- Santé / health: \`http://VOTRE-IP:8082/health\`

Voir \`GENERATE.md\` pour l'interface du générateur.
See \`GENERATE.md\` for the generator UI.
`);

// [EN] Tarball. `tar` ships with Linux, macOS and Windows 10+; if it is missing
//      the folder is still usable, so this is a soft failure.
// [FR] Archive. `tar` est fourni avec Linux, macOS et Windows 10+ ; s'il manque,
//      le dossier reste utilisable : l'échec est donc non bloquant.
const tarball = join(root, 'release', `${ name }.tar.gz`);

try {
    execFileSync('tar', ['-czf', tarball, '-C', join(root, 'release'), name], { stdio: 'inherit' });

    const mb = (statSync(tarball).size / 1048576).toFixed(1);

    console.log(`[pack] ${ tarball } (${ mb } MB)`);
} catch {
    console.warn('[pack] `tar` unavailable — the release folder is ready, archive it yourself.');
    console.warn('[pack] `tar` indisponible — le dossier release est prêt, archivez-le vous-même.');
}

console.log(`[pack] ${ outDir }`);
console.log('[pack] Recipients run: npm install --omit=dev && npm start   (or: docker compose up -d --build)');
