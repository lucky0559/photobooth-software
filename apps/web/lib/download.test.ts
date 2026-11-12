import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  created: 0,
  eqCalls: [] as [string, string, unknown][],
  session: null as null | { id: string; created_at: string; photo_path: string | null },
  signError: false,
  signCalls: [] as { object: string; seconds: number; opts?: { download?: string } }[],
}));

vi.mock('server-only', () => ({}));
vi.mock('./supabase/admin', () => ({
  createAdminClient: vi.fn(() => {
    db.created += 1;
    return {
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, val: unknown) => {
            db.eqCalls.push([table, col, val]);
            return {
              maybeSingle: async () => ({ data: db.session, error: null }),
              single: async () => ({ data: { link_expiry_days: 7 }, error: null }),
            };
          },
        }),
      }),
      storage: {
        from: () => ({
          createSignedUrl: async (object: string, seconds: number, opts?: { download?: string }) => {
            db.signCalls.push({ object, seconds, opts });
            return db.signError
              ? { data: null, error: new Error('Object not found') }
              : { data: { signedUrl: `https://sb.test/sign/photos/${object}?d=${opts?.download ?? ''}` }, error: null };
          },
        }),
      },
    };
  }),
}));

const { loadDownload } = await import('./download');

const ID = '3f0c4b1e-8a2d-4c6e-9b1a-2d3e4f5a6b7c';
const TOKEN = 'AbCdEfGhIjKlMnOpQrSt_-';
const NOW = new Date('2026-11-12T04:00:00Z');

describe('loadDownload', () => {
  beforeEach(() => {
    db.created = 0;
    db.eqCalls.length = 0;
    db.signCalls.length = 0;
    db.session = { id: ID, created_at: '2026-11-11T16:30:00+00:00', photo_path: 'evil/../other.jpg' };
    db.signError = false;
  });

  it.each(['abc', 'A'.repeat(21), 'A'.repeat(23), 'A'.repeat(40), '../etc/passwd/xxxxxxxxx', 'ÄbCdEfGhIjKlMnOpQrSt_-', 'AbCdEfGhIjKlMnOpQrSt.-', ''])(
    'rejects malformed token %j without touching the database',
    async (token) => {
      await expect(loadDownload(token, NOW)).resolves.toEqual({ state: 'not_found' });
      expect(db.created).toBe(0);
    },
  );

  it('looks the session up by exact token and signs <id>.jpg, not photo_path', async () => {
    const view = await loadDownload(TOKEN, NOW);
    expect(db.eqCalls).toContainEqual(['sessions', 'download_token', TOKEN]);
    expect(view.state).toBe('ready');
    expect(db.signCalls.map((c) => c.object)).toEqual([`${ID}.jpg`, `${ID}.jpg`]);
    expect(db.signCalls.every((c) => c.seconds === 3600)).toBe(true);
    // Manila date of created_at (16:30 UTC on Nov 11 is Nov 12 in Manila).
    expect(db.signCalls[1].opts).toEqual({ download: 'photobooth-2026-11-12.jpg' });
  });

  it('unknown token is not_found', async () => {
    db.session = null;
    await expect(loadDownload(TOKEN, NOW)).resolves.toEqual({ state: 'not_found' });
    expect(db.signCalls).toHaveLength(0);
  });

  it('missing photo object falls back to uploading', async () => {
    db.signError = true;
    await expect(loadDownload(TOKEN, NOW)).resolves.toEqual({ state: 'uploading' });
  });

  it('no photo_path is uploading; old session is expired, without signing', async () => {
    db.session = { id: ID, created_at: '2026-11-11T16:30:00Z', photo_path: null };
    await expect(loadDownload(TOKEN, NOW)).resolves.toEqual({ state: 'uploading' });
    db.session = { id: ID, created_at: '2026-11-01T00:00:00Z', photo_path: `${ID}.jpg` };
    await expect(loadDownload(TOKEN, NOW)).resolves.toEqual({ state: 'expired' });
    expect(db.signCalls).toHaveLength(0);
  });
});
