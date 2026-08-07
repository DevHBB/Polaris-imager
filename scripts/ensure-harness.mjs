// Guard run before `npm start`: make sure the browser harness has been built.
// The harness is a Vite bundle of the Nitro renderer that the headless page
// loads; without it there is nothing for Chromium to run.

import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const harnessEntry = resolve(here, '..', 'dist-harness', 'index.html');

if (!existsSync(harnessEntry)) {
    console.error('\n[avatar-imaging] Harness not built yet.\n');
    console.error('  Run the build first:  npm run build:harness');
    console.error('  (or use  npm run dev  which builds then starts)\n');
    process.exit(1);
}
