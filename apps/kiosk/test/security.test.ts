import { describe, expect, it } from 'vitest';
import {
  createNavigationGuard,
  isAllowedNavigation,
  isAllowedPermissionCheck,
  isAllowedPermissionRequest,
} from '../src/main/security';

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

describe('createNavigationGuard (every webContents, every frame)', () => {
  const guard = createNavigationGuard(prod);
  const event = (url?: string) => ({ url, prevented: false, preventDefault() { this.prevented = true; } });

  it('blocks a disallowed URL given on the event (will-frame-navigate) or as an argument (will-navigate)', () => {
    const a = event('https://example.com/');
    guard(a);
    expect(a.prevented).toBe(true);
    const b = event();
    guard(b, 'file:///tmp/pb-print-x.html');
    expect(b.prevented).toBe(true);
  });

  it('lets the app page through', () => {
    const a = event(`${indexFileUrl}#x`);
    guard(a);
    expect(a.prevented).toBe(false);
    const b = event();
    guard(b, indexFileUrl);
    expect(b.prevented).toBe(false);
  });

  it('blocks when no URL can be determined', () => {
    const a = event();
    guard(a);
    expect(a.prevented).toBe(true);
  });
});

describe('permissions: camera only', () => {
  it('grants a media request only for video', () => {
    expect(isAllowedPermissionRequest('media', ['video'])).toBe(true);
    expect(isAllowedPermissionRequest('media', ['audio'])).toBe(false);
    expect(isAllowedPermissionRequest('media', ['video', 'audio'])).toBe(false);
    expect(isAllowedPermissionRequest('media', [])).toBe(false);
    expect(isAllowedPermissionRequest('media', undefined)).toBe(false);
  });

  it('passes a media check only for video', () => {
    expect(isAllowedPermissionCheck('media', 'video')).toBe(true);
    expect(isAllowedPermissionCheck('media', 'audio')).toBe(false);
    expect(isAllowedPermissionCheck('media', 'unknown')).toBe(false);
    expect(isAllowedPermissionCheck('media', undefined)).toBe(false);
  });

  it('denies every other permission', () => {
    for (const p of ['geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal', 'fullscreen', 'unknown']) {
      expect(isAllowedPermissionRequest(p, ['video'])).toBe(false);
      expect(isAllowedPermissionCheck(p, 'video')).toBe(false);
    }
  });
});
