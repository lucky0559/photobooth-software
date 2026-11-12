import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Main script of the e2e build (`pnpm build:e2e` writes it to `out-e2e/`, never `out/`).
 * Specs launch this file directly so they can never run, or depend on, the production bundle.
 */
export const E2E_MAIN = join(__dirname, '..', 'out-e2e', 'main', 'index.js');

if (!existsSync(E2E_MAIN)) throw new Error('Run `pnpm build:e2e` first: out-e2e/main/index.js is missing');
