// Guard run before `npm start` (and as the systemd ExecStartPre): make sure the
// browser harness has been built AND is not older than its source. The harness
// is a Vite bundle of the Nitro renderer that the headless page loads; a stale
// or missing bundle silently runs old code (e.g. ignoring a new param).

import { existsSync, readdirSync, statSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const harnessEntry = resolve(root, 'dist-harness', 'index.html');

if (!existsSync(harnessEntry)) {
    console.error('\n[avatar-imaging] Harness not built yet.\n');
    console.error('  Run the build first:  npm run build:harness');
    console.error('  (or use  npm run dev  which builds then starts)\n');
    process.exit(1);
}

// Newest mtime among the files that determine the bundle.
const newestMtime = (path) => {
    let newest = 0;

    const walk = (p) => {
        const stat = statSync(p);

        if (stat.isDirectory()) {
            for (const name of readdirSync(p)) walk(resolve(p, name));
        } else if (stat.mtimeMs > newest) {
            newest = stat.mtimeMs;
        }
    };

    if (existsSync(path)) walk(path);

    return newest;
};

const builtAt = statSync(harnessEntry).mtimeMs;
const sourceAt = Math.max(
    newestMtime(resolve(root, 'harness')),
    newestMtime(resolve(root, 'vite.harness.config.mjs'))
);

if (sourceAt > builtAt) {
    console.warn('\n[avatar-imaging] WARNING: the harness bundle is OLDER than its source.');
    console.warn('  You are running a stale harness — new features/params may be ignored.');
    console.warn('  Rebuild it:  npm run build:harness  (then restart)\n');
}
