-- Uttarkunth Stays booking foundation
-- Review and run this migration in Supabase SQL Editor after backing up your project.

create extension if not exists btree_gist;

alter table public.properties
  add column if not exists host_id uuid references auth.users(id) on delete set null;

create table if not exists public.stay_bookings (
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
  rooms_count integer not null default 1 check (rooms_count > 0),
  special_requests text,
  status text not null default 'pending' check (status in ('pending','confirmed','declined','cancelled')),
  total_estimate numeric(12,2),
  host_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stay_bookings_dates_valid check (check_out > check_in)
);

create index if not exists stay_bookings_property_dates_idx
  on public.stay_bookings(property_id, check_in, check_out);
create index if not exists stay_bookings_room_dates_idx
  on public.stay_bookings(room_unit_id, check_in, check_out);

-- Pending and confirmed requests reserve the requested room for their date range.
-- This prevents two overlapping bookings for the same room_unit.
alter table public.stay_bookings
  drop constraint if exists stay_bookings_no_overlapping_active_dates;
alter table public.stay_bookings
  add constraint stay_bookings_no_overlapping_active_dates
  exclude using gist (
    room_unit_id with =,
    daterange(check_in, check_out, '[)') with &&
  )
  where (status in ('pending','confirmed'));

alter table public.stay_bookings enable row level security;

-- Guests submit through a Netlify function using the server-side service role key.
-- Direct anonymous/authenticated access to booking records is intentionally not granted.
revoke all on public.stay_bookings from anon, authenticated;
grant select, insert, update, delete on public.stay_bookings to service_role;

-- Hosts can edit only properties assigned to their Supabase Auth user.
-- Admin accounts can be assigned app_metadata.role = 'admin' by a trusted server/admin.
drop policy if exists "Hosts manage their own properties" on public.properties;
create policy "Hosts manage their own properties"
on public.properties for all to authenticated
using (
  host_id = auth.uid()
  or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
)
with check (
  host_id = auth.uid()
  or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

drop policy if exists "Hosts manage room units for their own properties" on public.room_units;
create policy "Hosts manage room units for their own properties"
on public.room_units for all to authenticated
using (
  exists (
    select 1 from public.properties p
    where p.id = room_units.property_id
      and (
        p.host_id = auth.uid()
        or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      )
  )
)
with check (
  exists (
    select 1 from public.properties p
    where p.id = room_units.property_id
      and (
        p.host_id = auth.uid()
        or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      )
  )
);

-- NOTE: Keep existing public SELECT policies for published listings and active rooms.
