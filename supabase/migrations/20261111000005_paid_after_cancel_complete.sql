-- sessions_guard: let the kiosk complete a `paid_after_cancel` session once its payment is paid (final review I1, R18).
--
-- The kiosk's cancel can reach the server while its answer is lost or slower than the kiosk's 8 s call timeout. If the
-- guest's payment lands during the kiosk's retry window, the payment becomes `paid` and the session
-- `paid_after_cancel`; the kiosk's next poll or cancel retry sees `paid` and serves the guest (capture and print).
-- Its `completed` upsert was then rejected forever, so the photo upload queued behind it never ran: the guest had a
-- print, the link said "still uploading" and the dashboard asked for a refund.
--
-- Change: a KIOSK update may now move `paid_after_cancel -> completed`, only when the session's payment is `paid` for
-- the (kept) session amount: the same completion check as `paid -> completed`. Everything else is unchanged:
-- `cancelled -> anything` stays forbidden, `paid_after_cancel -> anything else` stays forbidden, free/awaiting rules,
-- the amount self-heal and created_at handling are as in 20261111000003. The service role is still exempt.
--
-- Trade-off (accepted for the MVP, R18): a compromised kiosk could clear a refund signal by completing a
-- paid_after_cancel session; revenue (from payments) is unaffected.

create or replace function public.sessions_guard() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  pay record;
begin
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.kiosk_id is distinct from old.kiosk_id) then
    raise exception 'sessions.id and sessions.kiosk_id are immutable';
  end if;

  if not public.is_kiosk() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('awaiting_payment', 'free', 'completed') then
      raise exception 'kiosk may only insert status awaiting_payment, free or completed';
    end if;
    -- Link expiry and "today" grouping key off created_at: no future dates.
    new.created_at := least(new.created_at, now());
  else
    -- The kiosk upsert re-sends its local created_at; keep the stored one
    -- silently (create-payment may have set it) instead of failing the sync.
    new.created_at := old.created_at;

    if new.download_token is distinct from old.download_token or new.template_id is distinct from old.template_id then
      raise exception 'kiosk may not change download_token or template_id';
    end if;
    -- The server decides the price; the kiosk can only repeat it. When the server set it (a payment exists), a
    -- different value from the kiosk is a stale cache: keep the stored amount instead of failing the sync.
    if new.amount_centavos is distinct from old.amount_centavos then
      if exists (select 1 from public.payments p where p.session_id = new.id) then
        new.amount_centavos := old.amount_centavos;
      else
        raise exception 'kiosk may not change amount_centavos';
      end if;
    end if;

    if new.status is distinct from old.status then
      -- Server-owned outcomes stay as they are, except that a paid_after_cancel session the kiosk served may be
      -- completed (the payment check below then requires the payment to be paid for the kept amount).
      if old.status = 'cancelled' or (old.status = 'paid_after_cancel' and new.status <> 'completed') then
        raise exception 'kiosk may not change the status of a cancelled session';
      end if;
      if new.status not in ('free', 'completed') then
        raise exception 'kiosk may only set status free or completed';
      end if;
      if new.status = 'free' and old.status = 'awaiting_payment'
         and exists (select 1 from public.payments p where p.session_id = new.id) then
        raise exception 'kiosk may not set a session with a payment to free';
      end if;
    end if;
  end if;

  -- A session with a payment can only be completed once that payment is paid,
  -- for exactly the amount paid. UPDATE only: a payment exists only for an existing session (FK), so on INSERT this
  -- could fire only in the INSERT phase of the kiosk's upsert, before the conflict is detected and before the amount
  -- is healed above. That upsert then re-runs this trigger as an UPDATE, which enforces the rule; a plain INSERT of
  -- an existing id fails on the primary key.
  if new.status = 'completed' and tg_op = 'UPDATE' and old.status is distinct from 'completed' then
    select p.amount_centavos, p.status into pay from public.payments p where p.session_id = new.id;
    if found and (pay.status <> 'paid' or pay.amount_centavos <> new.amount_centavos) then
      raise exception 'completed session amount must match its paid payment';
    end if;
    -- paid_after_cancel always has a payment (the webhook set it); without one there is nothing to check against.
    if not found and old.status = 'paid_after_cancel' then
      raise exception 'completed session amount must match its paid payment';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.sessions_guard() from public, anon, authenticated, service_role;
