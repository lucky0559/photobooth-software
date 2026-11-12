-- payments.refunded_at: the operator marks a payment refunded from the dashboard (final review I3, R20).
--
-- "Needs attention" lists paid payments whose session was cancelled before payment (paid_after_cancel) or never
-- completed. Once the operator refunds the guest in the PayMongo dashboard they press "Mark refunded", which sets this
-- column; the list then leaves the row out. "Undo" clears it again.
--
-- Writes: payments stay unwritable by API roles (20261111000001 revoked insert/update/delete) except this ONE column,
-- and only for admins: a column-level UPDATE grant (no other column can be named in an update) plus an RLS update
-- policy that admits admins only (a kiosk or a user without a profile updates zero rows). Anon has no grant at all.

alter table public.payments add column refunded_at timestamptz null;

-- Only a paid payment can have been refunded.
alter table public.payments
  add constraint payments_refunded_only_when_paid check (refunded_at is null or status = 'paid');

grant update (refunded_at) on public.payments to authenticated;

create policy payments_admin_update_refunded on public.payments
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
