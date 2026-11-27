import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Keep this config in native ESM mode independently of the Electron package type.

const configRoot = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(configRoot, 'src/renderer/web');
const webOutDir = resolve(configRoot, 'dist-web');
const iconPath = resolve(configRoot, 'build/icon.png');
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";

function offlineWebPlugin(): Plugin {
  let transformedIndex = '';
  return {
    name: 'photobooth-trial-offline-shell',
    apply: 'build',
    transformIndexHtml(html) {
      transformedIndex = html.replace('</head>', '<meta http-equiv="Content-Security-Policy" content="' + csp + '"></head>');
      return transformedIndex;
    },
    generateBundle(_options, bundle) {
      const icon = readFileSync(iconPath);
      const manifest = JSON.stringify({
        name: 'Photobooth Trial',
        short_name: 'Photobooth',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f7f2e8',
        theme_color: '#17201e',
        icons: [{ src: './icon.png', type: 'image/png' }],
      }, null, 2);
      this.emitFile({ type: 'asset', fileName: 'icon.png', source: icon });
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest });

      const precache = [...new Set([...Object.keys(bundle), 'index.html', 'icon.png', 'manifest.webmanifest'])]
        .filter((name) => name !== 'sw.js' && !name.endsWith('.map'))
        .sort();
      const digest = createHash('sha256');
      for (const name of precache) {
        digest.update(name).update('\0');
        const output = bundle[name];
        if (output?.type === 'asset') digest.update(output.source);
        else if (output?.type === 'chunk') digest.update(output.code);
        else if (name === 'index.html') digest.update(transformedIndex);
        else if (name === 'icon.png') digest.update(icon);
        else if (name === 'manifest.webmanifest') digest.update(manifest);
      }
      const version = digest.digest('hex').slice(0, 16);
      const worker = [
        'const VERSION = ' + JSON.stringify(version) + ';',
        'const PREFIX = ' + JSON.stringify('photobooth-kiosk-') + ';',
        'const PRECACHE = ' + JSON.stringify(precache) + ';',
        'const scopeUrl = new URL(self.registration.scope);',
        'const scopedPrefix = PREFIX + encodeURIComponent(scopeUrl.pathname) + "-";',
        'const cacheName = scopedPrefix + VERSION;',
        'self.addEventListener("install", event => { event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(PRECACHE.map(path => new URL(path, scopeUrl).href)))); });',
        'self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(scopedPrefix) && key !== cacheName).map(key => caches.delete(key))))); });',
        'self.addEventListener("fetch", event => { const request = event.request; if (request.method !== "GET") return; const url = new URL(request.url); if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopeUrl.pathname)) return; event.respondWith(caches.open(cacheName).then(async cache => { if (request.mode === "navigate") return (await cache.match(new URL("index.html", scopeUrl).href)) || fetch(request); return (await cache.match(request)) || fetch(request); })); });',
      ].join('\n');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker });
    },
  };
}

const webEnv = {
  VITE_WEB: '1',
  VITE_TRIAL: '1',
  VITE_FAKE_API: '',
  VITE_SUPABASE_URL: '',
  VITE_SUPABASE_ANON_KEY: '',
  VITE_WEB_BASE_URL: '',
};

export default defineConfig({
  root: rendererRoot,
  envDir: false,
  // The browser build receives only the explicit constants above; ignore unrelated VITE_* values.
  envPrefix: 'WEB_ONLY_',
  base: './',
  plugins: [react(), offlineWebPlugin()],
  define: Object.fromEntries(Object.entries(webEnv).map(([key, value]) => ['import.meta.env.' + key, JSON.stringify(value)])),
  build: {
    target: 'safari16.4',
    outDir: webOutDir,
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: { index: resolve(rendererRoot, 'index.html') } },
  },
  server: { open: '/' },
  preview: { port: 4173, strictPort: true },
});
