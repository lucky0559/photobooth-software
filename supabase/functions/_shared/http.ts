// Small HTTP helpers shared by the Edge Functions: CORS, JSON responses, capped body reading, input validation.

/**
 * The kiosk is an Electron renderer calling with `Authorization: Bearer <jwt>` (no cookies), so any origin may call:
 * the JWT, not the origin, is the credential. `Access-Control-Allow-Credentials` is never sent.
 */
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-max-age': '600',
};

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `newDownloadToken()` in @pb/core: 16 random bytes, base64url, 22 characters (same CHECK as sessions.download_token). */
export const DOWNLOAD_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

export function json(status: number, body: unknown, cors = true): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(cors ? CORS_HEADERS : {}) },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = 'HttpError';
  }
}

/** Reads at most `maxBytes` of the body as UTF-8. Throws HttpError 413 when larger, 400 when not valid UTF-8. */
export async function readBodyText(req: Request, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declared) || declared > maxBytes) throw new HttpError(413, 'payload_too_large');
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'payload_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    bytes.set(c, off);
    off += c.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(400, 'invalid_body');
  }
}

/** Body parsed as a JSON object. Throws HttpError 400 for anything else. */
export async function readJsonObject(req: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const text = await readBodyText(req, maxBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new HttpError(400, 'invalid_body');
  return parsed as Record<string, unknown>;
}

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing environment variable ${name}`);
  return v;
}

/**
 * Logs without stack traces or values that could carry data: an error with a `code` (Postgres/PostgREST errors, whose
 * messages and details can quote row values such as a download token) is logged by its code only; other errors by
 * name and message (our own messages never contain secrets).
 */
export function logError(where: string, err: unknown): void {
  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code) {
    console.error(`${where}: code ${String((err as { code: unknown }).code)}`);
  } else if (err instanceof Error) console.error(`${where}: ${err.name}: ${err.message}`);
  else console.error(`${where}: unknown error`);
}

/** Wraps a handler: HttpError → its status, anything else → 500 without details. */
export function handle(where: string, fn: (req: Request) => Promise<Response>, cors = true): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.code }, cors);
      logError(where, err);
      return json(500, { error: 'internal' }, cors);
    }
  };
}
