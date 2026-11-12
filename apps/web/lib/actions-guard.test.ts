import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every admin server action must call requireAdmin() before touching its input or the database.
// Middleware cannot be the only guard: Next forwards an action id to its page from any route.

const calls = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(async () => {
    calls.order.push('requireAdmin');
    throw new Error('NEXT_REDIRECT /admin/login');
  }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => {
    calls.order.push('createClient');
    throw new Error('must not create a client');
  }),
}));

const { saveSettings } = await import('../app/admin/(panel)/settings/actions');
const { uploadTemplate, setActiveTemplate, archiveTemplate } = await import('../app/admin/(panel)/templates/actions');
const { markRefunded, undoRefund } = await import('../app/admin/(panel)/refund-actions');

function spyFormData(): FormData {
  const fd = new FormData();
  fd.set('price', '999');
  fd.set('name', 'x');
  fd.set('layout', 'strip_2x6');
  return new Proxy(fd, {
    get(target, prop) {
      if (prop === 'get' || prop === 'getAll' || prop === 'has') calls.order.push(`formData.${String(prop)}`);
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

const ID = '00000000-0000-0000-0000-0000000057a1';

describe('admin server actions check the admin role first', () => {
  beforeEach(() => {
    calls.order.length = 0;
  });

  it.each([
    ['saveSettings', () => saveSettings(spyFormData())],
    ['uploadTemplate', () => uploadTemplate(spyFormData())],
    ['setActiveTemplate', () => setActiveTemplate(ID)],
    ['archiveTemplate', () => archiveTemplate(ID)],
    ['markRefunded', () => markRefunded(ID)],
    ['undoRefund', () => undoRefund(ID)],
  ])('%s stops at requireAdmin for a non-admin', async (_name, run) => {
    await expect(run()).rejects.toThrow('NEXT_REDIRECT');
    expect(calls.order).toEqual(['requireAdmin']);
  });
});
