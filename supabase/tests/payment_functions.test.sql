-- Payment SQL functions used by the Edge Functions (Task 5). Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(56);

-- ---------------------------------------------------------------------------
-- Fixtures: kiosk A 22222222-..., kiosk B 33333333-...
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('22222222-2222-2222-2222-222222222222', 'pf-kiosk-a@test.local', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'pf-kiosk-b@test.local', 'authenticated', 'authenticated');
insert into public.profiles (user_id, role) values
  ('22222222-2222-2222-2222-222222222222', 'kiosk'),
  ('33333333-3333-3333-3333-333333333333', 'kiosk');
insert into public.templates (id, name, layout, overlay_path) values
  ('dddddddd-0000-0000-0000-000000000001', 'Test strip', 'strip_2x6', 'test-strip.png');

-- ---------------------------------------------------------------------------
-- Privileges: service role only
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.create_payment_session(uuid, uuid, uuid, text, integer, text, text)', 'execute'), 'anon cannot create_payment_session');
select ok(not has_function_privilege('authenticated', 'public.create_payment_session(uuid, uuid, uuid, text, integer, text, text)', 'execute'), 'authenticated cannot create_payment_session');
select ok(has_function_privilege('service_role', 'public.create_payment_session(uuid, uuid, uuid, text, integer, text, text)', 'execute'), 'service_role can create_payment_session');
select ok(not has_function_privilege('anon', 'public.mark_payment_paid(text, timestamptz)', 'execute'), 'anon cannot mark_payment_paid');
select ok(not has_function_privilege('authenticated', 'public.mark_payment_paid(text, timestamptz)', 'execute'), 'authenticated cannot mark_payment_paid');
select ok(has_function_privilege('service_role', 'public.mark_payment_paid(text, timestamptz)', 'execute'), 'service_role can mark_payment_paid');
select ok(not has_function_privilege('anon', 'public.mark_payment_paid_after_cancel(text, timestamptz)', 'execute'), 'anon cannot mark_payment_paid_after_cancel');
select ok(not has_function_privilege('authenticated', 'public.mark_payment_paid_after_cancel(text, timestamptz)', 'execute'), 'authenticated cannot mark_payment_paid_after_cancel');
select ok(has_function_privilege('service_role', 'public.mark_payment_paid_after_cancel(text, timestamptz)', 'execute'), 'service_role can mark_payment_paid_after_cancel');
select ok(not has_function_privilege('anon', 'public.cancel_payment(uuid, uuid)', 'execute'), 'anon cannot cancel_payment');
select ok(not has_function_privilege('authenticated', 'public.cancel_payment(uuid, uuid)', 'execute'), 'authenticated cannot cancel_payment');
select ok(has_function_privilege('service_role', 'public.cancel_payment(uuid, uuid)', 'execute'), 'service_role can cancel_payment');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select public.cancel_payment('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222') $$,
  '42501', null, 'a kiosk JWT cannot call cancel_payment');
select throws_ok(
  $$ select public.mark_payment_paid('pi_x', now()) $$,
  '42501', null, 'a kiosk JWT cannot call mark_payment_paid');
reset role;
-- What PostgREST sets for a service-role key: no sub, so auth.uid() is null.
set local request.jwt.claims = '{"role":"service_role"}';

-- ---------------------------------------------------------------------------
-- create_payment_session: session + payment in one transaction
-- ---------------------------------------------------------------------------
set local role service_role;

select isnt(
  public.create_payment_session('c0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
    'dddddddd-0000-0000-0000-000000000001', 'tokC1aaaaaaaaaaaaaaaaa', 15000, 'pi_c1', 'data:image/png;base64,AAAA'),
  null, 'create_payment_session returns the payment id');
select results_eq(
  $$ select kiosk_id, template_id, download_token, amount_centavos, status from public.sessions where id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid, 'dddddddd-0000-0000-0000-000000000001'::uuid, 'tokC1aaaaaaaaaaaaaaaaa'::text, 15000, 'awaiting_payment'::text) $$,
  'the session row is awaiting_payment with the server amount and the given kiosk');
select results_eq(
  $$ select provider_intent_id, amount_centavos, status, paid_at, qr_image from public.payments where session_id = 'c0000000-0000-0000-0000-000000000001' $$,
  $$ values ('pi_c1'::text, 15000, 'pending'::text, null::timestamptz, 'data:image/png;base64,AAAA'::text) $$,
  'the payment row is pending with the intent id and QR');
select throws_ok(
  $$ select public.create_payment_session('c0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
       'dddddddd-0000-0000-0000-000000000001', 'tokC9aaaaaaaaaaaaaaaaa', 15000, 'pi_c9', null) $$,
  '23505', null, 'a second create for the same session id fails');
select throws_ok(
  $$ select public.create_payment_session('c0000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222',
       'dddddddd-0000-0000-0000-000000000001', 'tokC9aaaaaaaaaaaaaaaaa', 15000, 'pi_c1', null) $$,
  '23505', null, 'a reused intent id fails');
select is((select count(*)::int from public.sessions where id = 'c0000000-0000-0000-0000-000000000009'), 0,
  'the failed create left no session behind (one transaction)');
select throws_ok(
  $$ select public.create_payment_session('c0000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222',
       'dddddddd-0000-0000-0000-000000000001', 'tokC8aaaaaaaaaaaaaaaaa', 1999, 'pi_c8', null) $$,
  '23514', null, 'an amount below 2000 centavos is rejected');
select throws_ok(
  $$ select public.create_payment_session('c0000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222',
       'dddddddd-0000-0000-0000-000000000001', 'tokC8aaaaaaaaaaaaaaaaa', 15000, 'pi_c8', 'https://example.com/qr.png') $$,
  '23514', null, 'qr_image must be an inline image');

-- Fixture payments for the state tests.
do $$
begin
  perform public.create_payment_session('c0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
    'dddddddd-0000-0000-0000-000000000001', 'tokC2aaaaaaaaaaaaaaaaa', 15000, 'pi_c2', null);
  perform public.create_payment_session('c0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
    'dddddddd-0000-0000-0000-000000000001', 'tokC3aaaaaaaaaaaaaaaaa', 15000, 'pi_c3', null);
  perform public.create_payment_session('c0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
    'dddddddd-0000-0000-0000-000000000001', 'tokC4aaaaaaaaaaaaaaaaa', 15000, 'pi_c4', null);
  perform public.create_payment_session('c0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222',
    'dddddddd-0000-0000-0000-000000000001', 'tokC5aaaaaaaaaaaaaaaaa', 15000, 'pi_c5', null);
end $$;
reset role;
update public.payments set status = 'failed' where provider_intent_id = 'pi_c5';
set local role service_role;

-- ---------------------------------------------------------------------------
-- mark_payment_paid
-- ---------------------------------------------------------------------------
select is(public.mark_payment_paid('pi_c1', '2026-11-12 01:00:00+00'), 'updated', 'pending -> updated');
select results_eq(
  $$ select p.status, p.paid_at, s.status from public.payments p join public.sessions s on s.id = p.session_id where p.provider_intent_id = 'pi_c1' $$,
  $$ values ('paid'::text, '2026-11-12 01:00:00+00'::timestamptz, 'paid'::text) $$,
  'payment paid with paid_at, session paid');
select is(public.mark_payment_paid('pi_c1', '2026-11-12 02:00:00+00'), 'not_pending', 'a second delivery is not_pending');
select is((select paid_at from public.payments where provider_intent_id = 'pi_c1'), '2026-11-12 01:00:00+00'::timestamptz,
  'a second delivery does not move paid_at');
select is(public.mark_payment_paid('pi_unknown', now()), 'not_found', 'unknown intent -> not_found');
select is(public.mark_payment_paid('pi_c5', '2026-11-12 01:00:00+00'), 'updated', 'failed -> updated (a failed QR Ph attempt can still be paid)');
select is((select status from public.sessions where id = 'c0000000-0000-0000-0000-000000000005'), 'paid', 'failed then paid: session paid');
select is(public.mark_payment_paid_after_cancel('pi_c1', now()), 'not_cancelled', 'paid_after_cancel does not touch a paid payment');
select is(public.mark_payment_paid_after_cancel('pi_c2', now()), 'not_cancelled', 'paid_after_cancel does not touch a pending payment');
select is((select status from public.payments where provider_intent_id = 'pi_c2'), 'pending', 'pending payment still pending');

-- ---------------------------------------------------------------------------
-- cancel_payment
-- ---------------------------------------------------------------------------
select is(public.cancel_payment((select id from public.payments where provider_intent_id = 'pi_c2'), '33333333-3333-3333-3333-333333333333'),
  'forbidden', 'another kiosk cannot cancel');
select is((select status from public.payments where provider_intent_id = 'pi_c2'), 'pending', 'forbidden cancel changed nothing');
select is(public.cancel_payment('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222'),
  'not_found', 'unknown payment -> not_found');
select is(public.cancel_payment((select id from public.payments where provider_intent_id = 'pi_c2'), '22222222-2222-2222-2222-222222222222'),
  'cancelled', 'pending -> cancelled');
select results_eq(
  $$ select p.status, s.status from public.payments p join public.sessions s on s.id = p.session_id where p.provider_intent_id = 'pi_c2' $$,
  $$ values ('cancelled'::text, 'cancelled'::text) $$,
  'payment and session cancelled');
select is(public.cancel_payment((select id from public.payments where provider_intent_id = 'pi_c2'), '22222222-2222-2222-2222-222222222222'),
  'not_pending', 'cancelling twice -> not_pending');
select is(public.cancel_payment((select id from public.payments where provider_intent_id = 'pi_c1'), '22222222-2222-2222-2222-222222222222'),
  'not_pending', 'cancel of a paid payment -> not_pending');
select results_eq(
  $$ select p.status, s.status from public.payments p join public.sessions s on s.id = p.session_id where p.provider_intent_id = 'pi_c1' $$,
  $$ values ('paid'::text, 'paid'::text) $$,
  'paid stays paid after a cancel');
select is(public.cancel_payment((select id from public.payments where provider_intent_id = 'pi_c1'), '33333333-3333-3333-3333-333333333333'),
  'forbidden', 'another kiosk gets forbidden even for a paid payment');

-- ---------------------------------------------------------------------------
-- cancelled, then the late webhook
-- ---------------------------------------------------------------------------
select is(public.mark_payment_paid('pi_c2', '2026-11-12 03:00:00+00'), 'not_pending', 'mark_payment_paid does not touch a cancelled payment');
select is((select status from public.payments where provider_intent_id = 'pi_c2'), 'cancelled', 'still cancelled after mark_payment_paid');
select is(public.mark_payment_paid_after_cancel('pi_c2', '2026-11-12 03:00:00+00'), 'updated', 'cancelled -> paid_after_cancel');
select results_eq(
  $$ select p.status, p.paid_at, s.status from public.payments p join public.sessions s on s.id = p.session_id where p.provider_intent_id = 'pi_c2' $$,
  $$ values ('paid'::text, '2026-11-12 03:00:00+00'::timestamptz, 'paid_after_cancel'::text) $$,
  'payment paid, session paid_after_cancel');
select is(public.mark_payment_paid_after_cancel('pi_c2', '2026-11-12 04:00:00+00'), 'not_cancelled', 'second late delivery -> not_cancelled');
select is((select paid_at from public.payments where provider_intent_id = 'pi_c2'), '2026-11-12 03:00:00+00'::timestamptz,
  'second late delivery does not move paid_at');
select is(public.cancel_payment((select id from public.payments where provider_intent_id = 'pi_c2'), '22222222-2222-2222-2222-222222222222'),
  'not_pending', 'cancel after paid_after_cancel -> not_pending');
select is((select status from public.sessions where id = 'c0000000-0000-0000-0000-000000000002'), 'paid_after_cancel',
  'session stays paid_after_cancel');

-- ---------------------------------------------------------------------------
-- Session already completed by the kiosk: paid does not rewrite its status
-- ---------------------------------------------------------------------------
reset role;
update public.payments set status = 'paid', paid_at = now() where provider_intent_id = 'pi_c3';
update public.sessions set status = 'completed' where id = 'c0000000-0000-0000-0000-000000000003';
set local role service_role;
select is(public.mark_payment_paid('pi_c3', now()), 'not_pending', 'paid payment of a completed session: not_pending');
select is((select status from public.sessions where id = 'c0000000-0000-0000-0000-000000000003'), 'completed', 'completed session untouched');

-- ---------------------------------------------------------------------------
-- The kiosk reads only its own payments (status poll) and cannot write payments or cancel sessions itself
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.payments where provider_intent_id = 'pi_c4'), 0, 'kiosk B cannot see kiosk A payment');
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select status from public.payments where provider_intent_id = 'pi_c4'), 'pending', 'kiosk A reads its own payment status');
select throws_ok(
  $$ update public.payments set status = 'paid' where provider_intent_id = 'pi_c4' $$,
  '42501', null, 'kiosk cannot update payments');
select throws_ok(
  $$ update public.sessions set status = 'cancelled' where id = 'c0000000-0000-0000-0000-000000000004' $$,
  'P0001', 'kiosk may only set status free or completed', 'kiosk cannot cancel a session itself');
reset role;

-- ---------------------------------------------------------------------------
-- Guard still applies to the service role for immutable columns
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"role":"service_role"}';
set local role service_role;
select throws_ok(
  $$ update public.sessions set kiosk_id = '33333333-3333-3333-3333-333333333333' where id = 'c0000000-0000-0000-0000-000000000004' $$,
  'P0001', 'sessions.id and sessions.kiosk_id are immutable', 'kiosk_id stays immutable for the service role');
reset role;

select * from finish();
rollback;
