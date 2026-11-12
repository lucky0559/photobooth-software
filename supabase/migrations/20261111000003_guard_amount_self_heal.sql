-- sessions_guard: keep the server's amount on kiosk updates of a session that has a payment (Task 5 fix round 1).
--
-- create-payment stores the amount from server settings. A kiosk that cached an older price (settings refresh is up
-- to 60 s old) later upserts the session as `completed` with its own amount. Raising there would fail that sync job
-- forever and block the photo upload queued behind it. For a session WITH a payment row the stored amount is now
-- kept silently (like created_at); the completion check then compares the kept amount with the paid payment.
-- Sessions without a payment (free sessions) still raise on an amount change. The completion check now runs on UPDATE
-- only (see the comment there: the upsert's INSERT phase saw the stale amount before the heal). Every other rule is
-- unchanged.

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
      -- Server-owned outcomes (refund signal for the operator) stay as they are.
      if old.status in ('cancelled', 'paid_after_cancel') then
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
  end if;

  return new;
end;
$$;

revoke execute on function public.sessions_guard() from public, anon, authenticated, service_role;
