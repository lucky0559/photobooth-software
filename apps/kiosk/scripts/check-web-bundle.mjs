import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../dist-web', import.meta.url)));
const files = walk(root);
const names = files.map((file) => relative(root, file).split(String.fromCharCode(92)).join('/'));
const textExtensions = ['.html', '.js', '.css', '.webmanifest', '.svg'];
const textFiles = files.filter((file) => textExtensions.some((extension) => file.endsWith(extension)));
const bundle = textFiles.map((file) => readFileSync(file, 'utf8')).join('\n');
const fail = (message) => {
  throw new Error('Web bundle guard: ' + message);
};

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

for (const required of ['index.html', 'manifest.webmanifest', 'sw.js', 'icon.png']) {
  if (!names.includes(required)) fail('missing ' + required);
}
if (!names.some((name) => name.startsWith('assets/'))) fail('no emitted app assets');
if (names.some((name) => name.endsWith('.map'))) fail('source maps must not ship');
if (!bundle.includes("default-src 'self'") || !bundle.includes("script-src 'self'")) fail('production content security policy is missing');
if (!bundle.includes('DEMO%20PAYMENT') && !bundle.includes('DEMO PAYMENT')) fail('demo payment marker is missing');
if (!bundle.includes('Trial demo QR')) fail('trial delivery marker is missing');

const forbidden = [
  [/supabase\.co|paymongo/i, 'backend host'],
  [/__pbFake|__pbDebug|__pbPrintCalls|createClient/i, 'test hook or Supabase client'],
  [/ipcRenderer|electron-vite|from ['"]electron['"]/i, 'Electron code'],
  [/eyJhbGciOi|sb_secret_|sk_live_|sk_test_|pk_live_|pk_test_/i, 'opaque key material'],
];
for (const [pattern, label] of forbidden) {
  if (pattern.test(bundle)) fail('contains a ' + label);
}

const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.webmanifest'), 'utf8'));
if (manifest.start_url !== './' || manifest.scope !== './' || manifest.display !== 'standalone') {
  fail('manifest must use a relative standalone scope');
}
if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) fail('manifest icon is missing');

const worker = readFileSync(resolve(root, 'sw.js'), 'utf8');
const precacheMatch = /const PRECACHE = (\[[^;]+\]);/.exec(worker);
if (!precacheMatch || !JSON.parse(precacheMatch[1]).includes('index.html') || !worker.includes('cache.addAll')) {
  fail('offline app shell and assets must be precached');
}
if (!worker.includes('request.mode === "navigate"') || !worker.includes('cache.match(new URL("index.html", scopeUrl).href)')) {
  fail('offline navigation must fall back to the cached app shell');
}
if (worker.includes('skipWaiting')) fail('new workers must wait for open kiosk tabs to close');
console.log('Web bundle guard passed: isolated demo build, relative manifest, CSP, and offline shell verified.');
