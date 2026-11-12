// POST /functions/v1/paymongo-webhook  (no JWT: config.toml verify_jwt = false; deploy with --no-verify-jwt)
// Behaviour: see handler.ts.
import { requireEnv } from '../_shared/http.ts';
import { serviceClient, SupabasePaymentStore } from '../_shared/supabase.ts';
import { webhookHandler } from './handler.ts';

Deno.serve(
  webhookHandler(() => {
    const mode = requireEnv('PAYMONGO_MODE');
    if (mode !== 'test' && mode !== 'live') throw new Error('PAYMONGO_MODE must be test or live');
    return {
      store: new SupabasePaymentStore(serviceClient()),
      secret: requireEnv('PAYMONGO_WEBHOOK_SECRET'),
      mode,
    };
  }),
);
