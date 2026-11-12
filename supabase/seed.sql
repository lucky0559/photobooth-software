-- LOCAL DEVELOPMENT ONLY. Never run this against a hosted project.
-- The users below (admin@local.test / kiosk@local.test, password localpass123)
-- exist only in the local Docker stack; never reuse these credentials anywhere else.

-- GoTrue reads the token columns as strings, so they must be '' rather than null.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token
) values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000ad01', 'authenticated', 'authenticated',
   'admin@local.test', crypt('localpass123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000c105', 'authenticated', 'authenticated',
   'kiosk@local.test', crypt('localpass123', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now(),
   '', '', '', '', '', '', '', '');

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
       now(), now(), now()
  from auth.users u
 where u.email in ('admin@local.test', 'kiosk@local.test');

insert into public.profiles (user_id, role) values
  ('00000000-0000-0000-0000-00000000ad01', 'admin'),
  ('00000000-0000-0000-0000-00000000c105', 'kiosk');

-- Object name inside the `templates` bucket (no file is uploaded by this seed).
insert into public.templates (id, name, layout, overlay_path) values
  ('00000000-0000-0000-0000-0000000057a1', 'Sample strip', 'strip_2x6', 'templates/sample-strip.png');

update public.settings set active_template_id = '00000000-0000-0000-0000-0000000057a1' where id = 1;
