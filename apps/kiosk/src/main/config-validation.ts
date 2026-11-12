import { validateSettings, type KioskSettings, type Template } from '@pb/core';
import { TEMPLATE_ID_PATTERN, type ConfigPatch, type LocalConfig } from '../shared/bridge';

export const MAX_PRINTER_NAME_CHARS = 200;
export const MAX_CAMERA_ID_CHARS = 500;
export const MAX_TEMPLATE_NAME_CHARS = 60;
export const MAX_OVERLAY_PATH_CHARS = 200;
/** Same cap as the web upload (`TEMPLATE_MAX_BYTES`). */
export const MAX_OVERLAY_BYTES = 10 * 1024 * 1024;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

function fail(what: string): never {
  throw new Error(`Invalid config ${what}`);
}

function nullableString(v: unknown, max: number, what: string): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || v.length > max) fail(what);
  return v;
}

function settingsOrNull(v: unknown): KioskSettings | null {
  if (v === null) return null;
  const r = validateSettings(v);
  if (!r.ok) fail('settings');
  const s = r.value;
  // Copy only the known fields so nothing extra is ever persisted.
  return {
    priceCentavos: s.priceCentavos,
    freeMode: s.freeMode,
    shotsPerSession: s.shotsPerSession,
    countdownSeconds: s.countdownSeconds,
    copiesPerSession: s.copiesPerSession,
    linkExpiryDays: s.linkExpiryDays,
    activeTemplateId: s.activeTemplateId,
  };
}

function templateOrNull(v: unknown): Template | null {
  if (v === null) return null;
  if (!isObject(v)) fail('template');
  const { id, name, layout, overlayPath } = v;
  if (typeof id !== 'string' || !TEMPLATE_ID_PATTERN.test(id)) fail('template id');
  if (typeof name !== 'string' || name.length > MAX_TEMPLATE_NAME_CHARS) fail('template name');
  if (layout !== 'strip_2x6' && layout !== 'print_4r') fail('template layout');
  if (typeof overlayPath !== 'string' || overlayPath.length > MAX_OVERLAY_PATH_CHARS) fail('template overlay');
  return { id, name, layout, overlayPath };
}

/**
 * Validates an untrusted `setConfig` patch. Only `printerName`, `cameraDeviceId`, `cachedSettings` and
 * `cachedTemplate` are writable from the renderer; any other key (including `pinHash`) is ignored.
 * Throws on a non-object patch or an invalid value for a writable key.
 */
export function validateConfigPatch(patch: unknown): ConfigPatch {
  if (!isObject(patch)) fail('patch');
  const out: ConfigPatch = {};
  if (has(patch, 'printerName')) out.printerName = nullableString(patch.printerName, MAX_PRINTER_NAME_CHARS, 'printer');
  if (has(patch, 'cameraDeviceId')) out.cameraDeviceId = nullableString(patch.cameraDeviceId, MAX_CAMERA_ID_CHARS, 'camera');
  if (has(patch, 'cachedSettings')) out.cachedSettings = settingsOrNull(patch.cachedSettings);
  if (has(patch, 'cachedTemplate')) out.cachedTemplate = templateOrNull(patch.cachedTemplate);
  return out;
}

/** Shape check for `config.json` on load (after defaults are merged in). */
export function isLocalConfig(v: unknown): v is LocalConfig {
  if (!isObject(v)) return false;
  try {
    nullableString(v.pinHash, 1000, 'pin');
    validateConfigPatch({
      printerName: v.printerName,
      cameraDeviceId: v.cameraDeviceId,
      cachedSettings: v.cachedSettings,
      cachedTemplate: v.cachedTemplate,
    });
  } catch {
    return false;
  }
  return typeof v.recoveredFromCorruption === 'boolean';
}

/** Untrusted `saveOverlay` input must be a non-empty PNG ArrayBuffer/Uint8Array of at most 10 MB. */
export function validateOverlayPng(png: unknown): Buffer {
  let bytes: Uint8Array;
  if (png instanceof ArrayBuffer) bytes = new Uint8Array(png);
  else if (png instanceof Uint8Array) bytes = png;
  else throw new Error('overlay must be an ArrayBuffer');
  if (bytes.byteLength === 0) throw new Error('overlay is empty');
  if (bytes.byteLength > MAX_OVERLAY_BYTES) throw new Error('overlay is too large (max 10 MB)');
  if (bytes.byteLength < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
    throw new Error('overlay is not a PNG image');
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
