import { DEFAULT_SETTINGS } from '@pb/core';
import { describe, expect, it } from 'vitest';
import { isLocalConfig, MAX_OVERLAY_BYTES, validateConfigPatch, validateOverlayPng } from '../src/main/config-validation';
import { DEFAULT_LOCAL_CONFIG, toConfigView } from '../src/shared/bridge';

const TEMPLATE = { id: 'tpl-1', name: 'Strip', layout: 'strip_2x6', overlayPath: 'tpl-1.png' };

describe('validateConfigPatch', () => {
  it('accepts the renderer-writable keys', () => {
    const settings = { ...DEFAULT_SETTINGS, activeTemplateId: 'tpl-1' };
    expect(
      validateConfigPatch({ printerName: 'DNP', cameraDeviceId: 'cam-1', cachedSettings: settings, cachedTemplate: TEMPLATE }),
    ).toEqual({ printerName: 'DNP', cameraDeviceId: 'cam-1', cachedSettings: settings, cachedTemplate: TEMPLATE });
    expect(validateConfigPatch({ printerName: null, cameraDeviceId: null, cachedSettings: null, cachedTemplate: null })).toEqual({
      printerName: null,
      cameraDeviceId: null,
      cachedSettings: null,
      cachedTemplate: null,
    });
    expect(validateConfigPatch({})).toEqual({});
  });

  it('never writes pinHash or recoveredFromCorruption', () => {
    expect(validateConfigPatch({ pinHash: 'scrypt$evil$evil', printerName: 'P' })).toEqual({ printerName: 'P' });
    expect(validateConfigPatch({ recoveredFromCorruption: false })).toEqual({});
  });

  it('ignores unknown and prototype keys', () => {
    const patch = JSON.parse('{"__proto__":{"pinHash":"x"},"constructor":{"prototype":{}},"evil":1,"printerName":"P"}');
    const out = validateConfigPatch(patch);
    expect(out).toEqual({ printerName: 'P' });
    expect(Object.keys(out)).toEqual(['printerName']);
    expect(({} as Record<string, unknown>).pinHash).toBeUndefined();
  });

  it('rejects a non-object patch (a string would spread its characters as keys)', () => {
    for (const bad of ['printerName', null, undefined, 42, ['printerName'], true]) {
      expect(() => validateConfigPatch(bad)).toThrow('Invalid config');
    }
  });

  it('rejects wrong types', () => {
    expect(() => validateConfigPatch({ printerName: 5 })).toThrow();
    expect(() => validateConfigPatch({ cameraDeviceId: {} })).toThrow();
    expect(() => validateConfigPatch({ cachedSettings: { priceCentavos: 1 } })).toThrow();
    expect(() => validateConfigPatch({ cachedSettings: 'x' })).toThrow();
    expect(() => validateConfigPatch({ cachedTemplate: { ...TEMPLATE, layout: 'poster' } })).toThrow();
    expect(() => validateConfigPatch({ cachedTemplate: { ...TEMPLATE, id: 5 } })).toThrow();
    expect(() => validateConfigPatch({ cachedTemplate: { ...TEMPLATE, id: '../x' } })).toThrow();
    expect(() => validateConfigPatch({ cachedTemplate: 'tpl-1' })).toThrow();
    expect(() => validateConfigPatch({ printerName: undefined })).toThrow();
  });

  it('rejects oversize strings', () => {
    expect(validateConfigPatch({ printerName: 'p'.repeat(200) }).printerName).toHaveLength(200);
    expect(() => validateConfigPatch({ printerName: 'p'.repeat(201) })).toThrow();
    expect(validateConfigPatch({ cameraDeviceId: 'c'.repeat(500) }).cameraDeviceId).toHaveLength(500);
    expect(() => validateConfigPatch({ cameraDeviceId: 'c'.repeat(501) })).toThrow();
    expect(() => validateConfigPatch({ cachedTemplate: { ...TEMPLATE, name: 'n'.repeat(61) } })).toThrow();
    expect(() => validateConfigPatch({ cachedTemplate: { ...TEMPLATE, overlayPath: 'o'.repeat(201) } })).toThrow();
  });

  it('stores only the known fields of settings and template', () => {
    const out = validateConfigPatch({
      cachedSettings: { ...DEFAULT_SETTINGS, extra: 'x' },
      cachedTemplate: { ...TEMPLATE, extra: 'y' },
    });
    expect(out.cachedSettings).toEqual(DEFAULT_SETTINGS);
    expect(out.cachedTemplate).toEqual(TEMPLATE);
  });
});

describe('isLocalConfig', () => {
  it('accepts defaults and a full valid config', () => {
    expect(isLocalConfig(DEFAULT_LOCAL_CONFIG)).toBe(true);
    expect(
      isLocalConfig({
        ...DEFAULT_LOCAL_CONFIG,
        pinHash: 'scrypt$a$b',
        printerName: 'P',
        cachedSettings: DEFAULT_SETTINGS,
        cachedTemplate: TEMPLATE,
        recoveredFromCorruption: true,
      }),
    ).toBe(true);
  });

  it('rejects wrong shapes', () => {
    expect(isLocalConfig({ ...DEFAULT_LOCAL_CONFIG, pinHash: 5 })).toBe(false);
    expect(isLocalConfig({ ...DEFAULT_LOCAL_CONFIG, cachedSettings: { a: 1 } })).toBe(false);
    expect(isLocalConfig({ ...DEFAULT_LOCAL_CONFIG, recoveredFromCorruption: 'yes' })).toBe(false);
    expect(isLocalConfig([])).toBe(false);
    expect(isLocalConfig(null)).toBe(false);
  });
});

describe('validateOverlayPng', () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  it('accepts a PNG ArrayBuffer or Uint8Array', () => {
    expect(validateOverlayPng(new Uint8Array([...PNG, 1, 2]).buffer).byteLength).toBe(10);
    expect(validateOverlayPng(new Uint8Array([...PNG])).byteLength).toBe(8);
  });

  it('rejects non-buffers, empty, oversize and non-PNG data', () => {
    expect(() => validateOverlayPng('png')).toThrow();
    expect(() => validateOverlayPng(null)).toThrow();
    expect(() => validateOverlayPng(new ArrayBuffer(0))).toThrow();
    expect(() => validateOverlayPng(new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0]))).toThrow('not a PNG');
    const big = new Uint8Array(MAX_OVERLAY_BYTES + 1);
    big.set(PNG);
    expect(() => validateOverlayPng(big)).toThrow('too large');
    const max = new Uint8Array(MAX_OVERLAY_BYTES);
    max.set(PNG);
    expect(validateOverlayPng(max).byteLength).toBe(MAX_OVERLAY_BYTES);
  });
});

describe('toConfigView (what getConfig sends to the renderer)', () => {
  it('drops pinHash and reports only whether a PIN is set', () => {
    const view = toConfigView({ ...DEFAULT_LOCAL_CONFIG, pinHash: 'scrypt$salt$hash', printerName: 'P' });
    expect(view).toEqual({ ...DEFAULT_LOCAL_CONFIG, pinHash: undefined, printerName: 'P', pinSet: true });
    expect('pinHash' in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain('scrypt');
    expect(toConfigView(DEFAULT_LOCAL_CONFIG).pinSet).toBe(false);
  });
});
