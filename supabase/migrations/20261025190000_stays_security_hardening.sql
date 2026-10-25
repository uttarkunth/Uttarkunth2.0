-- Security hardening for Uttarkunth2.0 Stays.
-- Additive migration. Does not delete or rewrite existing properties/bookings.
-- Review and apply to the linked Supabase project after backup.

create extension if not exists btree_gist;

-- Never expose private booking tables directly to browser roles.
alter table public.stay_bookings enable row level security;
revoke all on public.stay_bookings from anon, authenticated;
grant select, insert, update, delete on public.stay_bookings to service_role;

alter table public.booking_requests enable row level security;
revoke all on public.booking_requests from anon, authenticated;
grant select, insert, update, delete on public.booking_requests to service_role;

-- Public listing access remains limited by existing public policies. Prevent
-- browser clients from changing approval/host ownership columns via broad grants.
-- Writes are intended to be performed by trusted server/admin functions.
revoke insert, update, delete on public.properties from anon, authenticated;
revoke insert, update, delete on public.room_units from anon, authenticated;

-- Host assignment records are private; only a server endpoint may mutate them.
alter table public.property_hosts enable row level security;
revoke all on public.property_hosts from anon;
revoke insert, update, delete on public.property_hosts from authenticated;
grant select on public.property_hosts to authenticated;
drop policy if exists "Hosts can view own assignments" on public.property_hosts;
create policy "Hosts can view own assignments"
on public.property_hosts for select to authenticated
using (user_id = (select auth.uid()));

-- Availability block mutation is performed by trusted server functions until
-- host session + property assignment is checked by a dedicated endpoint.
alter table public.room_availability_blocks enable row level security;
revoke all on public.room_availability_blocks from anon, authenticated;
grant select, insert, update, delete on public.room_availability_blocks to service_role;

-- Ensure booking requests cannot be created directly without the guest capability flow.
drop policy if exists "Anyone can submit a pending booking request" on public.booking_requests;
drop policy if exists "Hosts can view property bookings" on public.booking_requests;
drop policy if exists "Hosts can update property bookings" on public.booking_requests;

-- A host-facing UI must use a server endpoint that validates the Auth access token,
-- derives the actor from Supabase Auth, and calls the transactional RPC. Direct client
-- UPDATE on private booking rows is intentionally not granted.
