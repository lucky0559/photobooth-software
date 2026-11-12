import { describe, expect, it } from 'vitest';
import { isAllowedNavigation, isAllowedPermission } from '../src/main/security';

const indexFileUrl = 'file:///Applications/Kiosk.app/Contents/Resources/app/out/renderer/index.html';
const devUrl = 'http://localhost:5173/';
const dev = { packaged: false, devUrl, indexFileUrl };
const prod = { packaged: true, devUrl: undefined, indexFileUrl };

describe('isAllowedNavigation', () => {
  it('allows the app index file (with or without hash/query)', () => {
    expect(isAllowedNavigation(indexFileUrl, prod)).toBe(true);
    expect(isAllowedNavigation(`${indexFileUrl}#/setup`, prod)).toBe(true);
    expect(isAllowedNavigation(`${indexFileUrl}?x=1`, prod)).toBe(true);
  });

  it('blocks external https URLs', () => {
    expect(isAllowedNavigation('https://example.com/', prod)).toBe(false);
    expect(isAllowedNavigation('https://example.com/', dev)).toBe(false);
  });

  it('blocks other file:// paths', () => {
    expect(isAllowedNavigation('file:///etc/passwd', prod)).toBe(false);
    expect(isAllowedNavigation('file:///Applications/Kiosk.app/Contents/Resources/app/out/renderer/other.html', prod)).toBe(
      false,
    );
    expect(isAllowedNavigation('file:///Applications/Kiosk.app/Contents/Resources/app/out/renderer/index.html/..', prod)).toBe(
      false,
    );
  });

  it('blocks javascript:, data: and garbage', () => {
    expect(isAllowedNavigation('javascript:alert(1)', prod)).toBe(false);
    expect(isAllowedNavigation('data:text/html,<p>x</p>', prod)).toBe(false);
    expect(isAllowedNavigation('not a url', prod)).toBe(false);
  });

  it('allows the dev server only when not packaged', () => {
    expect(isAllowedNavigation(devUrl, dev)).toBe(true);
    expect(isAllowedNavigation('http://localhost:5173/index.html#x', dev)).toBe(true);
    expect(isAllowedNavigation('http://localhost:5174/', dev)).toBe(false);
    expect(isAllowedNavigation(devUrl, { ...dev, packaged: true })).toBe(false);
    expect(isAllowedNavigation(devUrl, prod)).toBe(false);
  });
});

describe('isAllowedPermission', () => {
  it('allows only media (camera)', () => {
    expect(isAllowedPermission('media')).toBe(true);
    for (const p of ['geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal', 'fullscreen', 'unknown']) {
      expect(isAllowedPermission(p)).toBe(false);
    }
  });
});
