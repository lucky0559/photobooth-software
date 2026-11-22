// Fails the production build (and packaging, via electron-builder's beforePack hook) if `out/` (the bundle that gets
// packaged) is missing, incomplete, has source maps, or contains any test-only hook.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN = ['__pbDebug', '__pbFake', '__pbPrintCalls', 'PB_FAKE', 'PB_USER_DATA'];

/** Entry files `package.json` `main` and the main process load at runtime. */
export const REQUIRED = ['main/index.js', 'preload/index.js', 'renderer/index.html'];

/** Production bundle dir, next to this script. */
export const OUT_DIR = fileURLToPath(new URL('../out', import.meta.url));

function listFiles(dir) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  return files;
}

/** Returns `file: marker` for every forbidden marker found in .js/.html/.mjs/.cjs files under `dir`. */
export function findTestHooks(dir) {
  const hits = [];
  for (const p of listFiles(dir)) {
    if (!/\.(m?js|cjs|html)$/.test(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const marker of FORBIDDEN) if (text.includes(marker)) hits.push(`${relative(dir, p)}: ${marker}`);
  }
  return hits;
}

/** Every reason `dir` must not be packaged (empty when it may). */
export function checkPackageableBundle(dir) {
  if (!existsSync(dir)) return [`${dir} is missing: run \`pnpm build\` (the production build) first`];
  const problems = REQUIRED.filter((f) => !existsSync(join(dir, f))).map((f) => `missing ${f}`);
  for (const p of listFiles(dir)) if (p.endsWith('.map')) problems.push(`source map ${relative(dir, p)}`);
  for (const hit of findTestHooks(dir)) problems.push(`test-only hook ${hit}`);
  return problems;
}

/** Throws if `dir` must not be packaged. */
export function assertPackageableBundle(dir = OUT_DIR) {
  const problems = checkPackageableBundle(dir);
  if (problems.length > 0) throw new Error(`Refusing to package ${dir}:\n${problems.join('\n')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    assertPackageableBundle(process.argv[2] ? resolve(process.argv[2]) : undefined);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  console.log(`check-prod-bundle: ${process.argv[2] ?? 'out'} is complete and has no test-only hooks`);
}
