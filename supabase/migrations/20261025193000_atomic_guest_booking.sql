-- Atomic guest booking creation for Uttarkunth2.0.
-- All execution is server-only. Never grant this RPC to anon/authenticated.
create or replace function public.create_guest_booking_request(
  p_booking_reference text,
  p_guest_access_token_hash text,
  p_room_unit_id uuid,
  p_guest_name text,
  p_guest_email text,
  p_guest_phone text,
  p_check_in date,
  p_check_out date,
  p_adults integer,
  p_children integer,
  p_special_requests text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.room_units%rowtype;
  v_property public.properties%rowtype;
  v_total numeric(12,2);
  v_id uuid;
  v_nights integer;
begin
  if p_booking_reference is null or p_booking_reference !~ '^UK-[A-F0-9]{20}$'
     or p_guest_access_token_hash is null or p_guest_access_token_hash !~ '^[0-9a-f]{64}$'
     or p_guest_name is null or length(btrim(p_guest_name)) not between 1 and 120
     or p_guest_email is null or length(p_guest_email) > 254
     or p_guest_phone is null or length(p_guest_phone) not between 7 and 40
     or p_check_in is null or p_check_out is null
     or p_check_in < (now() at time zone 'Asia/Kolkata')::date
     or p_check_out <= p_check_in or p_check_out - p_check_in > 60
     or p_adults is null or p_adults < 1 or p_adults > 20
     or p_children is null or p_children < 0 or p_children > 20
     or p_adults + p_children > 20 then
    raise exception 'Invalid booking details.';
  end if;

  select * into v_room
  from public.room_units
  where id = p_room_unit_id and active = true
  for update;
  if not found then raise exception 'Room is not available.'; end if;

  select * into v_property
  from public.properties
  where id = v_room.property_id
    and published = true
    and moderation_status = 'approved';
  if not found then raise exception 'Property is not accepting requests.'; end if;

  if p_adults + p_children > v_room.max_guests then
    raise exception 'Guest count exceeds room capacity.';
  end if;

  if exists (
    select 1 from public.room_availability_blocks b
    where b.room_unit_id = v_room.id
      and b.blocked_from < p_check_out
      and b.blocked_until > p_check_in
  ) then raise exception 'Room is blocked for these dates.'; end if;

  if exists (
    select 1 from public.stay_bookings b
    where b.room_unit_id = v_room.id
      and b.status in ('pending','confirmed')
      and b.check_in < p_check_out
      and b.check_out > p_check_in
  ) then raise exception 'Dates are no longer available.'; end if;

  v_nights := p_check_out - p_check_in;
  v_total := round(v_room.base_price * v_nights, 2);

  insert into public.stay_bookings (
    booking_reference, property_id, room_unit_id, guest_name, guest_email,
    guest_phone, check_in, check_out, adults, children, rooms_count,
    special_requests, status, total_estimate, guest_access_token_hash
  ) values (
    p_booking_reference, v_property.id, v_room.id, btrim(p_guest_name),
    lower(btrim(p_guest_email)), btrim(p_guest_phone), p_check_in, p_check_out,
    p_adults, p_children, 1, nullif(btrim(p_special_requests), ''), 'pending',
    v_total, p_guest_access_token_hash
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'booking_reference', p_booking_reference,
    'status', 'pending', 'nights', v_nights, 'estimated_total', v_total
  );
exception
  when exclusion_violation then
    raise exception 'Dates are no longer available.';
end;
$$;

revoke all on function public.create_guest_booking_request(text,text,uuid,text,text,text,date,date,integer,integer,text) from public, anon, authenticated;
grant execute on function public.create_guest_booking_request(text,text,uuid,text,text,text,date,date,integer,integer,text) to service_role;

-- Private cancellation/lookup stay-booking capabilities must not be exposed directly.
revoke all on public.stay_bookings from anon, authenticated;
grant select, insert, update, delete on public.stay_bookings to service_role;

-- The rate limiter stores HMAC-derived hashes, not raw IP addresses.
revoke all on function public.try_consume_booking_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.try_consume_booking_rate_limit(text,integer,integer) to service_role;
