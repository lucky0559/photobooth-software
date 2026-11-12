import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findTestHooks } from '../scripts/check-prod-bundle.mjs';

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
