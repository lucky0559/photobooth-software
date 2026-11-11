import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// @pb/core ships TypeScript source, so it must be bundled rather than required at runtime.
const externalizeDeps = { exclude: ['@pb/core'] };

export default defineConfig({
  main: { build: { externalizeDeps } },
  preload: { build: { externalizeDeps } },
  renderer: { plugins: [react()] },
});
