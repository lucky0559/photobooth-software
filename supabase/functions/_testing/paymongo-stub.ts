// Local stand-in for the three PayMongo calls create-payment makes, for unit and integration tests only.
// Responses follow the SYNTHETIC fixtures in ../_shared/__fixtures__ (see the README there): they are NOT real
// PayMongo output. Never deployed: no Edge Function imports this file.

const attachFixture = JSON.parse(
  Deno.readTextFileSync(new URL('../_shared/__fixtures__/attach-qrph.json', import.meta.url)),
) as { data: { id: string; attributes: Record<string, unknown> & { next_action: { code: { image_url: string } } } } };

export interface StubCalls {
  createIntent: number;
  createMethod: number;
  attach: number;
  /** `data.attributes` of the last create-intent request. */
  lastIntent: Record<string, unknown> | null;
  /** `data.attributes` of the last create-method request. */
  lastMethod: Record<string, unknown> | null;
  /** Basic auth user (the secret key) of the last request. */
  lastKey: string | null;
}

export interface StubOptions {
  port?: number;
  hostname?: string;
}

export interface PayMongoStub {
  url: string;
  calls(): StubCalls;
  reset(): void;
  /** The next call of this kind answers with this HTTP status instead. */
  failNext(call: 'intent' | 'method' | 'attach', status: number): void;
  /** Replaces `next_action.code.image_url` in attach responses (null restores the fixture). */
  setImageUrl(value: string | null): void;
  close(): Promise<void>;
}

const fresh = (): StubCalls => ({
  createIntent: 0,
  createMethod: 0,
  attach: 0,
  lastIntent: null,
  lastMethod: null,
  lastKey: null,
});

export function startPayMongoStub(opts: StubOptions = {}): PayMongoStub {
  let calls = fresh();
  let seq = 0;
  let imageUrl: string | null = null;
  const fail: Partial<Record<'intent' | 'method' | 'attach', number>> = {};
  const intents = new Map<string, number>();
  const methods = new Set<string>();

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const error = (status: number, code: string): Response =>
    json(status, { errors: [{ code, detail: `stub: ${code}` }] });
  const failed = (call: 'intent' | 'method' | 'attach'): Response | null => {
    const status = fail[call];
    if (status === undefined) return null;
    delete fail[call];
    return error(status, 'stub_forced_failure');
  };

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === '/__calls' && req.method === 'GET') return json(200, calls);
    if (url.pathname === '/__reset' && req.method === 'POST') {
      calls = fresh();
      imageUrl = null;
      for (const k of Object.keys(fail)) delete fail[k as keyof typeof fail];
      return json(200, { ok: true });
    }
    if (url.pathname === '/__fail' && req.method === 'POST') {
      const b = (await req.json()) as { call: 'intent' | 'method' | 'attach'; status: number };
      fail[b.call] = b.status;
      return json(200, { ok: true });
    }
    if (url.pathname === '/__image' && req.method === 'POST') {
      imageUrl = ((await req.json()) as { value: string | null }).value;
      return json(200, { ok: true });
    }

    if (req.method !== 'POST') return error(405, 'method_not_allowed');
    const auth = req.headers.get('authorization') ?? '';
    const key = auth.startsWith('Basic ') ? atob(auth.slice(6)).replace(/:$/, '') : '';
    if (!key.startsWith('sk_')) return error(401, 'unauthorized');
    let attrs: Record<string, unknown>;
    try {
      attrs = ((await req.json()) as { data: { attributes: Record<string, unknown> } }).data.attributes;
    } catch {
      return error(400, 'parameter_invalid');
    }
    calls.lastKey = key;

    if (url.pathname === '/v1/payment_intents') {
      calls.createIntent++;
      calls.lastIntent = attrs;
      const f = failed('intent');
      if (f) return f;
      const amount = attrs.amount;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 100) {
        return error(400, 'parameter_below_minimum');
      }
      if (attrs.currency !== 'PHP') return error(400, 'parameter_invalid');
      const allowed = attrs.payment_method_allowed;
      if (!Array.isArray(allowed) || !allowed.includes('qrph')) return error(400, 'parameter_invalid');
      const id = `pi_stub${Date.now().toString(36)}${(++seq).toString(36)}`;
      intents.set(id, amount);
      return json(200, {
        data: {
          id,
          type: 'payment_intent',
          attributes: {
            ...attachFixture.data.attributes,
            amount,
            original_amount: amount,
            client_key: `${id}_client_stub`,
            status: 'awaiting_payment_method',
            next_action: null,
            metadata: attrs.metadata ?? null,
          },
        },
      });
    }

    if (url.pathname === '/v1/payment_methods') {
      calls.createMethod++;
      calls.lastMethod = attrs;
      const f = failed('method');
      if (f) return f;
      if (attrs.type !== 'qrph') return error(400, 'parameter_invalid');
      const id = `pm_stub${Date.now().toString(36)}${(++seq).toString(36)}`;
      methods.add(id);
      return json(200, { data: { id, type: 'payment_method', attributes: { type: 'qrph', livemode: false } } });
    }

    const attach = url.pathname.match(/^\/v1\/payment_intents\/([^/]+)\/attach$/);
    if (attach) {
      calls.attach++;
      const f = failed('attach');
      if (f) return f;
      const id = attach[1];
      const amount = intents.get(id);
      if (amount === undefined) return error(404, 'resource_not_found');
      if (typeof attrs.payment_method !== 'string' || !methods.has(attrs.payment_method)) {
        return error(400, 'parameter_invalid');
      }
      const a = attachFixture.data.attributes;
      return json(200, {
        data: {
          id,
          type: 'payment_intent',
          attributes: {
            ...a,
            amount,
            original_amount: amount,
            client_key: `${id}_client_stub`,
            next_action: {
              ...a.next_action,
              code: { ...a.next_action.code, amount, image_url: imageUrl ?? a.next_action.code.image_url },
            },
          },
        },
      });
    }

    return error(404, 'resource_not_found');
  };

  const server = Deno.serve(
    { port: opts.port ?? 0, hostname: opts.hostname ?? '127.0.0.1', onListen: () => {} },
    handler,
  );
  const addr = server.addr as Deno.NetAddr;
  const host = addr.hostname === '0.0.0.0' ? '127.0.0.1' : addr.hostname;
  return {
    url: `http://${host}:${addr.port}`,
    calls: () => structuredClone(calls),
    reset: () => {
      calls = fresh();
      imageUrl = null;
    },
    failNext: (call, status) => {
      fail[call] = status;
    },
    setImageUrl: (value) => {
      imageUrl = value;
    },
    close: () => server.shutdown(),
  };
}

if (import.meta.main) {
  const port = Number(Deno.env.get('PAYMONGO_STUB_PORT') ?? '54399');
  const stub = startPayMongoStub({ port, hostname: '0.0.0.0' });
  console.log(`PayMongo stub listening on ${stub.url}`);
}
