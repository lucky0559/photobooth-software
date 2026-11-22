'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { imageSize } from 'image-size';
import { TEMPLATE_MAX_BYTES, validateTemplateImage, type LayoutId, type Result, type Template } from '@pb/core';
import { requireAdmin } from '@/lib/auth';
import { hasPngSignature, pngHasTransparency } from '@/lib/png';
import { classifyTemplateWriteError } from '@/lib/template-errors';

const BUCKET = 'templates';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LAYOUTS: readonly LayoutId[] = ['strip_2x6', 'print_4r'];

const MSG = {
  name: 'Name must be 1 to 60 characters',
  layout: 'Choose a layout',
  file: 'Choose a PNG file',
  mime: 'Template must be a PNG with transparent photo areas',
  bytes: 'Template must be 10 MB or smaller',
  uploadFailed: 'Could not upload the template. Please try again.',
  notFound: 'Template not found',
  saveFailed: 'Could not save. Please try again.',
  archiveActive: 'Choose another active template first',
} as const;

type TemplateRow = { id: string; name: string; layout: LayoutId; overlay_path: string };

export async function uploadTemplate(formData: FormData): Promise<Result<Template>> {
  const { supabase } = await requireAdmin();
  const errors: Record<string, string> = {};

  const rawName = formData.get('name');
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (name.length < 1 || name.length > 60) errors.name = MSG.name;

  const rawLayout = formData.get('layout');
  const layout = LAYOUTS.find((l) => l === rawLayout);
  if (!layout) errors.layout = MSG.layout;

  const file = formData.get('file');
  let bytes: Buffer | null = null;
  if (!(file instanceof File) || file.size === 0) {
    errors.file = MSG.file;
  } else if (file.size > TEMPLATE_MAX_BYTES) {
    errors.bytes = MSG.bytes; // don't read an oversized body
  } else {
    bytes = Buffer.from(await file.arrayBuffer());
  }

  if (bytes) {
    // Trust only the bytes: magic number first, then the IHDR dimensions.
    let meta: { width: number; height: number; mime: string } = { width: 0, height: 0, mime: 'application/octet-stream' };
    // An opaque PNG (no alpha channel, no tRNS) would hide the photos: treat it as "not a usable PNG".
    if (hasPngSignature(bytes) && pngHasTransparency(bytes)) {
      try {
        const dims = imageSize(bytes);
        if (dims.type === 'png') meta = { width: dims.width, height: dims.height, mime: 'image/png' };
      } catch {
        // Corrupt PNG: reported as not a PNG below.
      }
    }
    if (meta.mime !== 'image/png') {
      errors.mime = MSG.mime; // dimensions of a non-PNG are meaningless; report only the type
    } else if (layout) {
      const checked = validateTemplateImage({ ...meta, bytes: bytes.length }, layout);
      if (!checked.ok) Object.assign(errors, checked.errors);
    }
  }

  if (Object.keys(errors).length > 0 || !bytes || !layout) return { ok: false, errors };

  // Server-generated object name; the client's filename is never used.
  const objectName = `${randomUUID()}.png`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(objectName, bytes, { contentType: 'image/png', upsert: false });
  if (uploadError) return { ok: false, errors: { _: MSG.uploadFailed } };

  const { data, error } = await supabase
    .from('templates')
    .insert({ name, layout, overlay_path: objectName })
    .select('id, name, layout, overlay_path')
    .single<TemplateRow>();
  if (error || !data) {
    await supabase.storage.from(BUCKET).remove([objectName]).catch(() => undefined); // best effort
    return { ok: false, errors: { _: MSG.uploadFailed } };
  }

  revalidatePath('/admin/templates');
  return { ok: true, value: { id: data.id, name: data.name, layout: data.layout, overlayPath: data.overlay_path } };
}

export async function setActiveTemplate(id: string): Promise<Result<true>> {
  const { supabase } = await requireAdmin();
  if (typeof id !== 'string' || !UUID_RE.test(id)) return { ok: false, errors: { _: MSG.notFound } };

  const { data: template, error: readError } = await supabase
    .from('templates')
    .select('id')
    .eq('id', id)
    .eq('archived', false)
    .maybeSingle();
  if (readError) return { ok: false, errors: { _: MSG.saveFailed } };
  if (!template) return { ok: false, errors: { _: MSG.notFound } };

  const { data, error } = await supabase
    .from('settings')
    .update({ active_template_id: id, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('id');
  // The template may have been archived (or removed) after the check above: the database refuses it.
  if (error && classifyTemplateWriteError(error) === 'archivedOrMissing') return { ok: false, errors: { _: MSG.notFound } };
  if (error || !data || data.length !== 1) return { ok: false, errors: { _: MSG.saveFailed } };

  revalidatePath('/admin/templates');
  return { ok: true, value: true };
}

export async function archiveTemplate(id: string): Promise<Result<true>> {
  const { supabase } = await requireAdmin();
  if (typeof id !== 'string' || !UUID_RE.test(id)) return { ok: false, errors: { _: MSG.notFound } };

  const { data: settings, error: settingsError } = await supabase
    .from('settings')
    .select('active_template_id')
    .eq('id', 1)
    .single<{ active_template_id: string | null }>();
  if (settingsError || !settings) return { ok: false, errors: { _: MSG.saveFailed } };
  if (settings.active_template_id === id) return { ok: false, errors: { _: MSG.archiveActive } };

  const { data, error } = await supabase
    .from('templates')
    .update({ archived: true })
    .eq('id', id)
    .eq('archived', false)
    .select('id');
  // It may have become active after the check above (stale tab, concurrent request): the database refuses it.
  if (error && classifyTemplateWriteError(error) === 'archiveActive') return { ok: false, errors: { _: MSG.archiveActive } };
  if (error) return { ok: false, errors: { _: MSG.saveFailed } };
  if (!data || data.length !== 1) return { ok: false, errors: { _: MSG.notFound } };

  revalidatePath('/admin/templates');
  return { ok: true, value: true };
}
