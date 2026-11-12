import { describe, expect, it } from 'vitest';
import { checkEnv } from '../src/renderer/src/env-check';

const GOOD = {
  VITE_SUPABASE_URL: 'https://abc.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  VITE_WEB_BASE_URL: 'https://booth.example.com',
};

describe('checkEnv', () => {
  it('is ok with everything set', () => {
    expect(checkEnv(GOOD)).toEqual({ ok: true, warnings: [] });
  });

  it('lists missing Supabase variable names (never values)', () => {
    const r = checkEnv({ VITE_WEB_BASE_URL: GOOD.VITE_WEB_BASE_URL });
    expect(r).toEqual({ ok: false, missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'], warnings: [] });
    expect(checkEnv({ ...GOOD, VITE_SUPABASE_ANON_KEY: '  ' })).toMatchObject({ ok: false, missing: ['VITE_SUPABASE_ANON_KEY'] });
  });

  it('treats a non-http(s) Supabase URL as missing', () => {
    expect(checkEnv({ ...GOOD, VITE_SUPABASE_URL: 'abc.supabase.co' })).toMatchObject({ ok: false, missing: ['VITE_SUPABASE_URL'] });
  });

  it('only warns about a missing or relative web base URL', () => {
    expect(checkEnv({ ...GOOD, VITE_WEB_BASE_URL: undefined })).toEqual({ ok: true, warnings: ['VITE_WEB_BASE_URL'] });
    expect(checkEnv({ ...GOOD, VITE_WEB_BASE_URL: '/d' })).toEqual({ ok: true, warnings: ['VITE_WEB_BASE_URL'] });
    expect(checkEnv({})).toEqual({
      ok: false,
      missing: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
      warnings: ['VITE_WEB_BASE_URL'],
    });
  });

  it('needs no Supabase variables for the fake-API (e2e) build', () => {
    expect(checkEnv({ VITE_FAKE_API: '1', VITE_WEB_BASE_URL: 'http://localhost:3000' })).toEqual({ ok: true, warnings: [] });
  });
});
