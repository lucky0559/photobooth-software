import type { KioskSettings, LayoutId, SessionSync, Template } from '@pb/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NOT_KIOSK_ACCOUNT, type KioskApi, type PaymentStatus } from './kiosk-api';

interface SettingsRow {
  price_centavos: number;
  free_mode: boolean;
  shots_per_session: KioskSettings['shotsPerSession'];
  countdown_seconds: KioskSettings['countdownSeconds'];
  copies_per_session: KioskSettings['copiesPerSession'];
  link_expiry_days: number;
  active_template_id: string | null;
}

interface TemplateRow {
  id: string;
  name: string;
  layout: LayoutId;
  overlay_path: string;
}

/** Thin adapter over the kiosk user's Supabase session (tables, buckets and Edge Functions from Tasks 4–5). */
export class SupabaseKioskApi implements KioskApi {
  constructor(private readonly db: SupabaseClient) {}

  /**
   * Signs in and requires the account's own profile row (RLS lets a user read it) to say `kiosk`. Anything else (an
   * admin account, no profile, or the profile cannot be read) signs out locally again, so the kiosk never runs on an
   * account whose every write would be refused.
   */
  async signIn(email: string, password: string): Promise<void> {
    const { data, error } = await this.db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const userId = data.user?.id;
    const profile = userId
      ? await this.db.from('profiles').select('role').eq('user_id', userId).maybeSingle<{ role: string }>()
      : { data: null, error: null };
    if (profile.error || profile.data?.role !== 'kiosk') {
      await this.db.auth.signOut({ scope: 'local' }).catch(() => undefined);
      if (profile.error) throw profile.error;
      throw new Error(NOT_KIOSK_ACCOUNT);
    }
  }

  async signOut(): Promise<void> {
    const { error } = await this.db.auth.signOut({ scope: 'local' });
    if (error) throw error;
  }

  async isSignedIn(): Promise<boolean> {
    const { data } = await this.db.auth.getSession();
    return data.session !== null;
  }

  async getSettings(): Promise<KioskSettings> {
    const { data, error } = await this.db
      .from('settings')
      .select('price_centavos, free_mode, shots_per_session, countdown_seconds, copies_per_session, link_expiry_days, active_template_id')
      .eq('id', 1)
      .single<SettingsRow>();
    if (error) throw error;
    return {
      priceCentavos: data.price_centavos,
      freeMode: data.free_mode,
      shotsPerSession: data.shots_per_session,
      countdownSeconds: data.countdown_seconds,
      copiesPerSession: data.copies_per_session,
      linkExpiryDays: data.link_expiry_days,
      activeTemplateId: data.active_template_id,
    };
  }

  async getTemplate(id: string): Promise<{ template: Template; overlayPng: ArrayBuffer }> {
    const { data, error } = await this.db
      .from('templates')
      .select('id, name, layout, overlay_path')
      .eq('id', id)
      .single<TemplateRow>();
    if (error) throw error;
    const file = await this.db.storage.from('templates').download(data.overlay_path);
    if (file.error) throw file.error;
    return {
      template: { id: data.id, name: data.name, layout: data.layout, overlayPath: data.overlay_path },
      overlayPng: await file.data.arrayBuffer(),
    };
  }

  async createPayment(i: {
    sessionId: string;
    downloadToken: string;
    templateId: string;
  }): Promise<{ paymentId: string; qrImageDataUrl: string; amountCentavos: number }> {
    const { data, error } = await this.db.functions.invoke<{
      paymentId: string;
      qrImageDataUrl: string;
      amountCentavos: number;
    }>('create-payment', { body: i });
    if (error) throw error;
    if (!data) throw new Error('create-payment returned no data');
    // The QR goes straight into an <img src>: accept only an inline image.
    if (typeof data.qrImageDataUrl !== 'string' || !data.qrImageDataUrl.startsWith('data:image/')) {
      throw new Error('create-payment returned an invalid QR image');
    }
    return data;
  }

  async getPaymentStatus(paymentId: string): Promise<PaymentStatus> {
    const { data, error } = await this.db
      .from('payments')
      .select('status')
      .eq('id', paymentId)
      .single<{ status: PaymentStatus }>();
    if (error) throw error;
    return data.status;
  }

  async cancelPayment(paymentId: string): Promise<'cancelled' | 'paid'> {
    const { data, error } = await this.db.functions.invoke<{ status: 'cancelled' | 'paid' }>('cancel-payment', {
      body: { paymentId },
    });
    if (error) throw error;
    if (!data) throw new Error('cancel-payment returned no data');
    return data.status;
  }

  async upsertSession(row: SessionSync): Promise<void> {
    const { error } = await this.db.from('sessions').upsert({
      id: row.id,
      template_id: row.templateId,
      download_token: row.downloadToken,
      amount_centavos: row.amountCentavos,
      status: row.status,
      print_error: row.printError,
      created_at: row.createdAt,
      completed_at: row.completedAt,
    });
    if (error) throw error;
  }

  async uploadPhoto(sessionId: string, jpeg: ArrayBuffer): Promise<string> {
    const path = `${sessionId}.jpg`;
    const up = await this.db.storage.from('photos').upload(path, jpeg, { contentType: 'image/jpeg', upsert: true });
    if (up.error) throw up.error;
    const { error } = await this.db.from('sessions').update({ photo_path: path }).eq('id', sessionId);
    if (error) throw error;
    return path;
  }
}
