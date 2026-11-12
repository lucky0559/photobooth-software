// Fails the production build if any test-only hook leaked into `out/` (the bundle that gets packaged).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN = ['__pbDebug', '__pbFake', '__pbPrintCalls', 'PB_FAKE', 'PB_USER_DATA'];

/** Returns `file: marker` for every forbidden marker found in .js/.html/.mjs/.cjs files under `dir`. */
export function findTestHooks(dir) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|cjs|html)$/.test(name)) {
        const text = readFileSync(p, 'utf8');
        for (const marker of FORBIDDEN) if (text.includes(marker)) hits.push(`${relative(dir, p)}: ${marker}`);
      }
    }
  };
  walk(dir);
  return hits;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outDir = fileURLToPath(new URL('../out', import.meta.url));
  const hits = findTestHooks(outDir);
  if (hits.length > 0) {
    console.error(`Production bundle contains test-only hooks:\n${hits.join('\n')}`);
    process.exit(1);
  }
  console.log('check-prod-bundle: out/ has no test-only hooks');
}
