-- Template integrity (Task 14b).
--
-- 1. The active template (settings.active_template_id) can never be archived, and settings can never point at an
--    archived template. The admin web checks this too, but only the database sees concurrent writes (a stale tab, or
--    an archive racing a set-active), so the rule lives in two triggers that fire for every role (admin through RLS,
--    service role, migration owner).
--
--    Concurrency: both paths serialize on the single settings row. A settings update holds that row's lock; archiving a
--    template takes FOR SHARE on it before reading active_template_id. Under READ COMMITTED a waiting FOR SHARE
--    returns the latest committed row, and the settings trigger's query runs after its row lock is granted, so it sees
--    any archive that committed first. Whichever transaction goes second fails (or one of them hits a deadlock error);
--    neither can commit the bad state.
--
--    Functions are security invoker: admins can read settings/templates through RLS and take the row lock (they hold
--    UPDATE on settings), the service role bypasses RLS, and kiosks/anon cannot update either table at all.
--
-- 2. templates.name is 1 to 60 UTF-16 code units: the kiosk caches templates and its validator (JavaScript length)
--    rejects longer names, so an over-long name would invalidate the whole cached template list.

create function public.templates_keep_active_unarchived() returns trigger
language plpgsql security invoker set search_path = public
as $$
declare
  active_id uuid;
begin
  if new.archived and not old.archived then
    select s.active_template_id into active_id from public.settings s where s.id = 1 for share;
    if active_id = new.id then
      raise exception 'active template cannot be archived' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create function public.settings_active_template_unarchived() returns trigger
language plpgsql security invoker set search_path = public
as $$
begin
  if new.active_template_id is null then
    return new;
  end if;
  -- On UPDATE only a change is checked, so unrelated settings edits are never blocked.
  if tg_op = 'UPDATE' then
    if new.active_template_id is not distinct from old.active_template_id then
      return new;
    end if;
  end if;
  if exists (select 1 from public.templates t where t.id = new.active_template_id and t.archived) then
    raise exception 'active template must not be archived' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.templates_keep_active_unarchived() from public, anon, authenticated, service_role;
revoke execute on function public.settings_active_template_unarchived() from public, anon, authenticated, service_role;

create trigger templates_keep_active_unarchived
before update on public.templates
for each row execute function public.templates_keep_active_unarchived();

create trigger settings_active_template_unarchived
before insert or update on public.settings
for each row execute function public.settings_active_template_unarchived();

-- Length in UTF-16 code units, like the kiosk validator and the web form (JavaScript string length): characters
-- outside the Basic Multilingual Plane (emoji) count twice.
alter table public.templates
  add constraint templates_name_length check (
    char_length(name) >= 1
    and char_length(name) + char_length(regexp_replace(name, '[^\U00010000-\U0010FFFF]', '', 'g')) <= 60
  );
