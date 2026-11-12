-- Template integrity (migration 20261111000004): the active template can never be archived, settings never point at
-- an archived template, and template names are 1 to 60 characters.
-- Run with: supabase test db
begin;
create extension if not exists pgtap with schema extensions;

select plan(23);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, aud, role) values
  ('51111111-1111-1111-1111-111111111111', 'ti-admin@test.local', 'authenticated', 'authenticated');
insert into public.profiles (user_id, role) values
  ('51111111-1111-1111-1111-111111111111', 'admin');

insert into public.templates (id, name, layout, overlay_path) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'TI one',   'strip_2x6', 'ti-one.png'),
  ('eeeeeeee-0000-0000-0000-000000000002', 'TI two',   'print_4r',  'ti-two.png'),
  ('eeeeeeee-0000-0000-0000-000000000003', 'TI three', 'strip_2x6', 'ti-three.png');
insert into public.templates (id, name, layout, overlay_path, archived) values
  ('eeeeeeee-0000-0000-0000-000000000004', 'TI archived', 'strip_2x6', 'ti-archived.png', true);

update public.settings set active_template_id = 'eeeeeeee-0000-0000-0000-000000000001' where id = 1;

-- ---------------------------------------------------------------------------
-- Admin (RLS)
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"51111111-1111-1111-1111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ update public.templates set archived = true where id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  '23514', 'active template cannot be archived', 'admin cannot archive the active template');

select throws_ok(
  $$ update public.settings set active_template_id = 'eeeeeeee-0000-0000-0000-000000000004' where id = 1 $$,
  '23514', 'active template must not be archived', 'admin cannot make an archived template active');

select lives_ok(
  $$ update public.templates set archived = true where id = 'eeeeeeee-0000-0000-0000-000000000003' $$,
  'admin can archive a template that is not active');

select lives_ok(
  $$ update public.settings set active_template_id = 'eeeeeeee-0000-0000-0000-000000000002' where id = 1 $$,
  'admin can switch the active template');

select lives_ok(
  $$ update public.templates set archived = true where id = 'eeeeeeee-0000-0000-0000-000000000001' $$,
  'admin can archive the previously active template after switching');

select is(
  (select active_template_id from public.settings where id = 1),
  'eeeeeeee-0000-0000-0000-000000000002'::uuid,
  'active template is the switched one');

select lives_ok(
  $$ update public.settings set price_centavos = 16000 where id = 1 $$,
  'unrelated settings updates still work');

select lives_ok(
  $$ update public.templates set name = 'TI two renamed' where id = 'eeeeeeee-0000-0000-0000-000000000002' $$,
  'admin can rename the active template');

select lives_ok(
  $$ update public.settings set active_template_id = null where id = 1 $$,
  'admin can clear the active template');

reset role;

-- ---------------------------------------------------------------------------
-- Service role (bypasses RLS, triggers still apply)
-- ---------------------------------------------------------------------------
update public.settings set active_template_id = 'eeeeeeee-0000-0000-0000-000000000002' where id = 1;

set local role service_role;
select throws_ok(
  $$ update public.templates set archived = true where id = 'eeeeeeee-0000-0000-0000-000000000002' $$,
  '23514', 'active template cannot be archived', 'service role cannot archive the active template');

select throws_ok(
  $$ update public.settings set active_template_id = 'eeeeeeee-0000-0000-0000-000000000004' where id = 1 $$,
  '23514', 'active template must not be archived', 'service role cannot make an archived template active');
reset role;

-- ---------------------------------------------------------------------------
-- Name length
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.templates (name, layout, overlay_path) values (repeat('x', 61), 'strip_2x6', 'long.png') $$,
  '23514', null, 'template name longer than 60 characters is rejected');

select throws_ok(
  $$ insert into public.templates (name, layout, overlay_path) values ('', 'strip_2x6', 'empty.png') $$,
  '23514', null, 'empty template name is rejected');

select lives_ok(
  $$ insert into public.templates (name, layout, overlay_path) values (repeat('é', 60), 'strip_2x6', 'sixty.png') $$,
  'template name of exactly 60 BMP characters is accepted');

select lives_ok(
  $$ insert into public.templates (name, layout, overlay_path) values (repeat('x', 60), 'strip_2x6', 'sixty-ascii.png') $$,
  'template name of exactly 60 ASCII characters is accepted');

-- Emoji are 2 UTF-16 code units each (what the kiosk validator counts).
select lives_ok(
  $$ insert into public.templates (name, layout, overlay_path) values (repeat('😀', 30), 'strip_2x6', 'emoji-30.png') $$,
  '30 emoji (60 UTF-16 units) are accepted');

select throws_ok(
  $$ insert into public.templates (name, layout, overlay_path) values (repeat('😀', 31), 'strip_2x6', 'emoji-31.png') $$,
  '23514', null, '31 emoji (62 UTF-16 units) are rejected');

select throws_ok(
  $$ insert into public.templates (name, layout, overlay_path) values (repeat('x', 59) || '😀', 'strip_2x6', 'mixed.png') $$,
  '23514', null, '59 ASCII + 1 emoji (61 UTF-16 units) is rejected');

select is(
  (select count(*)::int from public.templates where char_length(name) not between 1 and 60),
  0, 'every existing template name (including the seed) is 1 to 60 characters');

-- ---------------------------------------------------------------------------
-- Settings INSERT path (single row: replace it inside this transaction)
-- ---------------------------------------------------------------------------
delete from public.settings where id = 1;

select throws_ok(
  $$ insert into public.settings (id, active_template_id) values (1, 'eeeeeeee-0000-0000-0000-000000000004') $$,
  '23514', 'active template must not be archived', 'inserting settings with an archived active template is rejected');

select lives_ok(
  $$ insert into public.settings (id, active_template_id) values (1, 'eeeeeeee-0000-0000-0000-000000000002') $$,
  'inserting settings with an unarchived active template works');

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc
   where proname in ('templates_keep_active_unarchived', 'settings_active_template_unarchived') and not prosecdef),
  2, 'integrity trigger functions are security invoker');

select is(
  (select bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
   from pg_proc p
   where proname in ('templates_keep_active_unarchived', 'settings_active_template_unarchived')),
  false, 'anon and authenticated cannot execute the integrity trigger functions');

select * from finish();
rollback;
