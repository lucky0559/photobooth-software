import { describe, it, expect } from 'vitest';
import { safeAdminPath } from './safe-next';

describe('safeAdminPath', () => {
  it('keeps internal admin paths', () => {
    expect(safeAdminPath('/admin')).toBe('/admin');
    expect(safeAdminPath('/admin/settings')).toBe('/admin/settings');
    expect(safeAdminPath('/admin/templates')).toBe('/admin/templates');
  });
  it('falls back to /admin for anything else', () => {
    for (const bad of [
      undefined,
      null,
      42,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/admin//evil.example',
      '/admin\\evil',
      '/adminevil',
      '/settings',
      '/admin/login',
      '/admin/settings?x=https://evil',
      '/admin/%2F%2Fevil',
      `/admin/${'a'.repeat(300)}`,
    ]) {
      expect(safeAdminPath(bad)).toBe('/admin');
    }
  });
});
