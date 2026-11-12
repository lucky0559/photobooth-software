import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyTemplateWriteError } from './template-errors';

// The template actions check the active template themselves, but a stale tab or a concurrent request can
// still race them. The database triggers then reject the write; the action must show its fixed message
// and never echo the database error.

type Outcome = { data: unknown; error: { code?: string; message: string } | null };
const db = vi.hoisted(() => ({ results: {} as Record<string, unknown> }));

function builder(table: string) {
  let op = 'select';
  const b = {
    select: () => b,
    eq: () => b,
    update: () => {
      op = 'update';
      return b;
    },
    single: () => b,
    maybeSingle: () => b,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(db.results[`${table}.${op}`]).then(resolve, reject),
  };
  return b;
}

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(async () => ({ supabase: { from: (t: string) => builder(t) } })),
}));

const { setActiveTemplate, archiveTemplate } = await import('../app/admin/(panel)/templates/actions');

const ID = '00000000-0000-0000-0000-0000000057a1';
const OTHER = '00000000-0000-0000-0000-0000000057a2';
const set = (key: string, r: Outcome) => {
  db.results[key] = r;
};

describe('classifyTemplateWriteError', () => {
  it('recognises the trigger messages and a missing template', () => {
    expect(classifyTemplateWriteError({ code: '23514', message: 'active template cannot be archived' })).toBe('archiveActive');
    expect(classifyTemplateWriteError({ code: '23514', message: 'active template must not be archived' })).toBe('archivedOrMissing');
    expect(classifyTemplateWriteError({ code: '23503', message: 'insert or update on table "settings" violates foreign key' })).toBe(
      'archivedOrMissing',
    );
    expect(classifyTemplateWriteError({ code: '08006', message: 'connection failure' })).toBe('other');
    expect(classifyTemplateWriteError(null)).toBe('other');
  });
});

describe('template actions map database trigger errors to fixed messages', () => {
  beforeEach(() => {
    db.results = {};
  });

  it('archiveTemplate: the trigger rejects archiving the active template (stale settings read)', async () => {
    set('settings.select', { data: { active_template_id: OTHER }, error: null });
    set('templates.update', { data: null, error: { code: '23514', message: 'active template cannot be archived' } });
    const res = await archiveTemplate(ID);
    expect(res).toEqual({ ok: false, errors: { _: 'Choose another active template first' } });
  });

  it('archiveTemplate: any other database error is the generic save message', async () => {
    set('settings.select', { data: { active_template_id: OTHER }, error: null });
    set('templates.update', { data: null, error: { code: 'XX000', message: 'secret internal detail' } });
    const res = await archiveTemplate(ID);
    expect(res).toEqual({ ok: false, errors: { _: 'Could not save. Please try again.' } });
    expect(JSON.stringify(res)).not.toContain('secret');
  });

  it('archiveTemplate: the app-level check still refuses the active template', async () => {
    set('settings.select', { data: { active_template_id: ID }, error: null });
    const res = await archiveTemplate(ID);
    expect(res).toEqual({ ok: false, errors: { _: 'Choose another active template first' } });
  });

  it('setActiveTemplate: the trigger rejects an archived template (archived after the check)', async () => {
    set('templates.select', { data: { id: ID }, error: null });
    set('settings.update', { data: null, error: { code: '23514', message: 'active template must not be archived' } });
    const res = await setActiveTemplate(ID);
    expect(res).toEqual({ ok: false, errors: { _: 'Template not found' } });
  });

  it('setActiveTemplate: a template deleted after the check is "not found"', async () => {
    set('templates.select', { data: { id: ID }, error: null });
    set('settings.update', { data: null, error: { code: '23503', message: 'violates foreign key constraint "settings_active_template_id_fkey"' } });
    const res = await setActiveTemplate(ID);
    expect(res).toEqual({ ok: false, errors: { _: 'Template not found' } });
  });

  it('setActiveTemplate: other database errors are the generic save message', async () => {
    set('templates.select', { data: { id: ID }, error: null });
    set('settings.update', { data: null, error: { code: 'XX000', message: 'secret internal detail' } });
    const res = await setActiveTemplate(ID);
    expect(res).toEqual({ ok: false, errors: { _: 'Could not save. Please try again.' } });
  });

  it('setActiveTemplate: the app-level check still refuses an archived template', async () => {
    set('templates.select', { data: null, error: null });
    const res = await setActiveTemplate(ID);
    expect(res).toEqual({ ok: false, errors: { _: 'Template not found' } });
  });
});
