// One-command integration run: `deno task test:integration` (from supabase/functions).
//
// Needs: the local Supabase stack running (`supabase start`), supabase/.env.local (see supabase/.env.example; local
// dummy values, PAYMONGO_API_BASE=http://host.docker.internal:54399), and @pb/core synced into _shared/core (the deno
// task does that first). Starts the PayMongo stub on :54399 and `supabase functions serve`, runs
// _integration/*.test.ts, then stops both. Serve output goes to supabase/.temp/functions-serve.log.
import { startPayMongoStub } from '../_testing/paymongo-stub.ts';
import { localStack, REPO_ROOT } from './helpers.ts';

const STUB_PORT = 54399;
const READY_TIMEOUT_MS = 120_000;

async function webhookStatus(apiUrl: string): Promise<number> {
  try {
    const res = await fetch(`${apiUrl}/functions/v1/paymongo-webhook`, { method: 'POST', body: '{}' });
    await res.body?.cancel();
    return res.status;
  } catch {
    return 0;
  }
}

try {
  Deno.statSync(`${REPO_ROOT}supabase/.env.local`);
  Deno.statSync(`${REPO_ROOT}supabase/functions/_shared/core/index.ts`);
} catch {
  console.error('Missing supabase/.env.local or supabase/functions/_shared/core (run: node scripts/sync-core-to-functions.mjs).');
  Deno.exit(2);
}

const { apiUrl } = await localStack();
if ((await webhookStatus(apiUrl)) === 401) {
  console.error('Edge Functions are already being served; stop that `supabase functions serve` first.');
  Deno.exit(2);
}

// 0.0.0.0: the edge-runtime container reaches the stub through host.docker.internal.
const stub = startPayMongoStub({ port: STUB_PORT, hostname: '0.0.0.0' });
Deno.mkdirSync(`${REPO_ROOT}supabase/.temp`, { recursive: true });
const log = await Deno.open(`${REPO_ROOT}supabase/.temp/functions-serve.log`, { write: true, create: true, truncate: true });
const serve = new Deno.Command('supabase', {
  args: ['functions', 'serve', '--env-file', 'supabase/.env.local'],
  cwd: REPO_ROOT,
  stdout: 'piped',
  stderr: 'piped',
}).spawn();
const encoder = new TextEncoder();
const drain = async (stream: ReadableStream<Uint8Array>) => {
  for await (const chunk of stream) await log.write(chunk);
};
const draining = Promise.all([drain(serve.stdout), drain(serve.stderr)]);

let code = 1;
try {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while ((await webhookStatus(apiUrl)) !== 401) {
    if (Date.now() > deadline) throw new Error('functions serve did not become ready (see supabase/.temp/functions-serve.log)');
    await new Promise((r) => setTimeout(r, 1000));
  }
  await log.write(encoder.encode('--- ready, running tests ---\n'));

  const test = await new Deno.Command(Deno.execPath(), {
    args: ['test', '--allow-all', '_integration/'],
    cwd: `${REPO_ROOT}supabase/functions`,
    env: { PB_INTEGRATION: '1', STUB_URL: `http://127.0.0.1:${STUB_PORT}` },
    stdout: 'inherit',
    stderr: 'inherit',
  }).output();
  code = test.code;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
} finally {
  try {
    serve.kill('SIGINT');
  } catch {
    // already gone
  }
  await serve.status;
  await draining.catch(() => {});
  log.close();
  await stub.close();
}
Deno.exit(code);
