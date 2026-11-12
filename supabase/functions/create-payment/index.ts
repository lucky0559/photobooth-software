// POST /functions/v1/create-payment  (kiosk JWT)
// body { sessionId, downloadToken, templateId } → 200 { paymentId, qrImageDataUrl, amountCentavos }
//                                               → 409 { error: 'free_mode' } when free mode is on
//
// Order: authenticate → validate → (retry? return the stored QR) → amount from SERVER settings → PayMongo
// (intent → method → attach) → one DB transaction (session + payment). If the DB step fails after PayMongo succeeded,
// the answer is 500 and the unused intent simply expires.
//
// Retries: a second call for a session this kiosk already created a payment for returns the stored payment and QR
// (payments.qr_image) without calling PayMongo again. Two concurrent first calls can both reach PayMongo; the loser's
// insert hits the primary key and it returns the winner's payment (its own intent is never shown and expires).
import { type KioskSettings, sessionAmountCentavos, validateSettings } from '@pb/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DOWNLOAD_TOKEN_RE, handle, HttpError, json, logError, preflight, readJsonObject, requireEnv, UUID_RE } from '../_shared/http.ts';
import { createQrPhPayment, MIN_AMOUNT_CENTAVOS, PayMongoError } from '../_shared/paymongo.ts';
import { requireKiosk, serviceClient } from '../_shared/supabase.ts';

const MAX_BODY_BYTES = 4096;

interface Input {
  sessionId: string;
  downloadToken: string;
  templateId: string;
}

function parseInput(body: Record<string, unknown>): Input {
  const { sessionId, downloadToken, templateId } = body;
  if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) throw new HttpError(400, 'invalid_session_id');
  if (typeof downloadToken !== 'string' || !DOWNLOAD_TOKEN_RE.test(downloadToken)) {
    throw new HttpError(400, 'invalid_download_token');
  }
  if (typeof templateId !== 'string' || !UUID_RE.test(templateId)) throw new HttpError(400, 'invalid_template_id');
  return { sessionId: sessionId.toLowerCase(), downloadToken, templateId: templateId.toLowerCase() };
}

interface ExistingSession {
  kiosk_id: string;
  template_id: string;
  download_token: string;
  payments: { id: string; amount_centavos: number; qr_image: string | null } | null;
}

async function findSession(db: SupabaseClient, sessionId: string): Promise<ExistingSession | null> {
  const { data, error } = await db
    .from('sessions')
    .select('kiosk_id, template_id, download_token, payments(id, amount_centavos, qr_image)')
    .eq('id', sessionId)
    .maybeSingle<ExistingSession>();
  if (error) throw error;
  return data;
}

/** The answer for a session that already exists: the stored payment if it is this kiosk's retry, else 409. */
function replay(existing: ExistingSession, kioskId: string, input: Input): Response {
  const p = existing.payments;
  if (
    existing.kiosk_id !== kioskId ||
    existing.template_id !== input.templateId ||
    existing.download_token !== input.downloadToken ||
    !p ||
    !p.qr_image
  ) {
    return json(409, { error: 'session_conflict' });
  }
  return json(200, { paymentId: p.id, qrImageDataUrl: p.qr_image, amountCentavos: p.amount_centavos });
}

async function loadSettings(db: SupabaseClient): Promise<KioskSettings> {
  const { data, error } = await db
    .from('settings')
    .select('price_centavos, free_mode, shots_per_session, countdown_seconds, copies_per_session, link_expiry_days, active_template_id')
    .eq('id', 1)
    .single();
  if (error) throw error;
  const v = validateSettings({
    priceCentavos: data.price_centavos,
    freeMode: data.free_mode,
    shotsPerSession: data.shots_per_session,
    countdownSeconds: data.countdown_seconds,
    copiesPerSession: data.copies_per_session,
    linkExpiryDays: data.link_expiry_days,
    activeTemplateId: data.active_template_id,
  });
  if (!v.ok) throw new Error('settings row is invalid');
  return v.value;
}

Deno.serve(
  handle('create-payment', async (req) => {
    if (req.method === 'OPTIONS') return preflight();
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const db = serviceClient();
    const kioskId = await requireKiosk(req, db);
    const input = parseInput(await readJsonObject(req, MAX_BODY_BYTES));

    const existing = await findSession(db, input.sessionId);
    if (existing) return replay(existing, kioskId, input);

    const settings = await loadSettings(db);
    if (settings.freeMode) return json(409, { error: 'free_mode' });
    const amountCentavos = sessionAmountCentavos(settings);
    if (amountCentavos < MIN_AMOUNT_CENTAVOS) throw new Error('configured price is below the minimum');

    // Any live template (not necessarily the active one: the kiosk's cached settings can lag up to 60 s).
    const { count, error: tErr } = await db
      .from('templates')
      .select('id', { count: 'exact', head: true })
      .eq('id', input.templateId)
      .eq('archived', false);
    if (tErr) throw tErr;
    if (count !== 1) throw new HttpError(400, 'invalid_template_id');

    let created: { intentId: string; qrImageDataUrl: string };
    try {
      created = await createQrPhPayment({
        secretKey: requireEnv('PAYMONGO_SECRET_KEY'),
        amountCentavos,
        description: 'Photobooth session',
        metadata: { session_id: input.sessionId, kiosk_id: kioskId },
      });
    } catch (err) {
      if (err instanceof PayMongoError) {
        logError('create-payment: PayMongo', err);
        return json(502, { error: 'payment_provider_error' });
      }
      throw err;
    }

    const { data: paymentId, error } = await db.rpc('create_payment_session', {
      p_session_id: input.sessionId,
      p_kiosk_id: kioskId,
      p_template_id: input.templateId,
      p_download_token: input.downloadToken,
      p_amount: amountCentavos,
      p_intent_id: created.intentId,
      p_qr_image: created.qrImageDataUrl,
    });
    if (error) {
      if (error.code === '23505') {
        // A concurrent call for the same session won; or the download token is taken by another session.
        const again = await findSession(db, input.sessionId);
        if (again) return replay(again, kioskId, input);
        return json(409, { error: 'session_conflict' });
      }
      // PayMongo succeeded but nothing was stored: the intent is never shown and expires on its own.
      logError('create-payment: storing the payment failed after PayMongo succeeded', error);
      return json(500, { error: 'internal' });
    }
    if (typeof paymentId !== 'string') throw new Error('create_payment_session returned no id');

    return json(200, { paymentId, qrImageDataUrl: created.qrImageDataUrl, amountCentavos });
  }),
);
