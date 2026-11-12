// PayMongo client for QR Ph payments and webhook verification.
//
// SYNTHETIC — built from PayMongo docs, NOT captured from the live API; verify with a real test-mode run
// (docs/ACCEPTANCE.md, "Task 5 — real PayMongo test-mode run before go-live").
//
// JSON paths this file relies on (all read in the small mapping functions below, so a correction is one line):
//   - Intent id:         create-intent response   `data.id`                                   (`pi_…`)
//   - Payment method id: create-method response   `data.id`                                   (`pm_…`)
//   - QR image:          attach response          `data.attributes.next_action.code.image_url`
//                        (docs: "a Base64-encoded string" rendered in an <img>; we accept a `data:image/png|jpeg|gif`
//                        URL or bare base64, which gets a PNG prefix; a hosted http(s) URL is refused → 502)
//   - Webhook type:      event body               `data.attributes.type`                      (`payment.paid` …)
//   - Webhook intent id: event body               `data.attributes.data.attributes.payment_intent_id`
//   - Webhook amount:    event body               `data.attributes.data.attributes.amount`    (centavos)
//   - Intent status:     retrieve response        `data.attributes.status`                    (GET /v1/payment_intents/{id};
//                        docs list awaiting_payment_method, awaiting_next_action, processing, succeeded, cancelled;
//                        only `succeeded` counts as paid — used by cancel-payment to reconcile a lost webhook)
//
// Sources (read 2026-11-12): https://docs.paymongo.com/docs/payment-acceptance-qr-ph-api,
// https://docs.paymongo.com/reference/create-a-paymentintent, https://docs.paymongo.com/reference/create-a-paymentmethod,
// https://docs.paymongo.com/reference/attach-to-paymentintent, https://docs.paymongo.com/docs/developer-tools-webhooks-events,
// https://docs.paymongo.com/docs/developer-tools-webhook-setup-management (Securing a webhook),
// https://docs.paymongo.com/reference/retrieve-a-paymentintent and https://docs.paymongo.com/reference/the-payment-intent-object
// (read 2026-11-12: retrieve with the secret key; status values as listed above).
//
// Signature (docs): header `Paymongo-Signature: t=<unix ts>,te=<test sig>,li=<live sig>`; signature = HMAC-SHA256 with
// the webhook's secret key over `${t}.${rawBody}`. The docs do not name the encoding; hex is assumed (64 hex chars).
// The docs suggest, without a number, comparing `t` to the clock against replays. We deliberately do NOT: if PayMongo
// retries with the original `t` after an outage, an age limit would reject the late `payment.paid` and lose it. Every
// state change is idempotent and a signed body names exactly one intent, so a replay changes nothing.

/**
 * ₱20 per our own validation (the DB CHECK on settings and this check). PayMongo's own minimum must be confirmed in the
 * real test run (docs/ACCEPTANCE.md, Task 5).
 */
export const MIN_AMOUNT_CENTAVOS = 2000;
export const MAX_AMOUNT_CENTAVOS = 100000;
/** Seconds a QR stays payable after attach (docs: 60–9000, default 1800). Kiosk payment window is 180 s. */
export const QR_EXPIRY_SECONDS = 300;
const CALL_TIMEOUT_MS = 10_000;
/**
 * The intent lookup runs inside cancel-payment, whose kiosk caller counts a call as failed after 8 s (and retries);
 * 5 s keeps a stalled PayMongo from pushing every cancel past that.
 */
const RETRIEVE_TIMEOUT_MS = 5_000;
const MAX_QR_DATA_URL_LENGTH = 1_000_000;
const MAX_ID_LENGTH = 255;

export class PayMongoError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'PayMongoError';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const at = (v: unknown, ...path: string[]): unknown => {
  let cur = v;
  for (const k of path) {
    if (!isObject(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
};

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;

// ---------------------------------------------------------------------------
// Mapping functions: the only places that know PayMongo's JSON paths
// ---------------------------------------------------------------------------

/** `data.id` of a create-intent / create-method / attach response. */
export function resourceIdFrom(response: unknown): string | null {
  const id = at(response, 'data', 'id');
  return isId(id) ? id : null;
}

/**
 * QR image of an attach response, as a `data:image/…` URL, or null when it is missing or not an inline raster image.
 * Path from the QR Ph API guide: `data.attributes.next_action.code.image_url`.
 */
export function qrImageDataUrlFrom(attachResponse: unknown): string | null {
  const raw = at(attachResponse, 'data', 'attributes', 'next_action', 'code', 'image_url');
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_QR_DATA_URL_LENGTH) return null;
  if (/^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(raw)) return raw;
  const bare = raw.replace(/\s+/g, '');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(bare)) return `data:image/png;base64,${bare}`;
  return null;
}

/** Event type and payment intent id of a webhook body (`data.attributes.type`, `…data.attributes.payment_intent_id`). */
export function parseWebhookEvent(body: unknown): { type: string; intentId: string | null } | null {
  const type = at(body, 'data', 'attributes', 'type');
  if (typeof type !== 'string' || type.length === 0 || type.length > 100) return null;
  const intentId = at(body, 'data', 'attributes', 'data', 'attributes', 'payment_intent_id');
  return { type, intentId: isId(intentId) ? intentId : null };
}

/** What is kept of a webhook event in `payments.last_event` (the kiosk can read that column for its own payments). */
export interface TrimmedEvent {
  id: string | null;
  type: string | null;
  amount: number | null;
  currency: string | null;
  status: string | null;
  paid_at: number | null;
  payment_intent_id: string | null;
}

/**
 * The event id/type and the payment's amount, currency, status, paid_at and intent id. Nothing else, in particular no
 * billing/contact details or metadata of the payer.
 */
export function trimEvent(body: unknown): TrimmedEvent {
  const str = (v: unknown, max = MAX_ID_LENGTH) => (typeof v === 'string' && v.length <= max ? v : null);
  const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  const p = (k: string) => at(body, 'data', 'attributes', 'data', 'attributes', k);
  return {
    id: str(at(body, 'data', 'id')),
    type: str(at(body, 'data', 'attributes', 'type'), 100),
    amount: int(p('amount')),
    currency: str(p('currency'), 10),
    status: str(p('status'), 50),
    paid_at: int(p('paid_at')),
    payment_intent_id: str(p('payment_intent_id')),
  };
}

/** `data.attributes.status` of a retrieve-intent response (`succeeded` = paid), or null when missing or odd. */
export function intentStatusFrom(response: unknown): string | null {
  const status = at(response, 'data', 'attributes', 'status');
  return typeof status === 'string' && status.length > 0 && status.length <= 50 ? status : null;
}

/** The intent status that means the guest paid. */
export const INTENT_SUCCEEDED = 'succeeded';

export function parsePaidEvent(body: unknown): { intentId: string; amountCentavos: number } | null {
  const ev = parseWebhookEvent(body);
  if (ev?.type !== 'payment.paid' || ev.intentId === null) return null;
  const amount = at(body, 'data', 'attributes', 'data', 'attributes', 'amount');
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return null;
  return { intentId: ev.intentId, amountCentavos: amount };
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

export function payMongoApiBase(): string {
  return (Deno.env.get('PAYMONGO_API_BASE') || 'https://api.paymongo.com').replace(/\/+$/, '');
}

/** POST `{ data: { attributes } }` to `path`, or GET it when `attributes` is null. */
async function call(
  apiBase: string,
  secretKey: string,
  path: string,
  attributes: Record<string, unknown> | null,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}${path}`, {
      method: attributes === null ? 'GET' : 'POST',
      headers: {
        ...(attributes === null ? {} : { 'content-type': 'application/json' }),
        accept: 'application/json',
        authorization: `Basic ${btoa(`${secretKey}:`)}`,
      },
      body: attributes === null ? undefined : JSON.stringify({ data: { attributes } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new PayMongoError(`PayMongo ${path} unreachable: ${err instanceof Error ? err.name : 'error'}`);
  }
  const text = await res.text();
  if (!res.ok) {
    // Only PayMongo's error codes are logged upstream; the request never echoes the key.
    let codes = '';
    try {
      const errors = at(JSON.parse(text), 'errors');
      if (Array.isArray(errors)) codes = errors.map((e) => String(at(e, 'code') ?? '')).join(',');
    } catch {
      // not JSON
    }
    throw new PayMongoError(`PayMongo ${path} failed with ${res.status}${codes ? ` (${codes})` : ''}`, res.status);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new PayMongoError(`PayMongo ${path} returned invalid JSON`, res.status);
  }
}

/**
 * Creates a QR Ph payment: Payment Intent (PHP, qrph only, amount from server settings) → Payment Method (qrph) →
 * attach. Returns the intent id and the QR as a `data:image/…` URL. Throws PayMongoError on any provider problem,
 * RangeError on an amount outside ₱20.00–₱1,000.00 (checked before any network call).
 */
export async function createQrPhPayment(args: {
  secretKey: string;
  amountCentavos: number;
  description: string;
  metadata: Record<string, string>;
  /** Defaults to env PAYMONGO_API_BASE, else https://api.paymongo.com. */
  apiBase?: string;
}): Promise<{ intentId: string; qrImageDataUrl: string }> {
  const { secretKey, amountCentavos } = args;
  if (!Number.isInteger(amountCentavos) || amountCentavos < MIN_AMOUNT_CENTAVOS || amountCentavos > MAX_AMOUNT_CENTAVOS) {
    throw new RangeError(`amount ${amountCentavos} is outside ${MIN_AMOUNT_CENTAVOS}-${MAX_AMOUNT_CENTAVOS} centavos`);
  }
  if (!secretKey) throw new PayMongoError('PayMongo secret key is not configured');
  const base = args.apiBase ?? payMongoApiBase();

  const intent = await call(base, secretKey, '/v1/payment_intents', {
    amount: amountCentavos,
    currency: 'PHP',
    payment_method_allowed: ['qrph'],
    capture_type: 'automatic',
    description: args.description,
    metadata: args.metadata,
  });
  const intentId = resourceIdFrom(intent);
  if (!intentId) throw new PayMongoError('PayMongo intent response has no data.id');

  const method = await call(base, secretKey, '/v1/payment_methods', {
    type: 'qrph',
    expiry_seconds: QR_EXPIRY_SECONDS,
    metadata: args.metadata,
  });
  const methodId = resourceIdFrom(method);
  if (!methodId) throw new PayMongoError('PayMongo payment method response has no data.id');

  const attached = await call(base, secretKey, `/v1/payment_intents/${encodeURIComponent(intentId)}/attach`, {
    payment_method: methodId,
  });
  if (resourceIdFrom(attached) !== intentId) throw new PayMongoError('PayMongo attach returned another intent');
  const qrImageDataUrl = qrImageDataUrlFrom(attached);
  if (!qrImageDataUrl) throw new PayMongoError('PayMongo attach response has no inline QR image');
  return { intentId, qrImageDataUrl };
}

/**
 * Retrieves a payment intent (GET /v1/payment_intents/{id}, secret key, 5 s timeout) and returns its status.
 * Throws PayMongoError on any provider problem or a response without a usable `data.attributes.status`.
 */
export async function retrievePaymentIntent(
  secretKey: string,
  intentId: string,
  /** Defaults to env PAYMONGO_API_BASE, else https://api.paymongo.com. */
  apiBase?: string,
): Promise<{ status: string }> {
  if (!secretKey) throw new PayMongoError('PayMongo secret key is not configured');
  if (!isId(intentId)) throw new PayMongoError('invalid intent id');
  const res = await call(apiBase ?? payMongoApiBase(), secretKey, `/v1/payment_intents/${encodeURIComponent(intentId)}`, null, RETRIEVE_TIMEOUT_MS);
  if (resourceIdFrom(res) !== intentId) throw new PayMongoError('PayMongo retrieve returned another intent');
  const status = intentStatusFrom(res);
  if (!status) throw new PayMongoError('PayMongo intent response has no data.attributes.status');
  return { status };
}

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  const out = new Uint8Array(new ArrayBuffer(32));
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Verifies `Paymongo-Signature: t=…,te=…,li=…`: HMAC-SHA256(secret, `${t}.${rawBody}`) must equal `te` (test mode) or
 * `li` (live mode). `t` must be present and numeric (it is part of the signed string) but its age is not checked (see
 * the top of this file). Comparison is WebCrypto `verify` (constant time).
 */
export async function verifyWebhookSignature(
  header: string,
  rawBody: string,
  secret: string,
  mode: 'test' | 'live',
): Promise<boolean> {
  if (!header || !secret || header.length > 1000) return false;
  const parts = new Map<string, string>();
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) return false;
    const k = part.slice(0, eq).trim();
    if (parts.has(k)) return false;
    parts.set(k, part.slice(eq + 1).trim());
  }
  const t = parts.get('t');
  if (!t || !/^\d{1,12}$/.test(t)) return false;
  const sig = hexToBytes(parts.get(mode === 'live' ? 'li' : 'te') ?? '');
  if (!sig) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`${t}.${rawBody}`));
}
