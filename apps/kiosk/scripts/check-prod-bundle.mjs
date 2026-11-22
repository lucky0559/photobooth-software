// Fails the production build (and packaging, via electron-builder's beforePack hook) if `out/` (the bundle that gets
// packaged) is missing, incomplete, has source maps, or contains any test-only hook.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORBIDDEN = ['__pbDebug', '__pbFake', '__pbPrintCalls', 'PB_FAKE', 'PB_USER_DATA'];

/** Present only in the trial bundle (the demo payment QR, the trial clock file): the real `out/` must never contain them. */
export const TRIAL_ONLY_MARKERS = ['DEMO PAYMENT', 'trial.json'];

/** Env values the trial build must not inline: a Supabase URL (hosted or local) or a JWT-looking key. */
export const TRIAL_FORBIDDEN_ENV = /supabase\.co|127\.0\.0\.1:54321|eyJ[A-Za-z0-9_-]{10,}/;

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

/** `file: marker` for every trial-only marker found (what must not appear in the real bundle). */
export function findTrialMarkers(dir) {
  const hits = [];
  for (const p of listFiles(dir)) {
    if (!/\.(m?js|cjs|html)$/.test(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const marker of TRIAL_ONLY_MARKERS) if (text.includes(marker)) hits.push(`${relative(dir, p)}: ${marker}`);
  }
  return hits;
}

/** `file: match` for every Supabase URL / key found (what must not appear in the trial bundle). */
export function findTrialEnvLeaks(dir) {
  const hits = [];
  // .js only: index.html legitimately carries the CSP `connect-src https://*.supabase.co http://127.0.0.1:54321`.
  for (const p of listFiles(dir)) {
    if (!/\.(m?js|cjs)$/.test(p)) continue;
    const m = TRIAL_FORBIDDEN_ENV.exec(readFileSync(p, 'utf8'));
    if (m) hits.push(`${relative(dir, p)}: ${m[0].slice(0, 12)}...`);
  }
  return hits;
}

/**
 * Every reason `dir` must not be packaged (empty when it may). `trial` is for `out-trial/`: it may hold the demo
 * markers but must not hold Supabase env values; the real `out/` is the opposite.
 * @param {string} dir
 * @param {{ trial?: boolean }} [options]
 */
export function checkPackageableBundle(dir, { trial = false } = {}) {
  if (!existsSync(dir)) return [`${dir} is missing: run \`pnpm build\` (the production build) first`];
  const problems = REQUIRED.filter((f) => !existsSync(join(dir, f))).map((f) => `missing ${f}`);
  for (const p of listFiles(dir)) if (p.endsWith('.map')) problems.push(`source map ${relative(dir, p)}`);
  for (const hit of findTestHooks(dir)) problems.push(`test-only hook ${hit}`);
  if (trial) for (const hit of findTrialEnvLeaks(dir)) problems.push(`env value baked into the trial bundle ${hit}`);
  else for (const hit of findTrialMarkers(dir)) problems.push(`trial-only marker ${hit}`);
  return problems;
}

/**
 * Throws if `dir` must not be packaged.
 * @param {string} [dir]
 * @param {{ trial?: boolean }} [options]
 */
export function assertPackageableBundle(dir = OUT_DIR, options = {}) {
  const problems = checkPackageableBundle(dir, options);
  if (problems.length > 0) throw new Error(`Refusing to package ${dir}:\n${problems.join('\n')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    // `--trial` (build:trial) checks out-trial/; with no flag this is the strict real-bundle check.
    const args = process.argv.slice(2);
    const trial = args.includes('--trial');
    const dirArg = args.find((a) => !a.startsWith('--'));
    assertPackageableBundle(dirArg ? resolve(dirArg) : undefined, { trial });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  console.log(`check-prod-bundle: ${process.argv[2] ?? 'out'} is complete and has no test-only hooks`);
}
