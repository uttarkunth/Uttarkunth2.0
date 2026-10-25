import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const allowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  return origin === "https://uttarkunth.netlify.app" ||
    origin === "https://uttarkunth.netlify.com" ||
    /^https:\/\/deploy-preview-\d+--uttarkunth\.netlify\.app$/.test(origin) ||
    /^http:\/\/localhost:(\d+)$/.test(origin);
};
function cors(origin: string | null) {
  const h: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
  if (origin && allowedOrigin(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function reply(status: number, data: unknown, origin: string | null) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}
const clean = (v: unknown, max = 500) => typeof v === "string" ? v.trim().slice(0, max) : "";
function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00.000Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
function todayIndia() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()); }
function nightsBetween(a: string, b: string) { return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000); }
async function hash(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((n) => n.toString(16).padStart(2, "0")).join("");
}
function randomHex(n: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function randomToken(n: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return btoa(Array.from(bytes).map((b) => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function db(path: string, init: RequestInit = {}) {
  return await fetch(base + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {})
    }
  });
}
async function getRows(path: string) {
  const r = await db(path);
  if (!r.ok) throw new Error("query failed");
  return await r.json();
}
async function postJson(path: string, data: unknown) {
  return await db(path, { method: "POST", body: JSON.stringify(data) });
}
async function expireOldPending() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await db("stay_bookings?status=eq.pending&created_at=lt." + encodeURIComponent(cutoff), {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() })
  });
}
async function authenticatedUser(req: Request) {
  if (!anonKey) return null;
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1] || match[1] === anonKey) return null;
  const r = await fetch(base + "/auth/v1/user", { headers: { apikey: anonKey, Authorization: "Bearer " + match[1] } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (!allowedOrigin(origin)) return reply(403, { ok: false, error: "Origin not allowed." }, origin);
  if (req.method !== "POST") return reply(405, { ok: false, error: "Use POST to submit or track a booking." }, origin);
  if (!base || !serviceKey) return reply(503, { ok: false, error: "The booking service is not configured." }, origin);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Enter valid booking details." }, origin); }
  const action = clean(body.action, 30);
  try {
    if (action === "availability") {
      const roomId = clean(body.room_unit_id, 80);
      const checkIn = body.check_in, checkOut = body.check_out;
      const guests = Number(body.adults || 1) + Number(body.children || 0);
      if (!roomId || !isDate(checkIn) || !isDate(checkOut) || checkIn < todayIndia() || checkOut <= checkIn || nightsBetween(checkIn, checkOut) > 60) {
        return reply(400, { ok: false, error: "Choose valid check-in and check-out dates." }, origin);
      }
      await expireOldPending();
      const found = await getRows("room_units?select=id,property_id,max_guests,base_price,active&id=eq." + encodeURIComponent(roomId) + "&active=eq.true&limit=1");
      if (!found.length) return reply(404, { ok: false, error: "This room is not available for booking requests." }, origin);
      const room = found[0];
      const props = await getRows("properties?select=id&published=eq.true&moderation_status=eq.approved&id=eq." + encodeURIComponent(room.property_id) + "&limit=1");
      if (!props.length) return reply(404, { ok: false, error: "This stay is not accepting requests." }, origin);
      if (!Number.isInteger(guests) || guests < 1 || guests > Number(room.max_guests)) return reply(400, { ok: false, error: "Guest count exceeds this room's capacity." }, origin);
      const q = "room_unit_id=eq." + encodeURIComponent(roomId) + "&status=in.(pending,confirmed)&check_in=lt." + encodeURIComponent(String(checkOut)) + "&check_out=gt." + encodeURIComponent(String(checkIn)) + "&limit=1";
      const [conflicts, blocks] = await Promise.all([
        getRows("stay_bookings?select=id&" + q),
        getRows("room_availability_blocks?select=id&room_unit_id=eq." + encodeURIComponent(roomId) + "&blocked_from=lt." + encodeURIComponent(String(checkOut)) + "&blocked_until=gt." + encodeURIComponent(String(checkIn)) + "&limit=1")
      ]);
      return reply(200, { ok: true, available: conflicts.length === 0 && blocks.length === 0, nights: nightsBetween(checkIn, checkOut), total_estimate: Number(room.base_price) * nightsBetween(checkIn, checkOut) }, origin);
    }
    if (action === "track" || action === "cancel") {
      const reference = clean(body.booking_reference, 40).toUpperCase();
      const token = clean(body.access_token, 200);
      if (!/^UK-[A-F0-9]{20}$/.test(reference) || token.length < 32) return reply(400, { ok: false, error: "Enter a valid booking reference and private access token." }, origin);
      const tokenHash = await hash(token);
      if (action === "cancel") {
        const r = await postJson("rpc/cancel_guest_booking", { p_booking_reference: reference, p_guest_token_hash: tokenHash });
        if (!r.ok) return reply(r.status === 404 ? 404 : 409, { ok: false, error: "This request could not be cancelled. Check its status or contact the property." }, origin);
        const data = await r.json();
        return reply(200, { ok: true, status: data.status || "cancelled", message: "Your booking request has been cancelled." }, origin);
      }
      const bookings = await getRows("stay_bookings?select=id,booking_reference,property_id,room_unit_id,check_in,check_out,adults,children,rooms_count,special_requests,status,total_estimate,created_at,updated_at&booking_reference=eq." + encodeURIComponent(reference) + "&guest_access_token_hash=eq." + tokenHash + "&limit=1");
      if (!bookings.length) return reply(404, { ok: false, error: "We couldn't find a booking with those details." }, origin);
      const b = bookings[0];
      const [properties, rooms] = await Promise.all([
        getRows("properties?select=name,village,district,state&id=eq." + encodeURIComponent(b.property_id) + "&limit=1"),
        getRows("room_units?select=room_name,max_guests&id=eq." + encodeURIComponent(b.room_unit_id) + "&limit=1")
      ]);
      return reply(200, { ok: true, booking: { ...b, property: properties[0] || null, room: rooms[0] || null } }, origin);
    }
    if (action !== "create") return reply(400, { ok: false, error: "Unsupported booking action." }, origin);
    const roomId = clean(body.room_unit_id, 80);
    const guestName = clean(body.guest_name, 120);
    const guestEmail = clean(body.guest_email, 254).toLowerCase();
    const guestPhone = clean(body.guest_phone, 40);
    const checkIn = body.check_in, checkOut = body.check_out;
    const adults = Number(body.adults || 1), children = Number(body.children || 0);
    const specialRequests = clean(body.special_requests, 1000);
    const nights = isDate(checkIn) && isDate(checkOut) ? nightsBetween(String(checkIn), String(checkOut)) : 0;
    if (!roomId || guestName.length < 1 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail) ||
      !/^[+0-9() .-]{7,40}$/.test(guestPhone) || !isDate(checkIn) || !isDate(checkOut) ||
      nights < 1 || nights > 60 || String(checkIn) < todayIndia() ||
      !Number.isInteger(adults) || adults < 1 || adults > 20 ||
      !Number.isInteger(children) || children < 0 || children > 20 || adults + children < 1 || adults + children > 20) {
      return reply(400, { ok: false, error: "Check your name, email, phone, dates and guest count." }, origin);
    }
    await expireOldPending();
    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim().slice(0, 160);
    const allowed = await postJson("rpc/try_consume_booking_rate_limit", { p_ip_hash: await hash(ip), p_max_requests: 5, p_window_seconds: 3600 });
    if (!allowed.ok) return reply(503, { ok: false, error: "Booking protection is temporarily unavailable. Please try again later." }, origin);
    if (!(await allowed.json())) return reply(429, { ok: false, error: "Too many requests from this connection. Please try again later." }, origin);
    const token = randomToken(32);
    const reference = "UK-" + randomHex(10);
    const created = await postJson("rpc/create_guest_booking_request", {
      p_booking_reference: reference,
      p_guest_access_token_hash: await hash(token),
      p_room_unit_id: roomId,
      p_guest_name: guestName,
      p_guest_email: guestEmail,
      p_guest_phone: guestPhone,
      p_check_in: checkIn,
      p_check_out: checkOut,
      p_adults: adults,
      p_children: children,
      p_special_requests: specialRequests || null
    });
    if (!created.ok) return reply(created.status === 409 || created.status === 400 ? 409 : 503, { ok: false, error: created.status === 409 || created.status === 400 ? "Those dates or details are no longer available. Refresh and try again." : "Your booking request could not be saved. Please try again." }, origin);
    const result = await created.json();
    const user = await authenticatedUser(req);
    if (user && user.email && String(user.email).toLowerCase() === guestEmail) {
      await db("stay_bookings?booking_reference=eq." + encodeURIComponent(reference) + "&guest_access_token_hash=eq." + await hash(token), {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ guest_user_id: user.id, updated_at: new Date().toISOString() })
      });
    }
    return reply(201, {
      ok: true, booking_reference: reference, access_token: token, status: "pending",
      estimated_total: Number(result.estimated_total), nights: Number(result.nights),
      message: "Your request has been sent. It is not confirmed until the host approves it. Save the booking reference and private access token to track it."
    }, origin);
  } catch (_) {
    return reply(503, { ok: false, error: "The booking service is temporarily unavailable. Please try again later." }, origin);
  }
});