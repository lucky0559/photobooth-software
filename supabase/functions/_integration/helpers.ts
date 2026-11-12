// Helpers for the HTTP integration tests (local Supabase stack + `supabase functions serve` + PayMongo stub).
// Run them through `deno task test:integration` (see run.ts); a plain `deno test` skips them.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const ENABLED = Deno.env.get('PB_INTEGRATION') === '1';
export const REPO_ROOT = new URL('../../../', import.meta.url).pathname;
export const STUB_URL = Deno.env.get('STUB_URL') ?? 'http://127.0.0.1:54399';

export interface LocalStack {
  apiUrl: string;
  anonKey: string;
  serviceKey: string;
}

let stack: LocalStack | null = null;

export async function localStack(): Promise<LocalStack> {
  if (stack) return stack;
  const out = await new Deno.Command('supabase', { args: ['status', '-o', 'json'], cwd: REPO_ROOT, stderr: 'null' }).output();
  const s = JSON.parse(new TextDecoder().decode(out.stdout)) as Record<string, string>;
  stack = { apiUrl: s.API_URL, anonKey: s.ANON_KEY, serviceKey: s.SERVICE_ROLE_KEY };
  return stack;
}

/** supabase/.env.local as a map (local dummy values only). */
export function localEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of Deno.readTextFileSync(`${REPO_ROOT}supabase/.env.local`).split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

export async function service(): Promise<SupabaseClient> {
  const s = await localStack();
  return createClient(s.apiUrl, s.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function signIn(email: string, password = 'localpass123'): Promise<{ jwt: string; userId: string }> {
  const s = await localStack();
  const res = await fetch(`${s.apiUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: s.anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status}`);
  return { jwt: body.access_token, userId: body.user.id };
}

/** A second kiosk user (local only), created through the admin API if missing. */
export async function ensureUser(email: string, role: 'admin' | 'kiosk'): Promise<void> {
  const s = await localStack();
  const res = await fetch(`${s.apiUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: s.serviceKey, authorization: `Bearer ${s.serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'localpass123', email_confirm: true }),
  });
  await res.body?.cancel();
  const { userId } = await signIn(email);
  const db = await service();
  const { error } = await db.from('profiles').upsert({ user_id: userId, role });
  if (error) throw new Error(`profile upsert failed: ${error.message}`);
}

export interface FnResult {
  status: number;
  body: Record<string, unknown> | null;
  headers: Headers;
}

export async function callFn(
  name: string,
  init: { body?: unknown; rawBody?: string; jwt?: string | null; headers?: Record<string, string>; method?: string } = {},
): Promise<FnResult> {
  const s = await localStack();
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers ?? {}) };
  if (init.jwt) headers.authorization = `Bearer ${init.jwt}`;
  const res = await fetch(`${s.apiUrl}/functions/v1/${name}`, {
    method: init.method ?? 'POST',
    headers,
    body: init.method === 'GET' || init.method === 'OPTIONS' ? undefined : (init.rawBody ?? JSON.stringify(init.body ?? {})),
  });
  const text = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, headers: res.headers };
}

export async function stub(path: '/__calls' | '/__reset' | '/__fail' | '/__image', body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${STUB_URL}${path}`, {
    method: path === '/__calls' ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: path === '/__calls' ? undefined : JSON.stringify(body ?? {}),
  });
  return await res.json();
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A webhook body shaped like the synthetic fixture, for the given event type and intent. */
export function webhookEvent(type: string, intentId: string, amount = 15000): string {
  const ev = JSON.parse(
    Deno.readTextFileSync(new URL('../_shared/__fixtures__/webhook-payment-paid.json', import.meta.url)),
  );
  ev.data.id = `evt_it${crypto.randomUUID().replaceAll('-', '')}`;
  ev.data.attributes.type = type;
  ev.data.attributes.data.attributes.payment_intent_id = intentId;
  ev.data.attributes.data.attributes.amount = amount;
  ev.data.attributes.data.attributes.status = type === 'payment.paid' ? 'paid' : 'failed';
  return JSON.stringify(ev);
}

export async function sendWebhook(raw: string, opts: { secret?: string; t?: number; header?: string } = {}): Promise<FnResult> {
  const t = opts.t ?? Math.floor(Date.now() / 1000);
  const sig = await hmacHex(opts.secret ?? localEnv().PAYMONGO_WEBHOOK_SECRET, `${t}.${raw}`);
  return callFn('paymongo-webhook', {
    rawBody: raw,
    headers: { 'paymongo-signature': opts.header ?? `t=${t},te=${sig},li=` },
  });
}
