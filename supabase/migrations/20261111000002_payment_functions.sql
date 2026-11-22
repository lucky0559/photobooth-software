-- Payment functions for the PayMongo Edge Functions (Task 5).
--
-- Every multi-row change the Edge Functions make lives here, so each one is a single transaction, and every state
-- change is a conditional UPDATE: concurrent webhook deliveries cannot apply twice, and a cancel racing a payment
-- can never turn a paid payment into a cancelled one. Only the service role (Edge Functions) may execute them.
--
-- Status rules:
--   payments: pending|failed -> paid (webhook), pending|failed -> cancelled (cancel), cancelled -> paid (late webhook).
--             `paid` is final. Nothing writes `failed` today: a failed QR Ph attempt leaves the payment pending, since
--             the same QR can still be paid; the status is accepted as payable in case an operator sets it.
--   sessions: awaiting_payment -> paid (with the payment), awaiting_payment -> cancelled (with the payment),
--             any -> paid_after_cancel (a payment arriving after the cancel: operator refund signal).

-- The QR shown for the payment, so a retried create-payment returns the same QR instead of a second intent.
alter table public.payments
  add column qr_image text null
    check (qr_image is null or (qr_image ~ '^data:image/(png|jpeg|gif);base64,' and length(qr_image) <= 1000000)),
  -- Same range as settings.price_centavos (₱20.00 is also above PayMongo's own minimum).
  add constraint payments_amount_centavos_check check (amount_centavos between 2000 and 100000);

-- ---------------------------------------------------------------------------
-- create-payment: session + payment, both or neither
-- ---------------------------------------------------------------------------

create function public.create_payment_session(
  p_session_id uuid,
  p_kiosk_id uuid,
  p_template_id uuid,
  p_download_token text,
  p_amount int,
  p_intent_id text,
  p_qr_image text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_payment uuid;
begin
  insert into public.sessions (id, kiosk_id, template_id, download_token, amount_centavos, status)
  values (p_session_id, p_kiosk_id, p_template_id, p_download_token, p_amount, 'awaiting_payment');

  insert into public.payments (session_id, provider_intent_id, amount_centavos, status, qr_image)
  values (p_session_id, p_intent_id, p_amount, 'pending', p_qr_image)
  returning id into v_payment;

  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- Webhook: payment.paid
-- ---------------------------------------------------------------------------

-- 'updated' | 'not_pending' | 'not_found'
create function public.mark_payment_paid(p_intent text, p_paid_at timestamptz) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_session uuid;
begin
  update public.payments
     set status = 'paid', paid_at = p_paid_at
   where provider_intent_id = p_intent and status in ('pending', 'failed')
  returning session_id into v_session;

  if found then
    update public.sessions set status = 'paid' where id = v_session and status = 'awaiting_payment';
    return 'updated';
  end if;

  if exists (select 1 from public.payments where provider_intent_id = p_intent) then
    return 'not_pending';
  end if;
  return 'not_found';
end;
$$;

-- 'updated' | 'not_cancelled'
create function public.mark_payment_paid_after_cancel(p_intent text, p_paid_at timestamptz) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_session uuid;
begin
  update public.payments
     set status = 'paid', paid_at = p_paid_at
   where provider_intent_id = p_intent and status = 'cancelled'
  returning session_id into v_session;

  if not found then
    return 'not_cancelled';
  end if;

  update public.sessions set status = 'paid_after_cancel' where id = v_session;
  return 'updated';
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel-payment
-- ---------------------------------------------------------------------------

-- 'cancelled' | 'not_pending' | 'forbidden' | 'not_found'
create function public.cancel_payment(p_payment uuid, p_kiosk uuid) returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_kiosk uuid;
  v_session uuid;
begin
  select s.kiosk_id, s.id into v_kiosk, v_session
    from public.payments p join public.sessions s on s.id = p.session_id
   where p.id = p_payment;

  if not found then
    return 'not_found';
  end if;
  -- sessions.kiosk_id is immutable (sessions_guard), so this check cannot go stale.
  if v_kiosk is distinct from p_kiosk then
    return 'forbidden';
  end if;

  update public.payments set status = 'cancelled'
   where id = p_payment and status in ('pending', 'failed');

  if not found then
    return 'not_pending';
  end if;

  update public.sessions set status = 'cancelled' where id = v_session and status = 'awaiting_payment';
  return 'cancelled';
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: service role only
-- ---------------------------------------------------------------------------

revoke execute on function
  public.create_payment_session(uuid, uuid, uuid, text, int, text, text),
  public.mark_payment_paid(text, timestamptz),
  public.mark_payment_paid_after_cancel(text, timestamptz),
  public.cancel_payment(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  public.create_payment_session(uuid, uuid, uuid, text, int, text, text),
  public.mark_payment_paid(text, timestamptz),
  public.mark_payment_paid_after_cancel(text, timestamptz),
  public.cancel_payment(uuid, uuid)
to service_role;
