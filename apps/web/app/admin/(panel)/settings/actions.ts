'use server';

import { revalidatePath } from 'next/cache';
import { pesosToCentavos, validateSettings, type KioskSettings, type Result } from '@pb/core';
import { requireAdmin } from '@/lib/auth';
import { SETTINGS_COLUMNS, settingsFromRow, settingsToRow, type SettingsRow } from '@/lib/settings-row';

const SAVE_FAILED = 'Could not save settings. Please try again.';

/** Whole number from a form field, or NaN (so core validation reports it). */
function intField(formData: FormData, key: string): number {
  const v = formData.get(key);
  return typeof v === 'string' && /^\d{1,6}$/.test(v.trim()) ? Number(v.trim()) : NaN;
}

export async function saveSettings(formData: FormData): Promise<Result<KioskSettings>> {
  const { supabase } = await requireAdmin();

  const priceText = formData.get('price');
  const price = typeof priceText === 'string' && priceText.length <= 20 ? pesosToCentavos(priceText) : null;

  const { data: current, error: readError } = await supabase
    .from('settings')
    .select(SETTINGS_COLUMNS)
    .eq('id', 1)
    .single<SettingsRow>();
  if (readError || !current) return { ok: false, errors: { _: SAVE_FAILED } };

  const checked = validateSettings({
    priceCentavos: price ?? NaN, // unparseable text gets core's price message
    freeMode: formData.get('freeMode') === 'on',
    shotsPerSession: intField(formData, 'shotsPerSession'),
    countdownSeconds: intField(formData, 'countdownSeconds'),
    copiesPerSession: intField(formData, 'copiesPerSession'),
    linkExpiryDays: intField(formData, 'linkExpiryDays'),
    // Not edited here; templates page owns it.
    activeTemplateId: current.active_template_id,
  });
  if (!checked.ok) return checked;

  // The active template is set from the templates page; never write it from this form.
  const { active_template_id: _keep, ...columns } = settingsToRow(checked.value);
  const { data, error } = await supabase
    .from('settings')
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select(SETTINGS_COLUMNS)
    .single<SettingsRow>();
  if (error || !data) return { ok: false, errors: { _: SAVE_FAILED } };

  revalidatePath('/admin/settings');
  return { ok: true, value: settingsFromRow(data) };
}
