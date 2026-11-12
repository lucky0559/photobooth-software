// POST /functions/v1/cancel-payment  (kiosk JWT)
// body { paymentId } → 200 { status: 'cancelled' | 'paid' }; 403 another kiosk's payment; 404 unknown payment.
//
// Never turns a paid payment into a cancelled one (`paid` wins: the guest paid at the last second), and a second call
// gives the same answer. Cancelling also cancels the session (atomically, in the SQL function).
import { handle, HttpError, json, preflight, readJsonObject, UUID_RE } from '../_shared/http.ts';
import { cancelPayment } from '../_shared/payments.ts';
import { requireKiosk, serviceClient, SupabasePaymentStore } from '../_shared/supabase.ts';

const MAX_BODY_BYTES = 1024;

Deno.serve(
  handle('cancel-payment', async (req) => {
    if (req.method === 'OPTIONS') return preflight();
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

    const db = serviceClient();
    const kioskId = await requireKiosk(req, db);
    const { paymentId } = await readJsonObject(req, MAX_BODY_BYTES);
    if (typeof paymentId !== 'string' || !UUID_RE.test(paymentId)) throw new HttpError(400, 'invalid_payment_id');

    const r = await cancelPayment(new SupabasePaymentStore(db), paymentId.toLowerCase(), kioskId);
    if (r === 'forbidden') return json(403, { error: 'forbidden' });
    if (r === 'not_found') return json(404, { error: 'not_found' });
    return json(200, { status: r });
  }),
);
