-- RLS, trigger and storage checks for the photobooth schema.
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(72);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner, bypassing RLS)
-- admin  11111111-..., kiosk A 22222222-..., kiosk B 33333333-...
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('11111111-1111-1111-1111-111111111111', 'admin@test.local',  'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'kiosk-a@test.local', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', 'kiosk-b@test.local', 'authenticated', 'authenticated');

insert into public.profiles (user_id, role) values
  ('11111111-1111-1111-1111-111111111111', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'kiosk'),
  ('33333333-3333-3333-3333-333333333333', 'kiosk');

insert into public.templates (id, name, layout, overlay_path) values
  ('dddddddd-0000-0000-0000-000000000001', 'Test strip', 'strip_2x6', 'templates/test-strip.png'),
  ('dddddddd-0000-0000-0000-000000000002', 'Test 4R', 'print_4r', 'test-4r.png');

insert into public.sessions (id, kiosk_id, template_id, download_token, amount_centavos, status) values
  -- A1: paid 15000, used for column updates and completion
  ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokA1aaaaaaaaaaaaaaaaa', 15000, 'awaiting_payment'),
  -- A2: no payment, set to free
  ('a0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokA2aaaaaaaaaaaaaaaaa', 15000, 'awaiting_payment'),
  -- A3: payment amount differs from session amount
  ('a0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokA3aaaaaaaaaaaaaaaaa', 15000, 'awaiting_payment'),
  -- A4: payment still pending
  ('a0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokA4aaaaaaaaaaaaaaaaa', 15000, 'awaiting_payment'),
  -- A6: paid 15000, completed through the kiosk's upsert
  ('a0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokA6aaaaaaaaaaaaaaaaa', 15000, 'awaiting_payment'),
  -- A8: paid after the guest cancelled (operator must refund)
  ('a0000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokA8aaaaaaaaaaaaaaaaa', 15000, 'paid_after_cancel'),
  -- A9: cancelled
  ('a0000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 'dddddddd-0000-0000-0000-000000000001', 'tokA9aaaaaaaaaaaaaaaaa', 15000, 'cancelled'),
  -- B1: kiosk B's session with a payment
  ('b0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'dddddddd-0000-0000-0000-000000000001', 'tokB1bbbbbbbbbbbbbbbbb', 15000, 'awaiting_payment'),
  -- B2: kiosk B's session with no photo yet
  ('b0000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'dddddddd-0000-0000-0000-000000000001', 'tokB2bbbbbbbbbbbbbbbbb', 0, 'free');

insert into public.payments (session_id, provider_intent_id, amount_centavos, status) values
  ('a0000000-0000-0000-0000-000000000001', 'pi_a1', 15000, 'paid'),
  ('a0000000-0000-0000-0000-000000000003', 'pi_a3', 20000, 'paid'),
  ('a0000000-0000-0000-0000-000000000004', 'pi_a4', 15000, 'pending'),
  ('a0000000-0000-0000-0000-000000000006', 'pi_a6', 15000, 'paid'),
  ('a0000000-0000-0000-0000-000000000008', 'pi_a8', 15000, 'paid'),
  ('b0000000-0000-0000-0000-000000000001', 'pi_b1', 15000, 'paid');

insert into storage.objects (bucket_id, name) values
  ('templates', 'templates/test-strip.png'),
  ('photos', 'b0000000-0000-0000-0000-000000000001.jpg');

-- ===========================================================================
-- Kiosk A
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

-- Brief check 1
select results_eq(
  $$ select count(*)::int from public.settings $$, $$ values (1) $$,
  'kiosk can select settings (1 row)');

-- Brief check 2
select results_eq(
  $$ with u as (update public.settings set price_centavos = 1 returning 1) select count(*)::int from u $$,
  $$ values (0) $$,
  'kiosk update of settings affects 0 rows');

-- Brief check 4
select is(
  (select count(*)::int from public.sessions where kiosk_id = '33333333-3333-3333-3333-333333333333'),
  0, 'kiosk A cannot see kiosk B sessions');

-- Brief check 5
select is(
  (select count(*)::int from public.payments where session_id = 'b0000000-0000-0000-0000-000000000001'),
  0, 'kiosk A cannot see payments of kiosk B sessions');

-- Brief check 6
select throws_ok(
  $$ update public.sessions set status = 'paid' where id = 'a0000000-0000-0000-0000-000000000001' $$,
  'P0001', 'kiosk may only set status free or completed',
  'kiosk cannot set its own session to paid');

-- R3: non-status columns are writable without a status change
select results_eq(
  $$ with u as (
       update public.sessions
          set print_error = 'paper jam', completed_at = now(),
              photo_path = 'a0000000-0000-0000-0000-000000000001.jpg'
        where id = 'a0000000-0000-0000-0000-000000000001'
       returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'kiosk can update print_error, completed_at and photo_path on its own session');

select results_eq(
  $$ with u as (update public.sessions set status = 'completed'
                 where id = 'a0000000-0000-0000-0000-000000000001' returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'kiosk can set its own paid session to completed');

select results_eq(
  $$ with u as (update public.sessions set status = 'free'
                 where id = 'a0000000-0000-0000-0000-000000000002' returning 1)
     select count(*)::int from u $$,
  $$ values (1) $$,
  'kiosk can set its own session to free');

select lives_ok(
  $$ insert into public.sessions (id, template_id, download_token, amount_centavos, status, created_at, completed_at)
     values ('a0000000-0000-0000-0000-000000000006', 'dddddddd-0000-0000-0000-000000000001',
             'tokA6aaaaaaaaaaaaaaaaa', 15000, 'completed', now(), now())
     on conflict (id) do update set
       template_id = excluded.template_id, download_token = excluded.download_token,
       amount_centavos = excluded.amount_centavos, status = excluded.status,
       print_error = excluded.print_error, created_at = excluded.created_at,
       completed_at = excluded.completed_at $$,
  'kiosk upsert completes an existing paid session (kiosk app flow)');

select lives_ok(
  $$ insert into public.sessions (id, template_id, download_token, amount_centavos, status, created_at, completed_at)
     values ('a0000000-0000-0000-0000-000000000006', 'dddddddd-0000-0000-0000-000000000001',
             'tokA6aaaaaaaaaaaaaaaaa', 15000, 'completed', now(), now())
     on conflict (id) do update set
       template_id = excluded.template_id, download_token = excluded.download_token,
       amount_centavos = excluded.amount_centavos, status = excluded.status,
       print_error = excluded.print_error, created_at = excluded.created_at,
       completed_at = excluded.completed_at $$,
  'kiosk can re-upsert an identical row (offline queue retry)');

-- Fix round 1: frozen and validated columns
select results_eq(
  $$ with i as (
       insert into public.sessions (id, template_id, download_token, amount_centavos, status, created_at)
       values ('a0000000-0000-0000-0000-0000000000a7', 'dddddddd-0000-0000-0000-000000000001',
               'tokAa7aaaaaaaaaaaaaaaa', 0, 'free', '2099-01-01T00:00:00Z')
       returning created_at)
     select created_at = now() from i $$,
  $$ values (true) $$,
  'a future created_at on kiosk insert is clamped to now()');

select results_eq(
  $$ with u as (update public.sessions set created_at = '2000-01-01T00:00:00Z'
                 where id = 'a0000000-0000-0000-0000-000000000002' returning created_at)
     select created_at = now() from u $$,
  $$ values (true) $$,
  'kiosk update keeps the stored created_at');

select throws_ok(
  $$ update public.sessions set download_token = 'tokZZZZZZZZZZZZZZZZZZZ' where id = 'a0000000-0000-0000-0000-000000000002' $$,
  'P0001', 'kiosk may not change download_token or template_id',
  'kiosk cannot change download_token');

select throws_ok(
  $$ update public.sessions set template_id = 'dddddddd-0000-0000-0000-000000000002' where id = 'a0000000-0000-0000-0000-000000000002' $$,
  'P0001', 'kiosk may not change download_token or template_id',
  'kiosk cannot change template_id');

select throws_ok(
  $$ insert into public.sessions (id, template_id, download_token, amount_centavos, status)
     values ('a0000000-0000-0000-0000-0000000000a8', 'dddddddd-0000-0000-0000-000000000001', 'short', 0, 'free') $$,
  '23514', null,
  'download_token must be 22 base64url characters');

select throws_ok(
  $$ update public.sessions set photo_path = 'b0000000-0000-0000-0000-000000000001.jpg'
      where id = 'a0000000-0000-0000-0000-000000000002' $$,
  '23514', null,
  'photo_path must be <session id>.jpg');

select throws_ok(
  $$ update public.sessions set print_error = repeat('x', 1001) where id = 'a0000000-0000-0000-0000-000000000002' $$,
  '23514', null,
  'print_error is capped at 1000 characters');

-- Fix round 1: server-owned statuses. Final fix wave (R18): a paid_after_cancel session whose payment is paid for
-- the session amount was served by the kiosk and may be completed (more cases in final_fixes.test.sql).
select lives_ok(
  $$ update public.sessions set status = 'completed' where id = 'a0000000-0000-0000-0000-000000000008' $$,
  'kiosk can complete a paid_after_cancel session whose payment is paid');

select is(
  (select status from public.sessions where id = 'a0000000-0000-0000-0000-000000000008'), 'completed',
  'paid_after_cancel session is now completed');

select throws_ok(
  $$ update public.sessions set status = 'free' where id = 'a0000000-0000-0000-0000-000000000009' $$,
  'P0001', 'kiosk may not change the status of a cancelled session',
  'kiosk cannot set a cancelled session to free');

select throws_ok(
  $$ update public.sessions set status = 'free' where id = 'a0000000-0000-0000-0000-000000000004' $$,
  'P0001', 'kiosk may not set a session with a payment to free',
  'kiosk cannot set an awaiting_payment session with a payment to free');

select throws_ok(
  $$ delete from public.sessions where id = 'a0000000-0000-0000-0000-000000000002' $$,
  '42501', null,
  'kiosk cannot delete its own session');

-- Rule 1: amount_centavos
select throws_ok(
  $$ update public.sessions set amount_centavos = 2000 where id = 'a0000000-0000-0000-0000-000000000002' $$,
  'P0001', 'kiosk may not change amount_centavos',
  'kiosk cannot change amount_centavos');

select throws_ok(
  $$ update public.sessions set status = 'completed' where id = 'a0000000-0000-0000-0000-000000000003' $$,
  'P0001', 'completed session amount must match its paid payment',
  'kiosk cannot complete a session whose amount differs from its payment');

select throws_ok(
  $$ update public.sessions set status = 'completed' where id = 'a0000000-0000-0000-0000-000000000004' $$,
  'P0001', 'completed session amount must match its paid payment',
  'kiosk cannot complete a session whose payment is not paid');

select throws_ok(
  $$ insert into public.sessions (id, template_id, download_token, amount_centavos, status)
     values ('a0000000-0000-0000-0000-0000000000a1', 'dddddddd-0000-0000-0000-000000000001',
             'tokAa1aaaaaaaaaaaaaaaa', 100001, 'completed') $$,
  '23514', null,
  'kiosk cannot insert a session above 100000 centavos');

select throws_ok(
  $$ insert into public.sessions (id, template_id, download_token, amount_centavos, status)
     values ('a0000000-0000-0000-0000-0000000000a2', 'dddddddd-0000-0000-0000-000000000001',
             'tokAa2aaaaaaaaaaaaaaaa', -1, 'free') $$,
  '23514', null,
  'kiosk cannot insert a negative amount');

select throws_ok(
  $$ insert into public.sessions (id, template_id, download_token, amount_centavos, status)
     values ('a0000000-0000-0000-0000-0000000000a3', 'dddddddd-0000-0000-0000-000000000001',
             'tokAa3aaaaaaaaaaaaaaaa', 15000, 'paid') $$,
  'P0001', 'kiosk may only insert status awaiting_payment, free or completed',
  'kiosk cannot insert a paid session');

select lives_ok(
  $$ insert into public.sessions (id, template_id, download_token, amount_centavos, status)
     values ('a0000000-0000-0000-0000-0000000000a4', 'dddddddd-0000-0000-0000-000000000001',
             'tokAa4aaaaaaaaaaaaaaaa', 15000, 'completed') $$,
  'kiosk can insert its own completed session (kiosk_id defaults to auth.uid())');

select results_eq(
  $$ select kiosk_id from public.sessions where id = 'a0000000-0000-0000-0000-0000000000a4' $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid) $$,
  'inserted session got kiosk_id = auth.uid()');

-- Rule 2: kiosk_id
select throws_ok(
  $$ update public.sessions set kiosk_id = '33333333-3333-3333-3333-333333333333'
      where id = 'a0000000-0000-0000-0000-000000000002' $$,
  'P0001', 'sessions.id and sessions.kiosk_id are immutable',
  'kiosk cannot reassign kiosk_id');

select throws_ok(
  $$ insert into public.sessions (id, kiosk_id, template_id, download_token, amount_centavos, status)
     values ('a0000000-0000-0000-0000-0000000000a5', '33333333-3333-3333-3333-333333333333',
             'dddddddd-0000-0000-0000-000000000001', 'tokAa5aaaaaaaaaaaaaaaa', 15000, 'free') $$,
  '42501', null,
  'kiosk cannot insert a session for another kiosk');

select results_eq(
  $$ with u as (update public.sessions set print_error = 'x'
                 where id = 'b0000000-0000-0000-0000-000000000001' returning 1)
     select count(*)::int from u $$,
  $$ values (0) $$,
  'kiosk cannot update another kiosk''s session');

-- Rule 3: settings writes
select throws_ok(
  $$ insert into public.settings (id) values (2) $$,
  '42501', null, 'kiosk cannot insert settings');

-- Rule 4: payments
select results_eq(
  $$ select provider_intent_id from public.payments where session_id = 'a0000000-0000-0000-0000-000000000001' $$,
  $$ values ('pi_a1'::text) $$,
  'kiosk can see the payment of its own session');

select throws_ok(
  $$ insert into public.payments (session_id, provider_intent_id, amount_centavos, status)
     values ('a0000000-0000-0000-0000-000000000002', 'pi_x', 1, 'paid') $$,
  '42501', null, 'kiosk cannot insert payments');

select throws_ok(
  $$ update public.payments set status = 'paid' where session_id = 'a0000000-0000-0000-0000-000000000004' $$,
  '42501', null, 'kiosk cannot update payments');

-- Rule 5: profiles
select results_eq(
  $$ select user_id from public.profiles $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid) $$,
  'kiosk sees only its own profile');

select throws_ok(
  $$ update public.profiles set role = 'admin' $$,
  '42501', null, 'kiosk cannot update profiles');

-- templates table
select throws_ok(
  $$ insert into public.templates (name, layout, overlay_path) values ('x', 'strip_2x6', 'x.png') $$,
  '42501', null, 'kiosk cannot insert templates');

-- Rule 6: storage
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('photos', 'a0000000-0000-0000-0000-000000000001.jpg', '22222222-2222-2222-2222-222222222222') $$,
  'kiosk can upload <own session id>.jpg');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('photos', 'b0000000-0000-0000-0000-000000000002.jpg', '22222222-2222-2222-2222-222222222222') $$,
  '42501', null, 'kiosk cannot upload to another kiosk''s session name');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('photos', 'nested/a0000000-0000-0000-0000-000000000002.jpg', '22222222-2222-2222-2222-222222222222') $$,
  '42501', null, 'kiosk cannot upload a photo under any other name');

select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'photos' and name <> 'a0000000-0000-0000-0000-000000000001.jpg'),
  0, 'kiosk cannot read other kiosks'' photos');

-- Deviation (see migration): storage-api's upsert needs SELECT on the written row.
select results_eq(
  $$ select name from storage.objects where bucket_id = 'photos' $$,
  $$ values ('a0000000-0000-0000-0000-000000000001.jpg'::text) $$,
  'kiosk can read back only the photo of its own session');

-- storage-api sets this flag for its own deletes; set it so RLS alone decides.
set local storage.allow_delete_query = 'true';
select results_eq(
  $$ with d as (delete from storage.objects
                 where bucket_id = 'photos' and name = 'a0000000-0000-0000-0000-000000000001.jpg' returning 1)
     select count(*)::int from d $$,
  $$ values (0) $$,
  'kiosk cannot delete its own photo object');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'templates'),
  1, 'kiosk can read template overlays');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('templates', 'templates/evil.png') $$,
  '42501', null, 'kiosk cannot upload template overlays');

-- ===========================================================================
-- Admin
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- Brief check 3
select results_eq(
  $$ with u as (update public.settings set price_centavos = 20000 returning 1) select count(*)::int from u $$,
  $$ values (1) $$,
  'admin update of settings affects 1 row');

select throws_ok(
  $$ update public.settings set price_centavos = 1999 $$,
  '23514', null, 'settings price below 2000 is rejected');

select throws_ok(
  $$ update public.settings set countdown_seconds = 4 $$,
  '23514', null, 'settings countdown_seconds outside (3,5,10) is rejected');

select throws_ok(
  $$ delete from public.settings $$,
  '42501', null, 'admin cannot delete settings');

select throws_ok(
  $$ insert into public.settings (id) values (1) on conflict do nothing $$,
  '42501', null, 'admin cannot insert settings');

select throws_ok(
  $$ update public.settings set price_centavos = 100001 $$,
  '23514', null, 'settings price above 100000 is rejected');

select throws_ok(
  $$ update public.settings set shots_per_session = 5 $$,
  '23514', null, 'settings shots_per_session 5 is rejected');

select throws_ok(
  $$ update public.settings set copies_per_session = 5 $$,
  '23514', null, 'settings copies_per_session 5 is rejected');

select throws_ok(
  $$ update public.settings set link_expiry_days = 0 $$,
  '23514', null, 'settings link_expiry_days 0 is rejected');

select throws_ok(
  $$ update public.settings set link_expiry_days = 31 $$,
  '23514', null, 'settings link_expiry_days 31 is rejected');

select is(
  (select count(*)::int from public.payments), 6, 'admin sees all payments');

select is(
  (select count(*)::int from storage.objects where bucket_id = 'photos'), 2, 'admin can read photos');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('templates', 'templates/new.png') $$,
  'admin can upload template overlays');

-- ===========================================================================
-- Anon
-- ===========================================================================
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

-- Brief check 7
select is((select count(*)::int from public.sessions), 0, 'anon sees no sessions');

select is(
  (select (select count(*) from public.settings) + (select count(*) from public.templates)
        + (select count(*) from public.payments) + (select count(*) from public.profiles))::int,
  0, 'anon sees no settings, templates, payments or profiles');

select is(
  (select count(*)::int from storage.objects where bucket_id in ('templates', 'photos')),
  0, 'anon cannot read templates or photos objects');

select throws_ok(
  $$ select public.is_admin() $$,
  '42501', null, 'anon cannot execute is_admin()');

-- ===========================================================================
-- Signed-in user with no profile row
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select results_eq(
  $$ select public.is_admin(), public.is_kiosk(),
            (select count(*)::int from public.settings) + (select count(*)::int from public.sessions) $$,
  $$ values (false, false, 0) $$,
  'a user without a profile is neither admin nor kiosk and sees nothing');

-- ===========================================================================
-- Catalog checks
-- ===========================================================================
reset role;

select ok(
  (select bool_and(p.prosecdef and 'search_path=public' = any(p.proconfig))
     from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('is_admin', 'is_kiosk')),
  'is_admin() and is_kiosk() are security definer with search_path = public');

select ok(
  not has_function_privilege('anon', 'public.is_admin()', 'execute')
  and not has_function_privilege('anon', 'public.is_kiosk()', 'execute')
  and not has_function_privilege('service_role', 'public.is_admin()', 'execute')
  and not has_function_privilege('service_role', 'public.is_kiosk()', 'execute')
  and has_function_privilege('authenticated', 'public.is_admin()', 'execute')
  and has_function_privilege('authenticated', 'public.is_kiosk()', 'execute'),
  'is_admin()/is_kiosk() execute is granted only to authenticated');

select results_eq(
  $$ select id, public from storage.buckets where id in ('photos', 'templates') order by id $$,
  $$ values ('photos'::text, false), ('templates'::text, false) $$,
  'photos and templates buckets exist and are private');

select col_is_unique('public', 'payments', 'provider_intent_id', 'payments.provider_intent_id is unique');

select col_is_unique('public', 'sessions', 'download_token', 'sessions.download_token is unique');

select has_index('public', 'sessions', 'sessions_created_at_idx', 'sessions(created_at desc) index exists');

select * from finish();
rollback;
