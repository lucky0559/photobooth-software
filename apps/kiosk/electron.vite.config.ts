import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// @pb/core ships TypeScript source, so it must be bundled rather than required at runtime.
const externalizeDeps = { exclude: ['@pb/core'] };

// The e2e build (fake API + test hooks) goes to `out-e2e/`, never to `out/`, so packaging (which only
// uses `out/`) can never ship it. Test-only code in main/preload is compiled out of the real build.
// The trial build (demo backend, VITE_TRIAL=1) goes to `out-trial/`, packaged by electron-builder.trial.yml.
const testBuild = process.env.VITE_FAKE_API === '1';
const trialBuild = process.env.VITE_TRIAL === '1';
if (testBuild && trialBuild) throw new Error('VITE_FAKE_API=1 and VITE_TRIAL=1 cannot be combined');

export default defineConfig(({ command }) => {
  // `electron-vite dev` runs the entry named by package.json `main` (./out/main/index.js), so the trial
  // output dir applies to builds only; dev:trial keeps writing to `out/`.
  const outRoot = testBuild ? 'out-e2e' : trialBuild && command === 'build' ? 'out-trial' : 'out';
  const define = { __PB_TEST_BUILD__: JSON.stringify(testBuild) };
  return {
    main: { define, build: { externalizeDeps, outDir: `${outRoot}/main` } },
    preload: { define, build: { externalizeDeps, outDir: `${outRoot}/preload` } },
    // The renderer's trial switch follows the same process.env flag as the output dir (never `.env`), so a
    // stray VITE_TRIAL=1 in `.env` cannot turn the real build into a trial one. A constant lets the bundler drop
    // the demo backend from the real bundle.
    renderer: {
      plugins: [react()],
      define: { 'import.meta.env.VITE_TRIAL': JSON.stringify(trialBuild ? '1' : '') },
      build: { outDir: `${outRoot}/renderer` },
    },
  };
});
