-- Photobooth schema, RLS and storage buckets.
--
-- Roles: every API user is `authenticated`; what they may do comes from
-- `profiles.role` ('admin' or 'kiosk'). The kiosk runs on an untrusted public
-- device with a long-lived login, so RLS and the triggers below are the only
-- thing between it and the data. Edge Functions write payments (and anything
-- else privileged) with the service role, which bypasses RLS.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'kiosk'))
);

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  layout text not null check (layout in ('strip_2x6', 'print_4r')),
  overlay_path text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.settings (
  id int primary key default 1 check (id = 1),
  price_centavos int not null default 15000 check (price_centavos between 2000 and 100000),
  free_mode boolean not null default false,
  shots_per_session int not null default 4 check (shots_per_session between 1 and 4),
  countdown_seconds int not null default 5 check (countdown_seconds in (3, 5, 10)),
  copies_per_session int not null default 1 check (copies_per_session between 1 and 4),
  link_expiry_days int not null default 7 check (link_expiry_days between 1 and 30),
  active_template_id uuid null references public.templates (id),
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (1);

create table public.sessions (
  id uuid primary key,
  kiosk_id uuid not null default auth.uid() references auth.users (id),
  template_id uuid not null references public.templates (id),
  -- 16 random bytes, base64url: exactly 22 characters.
  download_token text not null unique check (download_token ~ '^[A-Za-z0-9_-]{22}$'),
  amount_centavos int not null check (amount_centavos between 0 and 100000),
  status text not null check (status in ('awaiting_payment', 'paid', 'free', 'cancelled', 'paid_after_cancel', 'completed')),
  -- Informational only: readers derive the object name from id, never from this.
  photo_path text null check (photo_path is null or photo_path = id::text || '.jpg'),
  print_error text null check (print_error is null or length(print_error) <= 1000),
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index sessions_created_at_idx on public.sessions (created_at desc);
create index sessions_kiosk_id_idx on public.sessions (kiosk_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.sessions (id),
  provider_intent_id text not null unique,
  amount_centavos int not null,
  status text not null check (status in ('pending', 'paid', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz null,
  last_event jsonb null
);

-- ---------------------------------------------------------------------------
-- Role helpers
-- ---------------------------------------------------------------------------

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'admin');
$$;

create function public.is_kiosk() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where user_id = auth.uid() and role = 'kiosk');
$$;

revoke execute on function public.is_admin(), public.is_kiosk() from public, anon, service_role;
grant execute on function public.is_admin(), public.is_kiosk() to authenticated;

-- ---------------------------------------------------------------------------
-- Session guard: what a kiosk may write
-- ---------------------------------------------------------------------------

-- security definer so the service role (no execute on is_kiosk) can still fire it.
create function public.sessions_guard() returns trigger
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
    -- The server decides the price; the kiosk can only repeat it.
    if new.amount_centavos is distinct from old.amount_centavos then
      raise exception 'kiosk may not change amount_centavos';
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
  -- for exactly the amount paid.
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then
    select p.amount_centavos, p.status into pay from public.payments p where p.session_id = new.id;
    if found and (pay.status <> 'paid' or pay.amount_centavos <> new.amount_centavos) then
      raise exception 'completed session amount must match its paid payment';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.sessions_guard() from public, anon, authenticated, service_role;

create trigger sessions_guard
before insert or update on public.sessions
for each row execute function public.sessions_guard();

-- ---------------------------------------------------------------------------
-- Table privileges: no client deletes anywhere; writes only where a policy allows
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate on public.profiles, public.settings, public.templates, public.sessions, public.payments from anon;
revoke insert, update, delete, truncate on public.profiles, public.payments from authenticated;
revoke insert, delete, truncate on public.settings from authenticated;
revoke delete, truncate on public.templates, public.sessions from authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.templates enable row level security;
alter table public.sessions enable row level security;
alter table public.payments enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

create policy settings_select on public.settings
  for select to authenticated using ((select public.is_admin()) or (select public.is_kiosk()));
create policy settings_admin_update on public.settings
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy templates_select on public.templates
  for select to authenticated using ((select public.is_admin()) or (select public.is_kiosk()));
create policy templates_admin_insert on public.templates
  for insert to authenticated with check ((select public.is_admin()));
create policy templates_admin_update on public.templates
  for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy sessions_admin_select on public.sessions
  for select to authenticated using ((select public.is_admin()));
create policy sessions_kiosk_select on public.sessions
  for select to authenticated using ((select public.is_kiosk()) and kiosk_id = (select auth.uid()));
create policy sessions_kiosk_insert on public.sessions
  for insert to authenticated with check ((select public.is_kiosk()) and kiosk_id = (select auth.uid()));
create policy sessions_kiosk_update on public.sessions
  for update to authenticated
  using ((select public.is_kiosk()) and kiosk_id = (select auth.uid()))
  with check ((select public.is_kiosk()) and kiosk_id = (select auth.uid()));

create policy payments_admin_select on public.payments
  for select to authenticated using ((select public.is_admin()));
create policy payments_kiosk_select on public.payments
  for select to authenticated using (
    (select public.is_kiosk())
    and exists (select 1 from public.sessions s where s.id = payments.session_id and s.kiosk_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('photos', 'photos', false, 10485760, array['image/jpeg']),
  ('templates', 'templates', false, 10485760, array['image/png']);

-- Kiosk: write only `<session id>.jpg` for one of its own sessions.
create policy photos_kiosk_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'photos'
    and (select public.is_kiosk())
    and exists (select 1 from public.sessions s where s.kiosk_id = (select auth.uid()) and s.id::text || '.jpg' = objects.name)
  );
create policy photos_kiosk_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'photos'
    and (select public.is_kiosk())
    and exists (select 1 from public.sessions s where s.kiosk_id = (select auth.uid()) and s.id::text || '.jpg' = objects.name)
  )
  with check (
    bucket_id = 'photos'
    and (select public.is_kiosk())
    and exists (select 1 from public.sessions s where s.kiosk_id = (select auth.uid()) and s.id::text || '.jpg' = objects.name)
  );
-- storage-api runs an `upsert: true` upload as `INSERT ... ON CONFLICT DO UPDATE
-- ... RETURNING *`, and Postgres applies SELECT policies to rows that statement
-- touches. The kiosk uploads with upsert (a retry must overwrite), so it may
-- read back exactly the photos of its own sessions, and nothing else.
create policy photos_kiosk_select_own on storage.objects
  for select to authenticated using (
    bucket_id = 'photos'
    and (select public.is_kiosk())
    and exists (select 1 from public.sessions s where s.kiosk_id = (select auth.uid()) and s.id::text || '.jpg' = objects.name)
  );
create policy photos_admin_select on storage.objects
  for select to authenticated using (bucket_id = 'photos' and (select public.is_admin()));

create policy templates_objects_select on storage.objects
  for select to authenticated using (bucket_id = 'templates' and ((select public.is_admin()) or (select public.is_kiosk())));
create policy templates_objects_admin_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'templates' and (select public.is_admin()));
create policy templates_objects_admin_update on storage.objects
  for update to authenticated
  using (bucket_id = 'templates' and (select public.is_admin()))
  with check (bucket_id = 'templates' and (select public.is_admin()));
create policy templates_objects_admin_delete on storage.objects
  for delete to authenticated using (bucket_id = 'templates' and (select public.is_admin()));
