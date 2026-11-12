import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// @pb/core ships TypeScript source, so it must be bundled rather than required at runtime.
const externalizeDeps = { exclude: ['@pb/core'] };

// The e2e build (fake API + test hooks) goes to `out-e2e/`, never to `out/`, so packaging (which only
// uses `out/`) can never ship it. Test-only code in main/preload is compiled out of the real build.
const testBuild = process.env.VITE_FAKE_API === '1';
const outRoot = testBuild ? 'out-e2e' : 'out';
const define = { __PB_TEST_BUILD__: JSON.stringify(testBuild) };

export default defineConfig({
  main: { define, build: { externalizeDeps, outDir: `${outRoot}/main` } },
  preload: { define, build: { externalizeDeps, outDir: `${outRoot}/preload` } },
  renderer: { plugins: [react()], build: { outDir: `${outRoot}/renderer` } },
});
