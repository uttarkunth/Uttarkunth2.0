-- Uttarkunth Stays booking foundation
-- Run once in Supabase SQL Editor after reviewing. Existing properties and room_units tables are reused.

create table if not exists public.property_hosts (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (property_id, user_id)
);

create table if not exists public.booking_requests (
  id uuid primary key default gen_random_uuid(),
  booking_reference text not null unique,
  property_id uuid not null references public.properties(id) on delete restrict,
  room_unit_id uuid not null references public.room_units(id) on delete restrict,
  guest_name text not null,
  guest_email text not null,
  guest_phone text not null,
  check_in date not null,
  check_out date not null,
  adults integer not null default 1 check (adults > 0),
  children integer not null default 0 check (children >= 0),
  special_requests text,
  estimated_total numeric(12,2),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','cancelled')),
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_dates_valid check (check_out > check_in)
);

create index if not exists booking_requests_room_dates_idx
  on public.booking_requests (room_unit_id, check_in, check_out);
create index if not exists booking_requests_property_status_idx
  on public.booking_requests (property_id, status);

create table if not exists public.room_availability_blocks (
  id uuid primary key default gen_random_uuid(),
  room_unit_id uuid not null references public.room_units(id) on delete cascade,
  blocked_from date not null,
  blocked_until date not null,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint block_dates_valid check (blocked_until > blocked_from)
);

create index if not exists room_availability_blocks_dates_idx
  on public.room_availability_blocks (room_unit_id, blocked_from, blocked_until);

alter table public.property_hosts enable row level security;
alter table public.booking_requests enable row level security;
alter table public.room_availability_blocks enable row level security;

-- Hosts can see their own property-host assignments.
drop policy if exists "Hosts can view own assignments" on public.property_hosts;
create policy "Hosts can view own assignments"
on public.property_hosts for select to authenticated
using (user_id = auth.uid());

-- Hosts can read and manage booking requests for properties assigned to them.
drop policy if exists "Hosts can view property bookings" on public.booking_requests;
create policy "Hosts can view property bookings"
on public.booking_requests for select to authenticated
using (exists (
  select 1 from public.property_hosts h
  where h.property_id = booking_requests.property_id and h.user_id = auth.uid()
));

drop policy if exists "Hosts can update property bookings" on public.booking_requests;
create policy "Hosts can update property bookings"
on public.booking_requests for update to authenticated
using (exists (
  select 1 from public.property_hosts h
  where h.property_id = booking_requests.property_id and h.user_id = auth.uid()
))
with check (exists (
  select 1 from public.property_hosts h
  where h.property_id = booking_requests.property_id and h.user_id = auth.uid()
));

drop policy if exists "Hosts can manage availability blocks" on public.room_availability_blocks;
create policy "Hosts can manage availability blocks"
on public.room_availability_blocks for all to authenticated
using (exists (
  select 1 from public.room_units r
  join public.property_hosts h on h.property_id = r.property_id
  where r.id = room_availability_blocks.room_unit_id and h.user_id = auth.uid()
))
with check (exists (
  select 1 from public.room_units r
  join public.property_hosts h on h.property_id = r.property_id
  where r.id = room_availability_blocks.room_unit_id and h.user_id = auth.uid()
));

-- Public users may submit a pending request, but cannot read other guests' personal data.
drop policy if exists "Anyone can submit a pending booking request" on public.booking_requests;
create policy "Anyone can submit a pending booking request"
on public.booking_requests for insert to anon, authenticated
with check (
  status = 'pending'
  and check_out > check_in
  and exists (
    select 1 from public.properties p
    join public.room_units r on r.property_id = p.id
    where p.id = booking_requests.property_id
      and r.id = booking_requests.room_unit_id
      and p.published = true
      and r.active = true
  )
);

-- Public calendar availability should be served through a Netlify function using
-- SUPABASE_SERVICE_ROLE_KEY; do not expose guest booking rows or personal details.
