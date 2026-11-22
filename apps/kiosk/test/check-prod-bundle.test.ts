import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkPackageableBundle, findTestHooks } from '../scripts/check-prod-bundle.mjs';

describe('findTestHooks (production bundle guard)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pb-bundle-'));
    mkdirSync(join(dir, 'main'));
    mkdirSync(join(dir, 'renderer', 'assets'), { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('passes a clean bundle', () => {
    writeFileSync(join(dir, 'main', 'index.js'), 'console.log("kiosk")');
    writeFileSync(join(dir, 'renderer', 'assets', 'font.woff2'), 'PB_FAKE in a binary is ignored');
    expect(findTestHooks(dir)).toEqual([]);
  });

  it('checkPackageableBundle: accepts a complete clean bundle', () => {
    writeFileSync(join(dir, 'main', 'index.js'), 'console.log("kiosk")');
    mkdirSync(join(dir, 'preload'));
    writeFileSync(join(dir, 'preload', 'index.js'), '');
    writeFileSync(join(dir, 'renderer', 'index.html'), '<html></html>');
    expect(checkPackageableBundle(dir)).toEqual([]);
  });

  it('checkPackageableBundle: refuses a missing out/ dir, missing entry files, source maps and test hooks', () => {
    expect(checkPackageableBundle(join(dir, 'nope'))).toEqual([
      `${join(dir, 'nope')} is missing: run \`pnpm build\` (the production build) first`,
    ]);
    writeFileSync(join(dir, 'main', 'index.js'), 'window.__pbDebug = 1');
    writeFileSync(join(dir, 'main', 'index.js.map'), '{}');
    expect(checkPackageableBundle(dir)).toEqual([
      'missing preload/index.js',
      'missing renderer/index.html',
      `source map ${join('main', 'index.js.map')}`,
      `test-only hook ${join('main', 'index.js')}: __pbDebug`,
    ]);
  });

  it('checkPackageableBundle: reports a test-only hook and a missing renderer/index.html', () => {
    writeFileSync(join(dir, 'main', 'index.js'), 'ok');
    mkdirSync(join(dir, 'preload'));
    writeFileSync(join(dir, 'preload', 'index.js'), '');
    writeFileSync(join(dir, 'renderer', 'assets', 'a.js'), 'window.__pbFake = 1');
    const problems = checkPackageableBundle(dir);
    expect(problems).toContain('missing renderer/index.html');
    expect(problems).toContain(`test-only hook ${join('renderer', 'assets', 'a.js')}: __pbFake`);
  });

  it('flags every test-only marker', () => {
    writeFileSync(join(dir, 'main', 'index.js'), 'process.env.PB_FAKE_PRINT');
    writeFileSync(join(dir, 'renderer', 'assets', 'index.js'), 'window.__pbDebug = {}; window.__pbFake;');
    expect(findTestHooks(dir).sort()).toEqual([
      join('main', 'index.js') + ': PB_FAKE',
      join('renderer', 'assets', 'index.js') + ': __pbDebug',
      join('renderer', 'assets', 'index.js') + ': __pbFake',
    ]);
  });
});
