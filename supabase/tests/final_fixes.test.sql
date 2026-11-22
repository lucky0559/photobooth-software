-- Final fix wave: kiosk completion of a paid_after_cancel session (20261111000005, R18) and the admin-only
-- payments.refunded_at column (20261111000006, R20).
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner, bypassing RLS)
-- admin 11111111-..., kiosk 22222222-..., no profile 44444444-...
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'admin@test.local',  'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'kiosk-a@test.local', 'authenticated', 'authenticated'),
  ('44444444-4444-4444-4444-444444444444', 'nobody@test.local', 'authenticated', 'authenticated');

insert into public.profiles (user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'kiosk');

insert into public.templates (id, name, layout, overlay_path) values
  ('dddddddd-0000-0000-0000-000000000001', 'Test strip', 'strip_2x6', 'templates/test-strip.png');

insert into public.sessions (id, kiosk_id, template_id, download_token, amount_centavos, status) values
  -- F1: paid during the cancel retry window; payment paid 17500
  ('f0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokF1fffffffffffffffff', 17500, 'paid_after_cancel'),
  -- F2: paid_after_cancel whose payment is (somehow) still pending
  ('f0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokF2fffffffffffffffff', 15000, 'paid_after_cancel'),
  -- F3: paid_after_cancel whose payment is cancelled
  ('f0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokF3fffffffffffffffff', 15000, 'paid_after_cancel'),
  -- F4: cancelled, payment cancelled
  ('f0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokF4fffffffffffffffff', 15000, 'cancelled'),
  -- F5: normal paid session (amount self-heal)
  ('f0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokF5fffffffffffffffff', 17500, 'paid'),
  -- F6: free session (no payment)
  ('f0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokF6fffffffffffffffff', 0, 'free'),
  -- F7: paid_after_cancel, used for "anything but completed" and the service-role exemption
  ('f0000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokF7fffffffffffffffff', 15000, 'paid_after_cancel');

insert into public.payments (id, session_id, provider_intent_id, amount_centavos, status) values
  ('e0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'pi_f1', 17500, 'paid'),
  ('e0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002', 'pi_f2', 15000, 'pending'),
  ('e0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000003', 'pi_f3', 15000, 'cancelled'),
  ('e0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000004', 'pi_f4', 15000, 'cancelled'),
  ('e0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000005', 'pi_f5', 17500, 'paid'),
  ('e0000000-0000-0000-0000-000000000007', 'f0000000-0000-0000-0000-000000000007', 'pi_f7', 15000, 'paid');

-- ===========================================================================
-- Kiosk: paid_after_cancel -> completed (R18)
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- The kiosk re-sends its cached (stale) price: the stored amount is kept and the completion check passes.
select lives_ok(
  $$ update public.sessions set status = 'completed', amount_centavos = 15000, completed_at = now()
      where id = 'f0000000-0000-0000-0000-000000000001' $$,
  'kiosk can complete a paid_after_cancel session whose payment is paid');

select results_eq(
  $$ select status, amount_centavos from public.sessions where id = 'f0000000-0000-0000-0000-000000000001' $$,
  $$ values ('completed'::text, 17500) $$,
  'paid_after_cancel -> completed keeps the server amount');

select throws_ok(
  $$ update public.sessions set status = 'completed' where id = 'f0000000-0000-0000-0000-000000000002' $$,
  'P0001', 'completed session amount must match its paid payment',
  'kiosk cannot complete a paid_after_cancel session whose payment is pending');

select throws_ok(
  $$ update public.sessions set status = 'completed' where id = 'f0000000-0000-0000-0000-000000000003' $$,
  'P0001', 'completed session amount must match its paid payment',
  'kiosk cannot complete a paid_after_cancel session whose payment is cancelled');

select throws_ok(
  $$ update public.sessions set status = 'free' where id = 'f0000000-0000-0000-0000-000000000007' $$,
  'P0001', 'kiosk may not change the status of a cancelled session',
  'kiosk cannot move paid_after_cancel to anything but completed');

select throws_ok(
  $$ update public.sessions set status = 'completed' where id = 'f0000000-0000-0000-0000-000000000004' $$,
  'P0001', 'kiosk may not change the status of a cancelled session',
  'kiosk still cannot complete a cancelled session');

select results_eq(
  $$ select status from public.sessions where id in ('f0000000-0000-0000-0000-000000000002',
       'f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000004',
       'f0000000-0000-0000-0000-000000000007') order by id $$,
  $$ values ('paid_after_cancel'::text), ('paid_after_cancel'::text), ('cancelled'::text), ('paid_after_cancel'::text) $$,
  'rejected updates left the statuses alone');

-- Amount self-heal (20261111000003) still works on the normal paid -> completed path.
select lives_ok(
  $$ update public.sessions set status = 'completed', amount_centavos = 9999 where id = 'f0000000-0000-0000-0000-000000000005' $$,
  'kiosk completes a paid session with a stale amount');

select results_eq(
  $$ select status, amount_centavos from public.sessions where id = 'f0000000-0000-0000-0000-000000000005' $$,
  $$ values ('completed'::text, 17500) $$,
  'stale kiosk amount is healed to the stored amount');

select throws_ok(
  $$ update public.sessions set amount_centavos = 2000 where id = 'f0000000-0000-0000-0000-000000000006' $$,
  'P0001', 'kiosk may not change amount_centavos',
  'a session without a payment still rejects an amount change');

-- Kiosk and refunded_at (R20)
select results_eq(
  $$ with u as (update public.payments set refunded_at = now()
                 where id = 'e0000000-0000-0000-0000-000000000007' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'kiosk cannot set refunded_at (no row passes the admin policy)');

select throws_ok(
  $$ update public.payments set status = 'cancelled' where id = 'e0000000-0000-0000-0000-000000000007' $$,
  '42501', null, 'kiosk still cannot update payment status');

-- ===========================================================================
-- Admin: refunded_at only (R20)
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select results_eq(
  $$ with u as (update public.payments set refunded_at = '2026-11-12T05:00:00Z'
                 where id = 'e0000000-0000-0000-0000-000000000007' returning refunded_at)
     select refunded_at from u $$,
  $$ values ('2026-11-12T05:00:00Z'::timestamptz) $$,
  'admin can set refunded_at');

select results_eq(
  $$ with u as (update public.payments set refunded_at = null
                 where id = 'e0000000-0000-0000-0000-000000000007' returning refunded_at)
     select count(*)::int from u where refunded_at is null $$,
  $$ values (1) $$,
  'admin can clear refunded_at (undo)');

select throws_ok(
  $$ update public.payments set status = 'cancelled' where id = 'e0000000-0000-0000-0000-000000000007' $$,
  '42501', null, 'admin cannot change payment status');

select throws_ok(
  $$ update public.payments set amount_centavos = 1 where id = 'e0000000-0000-0000-0000-000000000007' $$,
  '42501', null, 'admin cannot change payment amount');

select throws_ok(
  $$ update public.payments set provider_intent_id = 'pi_evil' where id = 'e0000000-0000-0000-0000-000000000007' $$,
  '42501', null, 'admin cannot change provider_intent_id');

select throws_ok(
  $$ update public.payments set refunded_at = now() where id = 'e0000000-0000-0000-0000-000000000002' $$,
  '23514', null, 'refunded_at is only allowed on a paid payment');

select throws_ok(
  $$ delete from public.payments where id = 'e0000000-0000-0000-0000-000000000007' $$,
  '42501', null, 'admin still cannot delete payments');

-- ===========================================================================
-- Anon and a user without a profile
-- ===========================================================================
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ update public.payments set refunded_at = now() $$,
  '42501', null, 'anon cannot update refunded_at');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select results_eq(
  $$ with u as (update public.payments set refunded_at = now() returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'a user without a profile cannot set refunded_at');

-- ===========================================================================
-- Service role stays exempt from the kiosk rules
-- ===========================================================================
reset role;
set local role service_role;

select lives_ok(
  $$ update public.sessions set status = 'cancelled' where id = 'f0000000-0000-0000-0000-000000000007' $$,
  'service role can still change a paid_after_cancel session');

select * from finish();
rollback;
