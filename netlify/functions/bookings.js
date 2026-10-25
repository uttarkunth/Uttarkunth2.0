const crypto = require("crypto");

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}
function safeText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function nightsBetween(start, end) {
  return Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000);
}
function todayInIndia() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return o.year + "-" + o.month + "-" + o.day;
}
function newReference() { return "UK-" + crypto.randomBytes(10).toString("hex").toUpperCase(); }
function tokenHash(token) { return crypto.createHash("sha256").update(token).digest("hex"); }

exports.handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return response(405, { ok: false, error: "Use GET for availability or POST for booking actions." });
  }
  const baseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) return response(503, { ok: false, error: "The booking service is temporarily unavailable." });

  const apiHeaders = {
    apikey: serviceKey, Authorization: "Bearer " + serviceKey,
    "Content-Type": "application/json", Accept: "application/json"
  };
  async function db(path, options = {}) {
    return fetch(new URL(path, baseUrl).toString(), {
      ...options, headers: { ...apiHeaders, ...(options.headers || {}) }
    });
  }
  async function rows(path) {
    const r = await db(path);
    if (!r.ok) throw new Error("database request failed");
    return r.json();
  }
  async function consumeRateLimit(event, purpose, maximum) {
    const requestHeaders = event.headers || {};
    const header = (name) => Object.entries(requestHeaders).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    const rawIp = header("x-nf-client-connection-ip") ||
      (process.env.CONTEXT === "dev" ? header("x-forwarded-for")?.split(",")[0]?.trim() : null);
    if (!rawIp) return false;
    const hash = crypto.createHmac("sha256", serviceKey).update(purpose + ":" + String(rawIp)).digest("hex");
    const r = await db("/rest/v1/rpc/try_consume_booking_rate_limit", {
      method: "POST",
      body: JSON.stringify({ p_ip_hash: hash, p_max_requests: maximum, p_window_seconds: 3600 })
    });
    if (!r.ok) throw new Error("rate limit unavailable");
    return (await r.json()) === true;
  }
  async function publicRoom(roomId) {
    if (!/^[0-9a-f-]{36}$/i.test(roomId)) return null;
    const rooms = await rows("/rest/v1/room_units?select=id,property_id,room_name,max_guests,base_price,active&id=eq." +
      encodeURIComponent(roomId) + "&active=eq.true&limit=1");
    if (!rooms.length) return null;
    const room = rooms[0];
    const properties = await rows("/rest/v1/properties?select=id,name,slug,village,district,state,published,moderation_status&id=eq." +
      encodeURIComponent(room.property_id) + "&published=eq.true&moderation_status=eq.approved&limit=1");
    return properties.length ? { room, property: properties[0] } : null;
  }
  async function isAvailable(roomId, checkIn, checkOut) {
    const blocks = await rows("/rest/v1/room_availability_blocks?select=id&room_unit_id=eq." + encodeURIComponent(roomId) +
      "&blocked_from=lt." + encodeURIComponent(checkOut) + "&blocked_until=gt." + encodeURIComponent(checkIn) + "&limit=1");
    if (blocks.length) return false;
    const conflicts = await rows("/rest/v1/stay_bookings?select=id&room_unit_id=eq." + encodeURIComponent(roomId) +
      "&status=in.(pending,confirmed)&check_in=lt." + encodeURIComponent(checkOut) +
      "&check_out=gt." + encodeURIComponent(checkIn) + "&limit=1");
    return conflicts.length === 0;
  }

  try {
    if (event.httpMethod === "GET") {
      const q = event.queryStringParameters || {};
      const roomId = safeText(q.room_unit_id, 80), checkIn = q.check_in, checkOut = q.check_out;
      const nights = validDate(checkIn) && validDate(checkOut) ? nightsBetween(checkIn, checkOut) : 0;
      if (!roomId || !validDate(checkIn) || !validDate(checkOut) || nights < 1 || nights > 60 || checkIn < todayInIndia()) {
        return response(400, { ok: false, error: "Choose valid dates up to 60 nights, with check-in today or later." });
      }
      if (!(await consumeRateLimit(event, "availability", 60))) {
        return response(429, { ok: false, error: "Too many availability checks. Please wait and try again." });
      }
      const listing = await publicRoom(roomId);
      if (!listing) return response(404, { ok: false, error: "This room is not currently available to book." });
      const available = await isAvailable(roomId, checkIn, checkOut);
      return response(200, {
        ok: true, available,
        property: { id: listing.property.id, name: listing.property.name, village: listing.property.village, district: listing.property.district, state: listing.property.state },
        room: { id: listing.room.id, room_name: listing.room.room_name, max_guests: listing.room.max_guests, base_price: listing.room.base_price },
        check_in: checkIn, check_out: checkOut, nights,
        estimated_total: Number(listing.room.base_price) * nights,
        message: available ? "Dates appear available. The host must still confirm your request." : "These dates are not available. Try other dates."
      });
    }

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (_) { return response(400, { ok: false, error: "Please submit valid booking details." }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response(400, { ok: false, error: "Please submit valid booking details." });
    const action = body.action || "create";
    const limits = { create: 8, track: 30, cancel: 12 };
    if (!Object.prototype.hasOwnProperty.call(limits, action)) return response(400, { ok: false, error: "Unsupported booking action." });
    if (!(await consumeRateLimit(event, "guest-" + action, limits[action]))) {
      return response(429, { ok: false, error: "Too many requests. Please wait and try again." });
    }

    if (action === "track") {
      const reference = safeText(body.booking_reference, 40).toUpperCase();
      const token = safeText(body.access_token, 200);
      if (!/^UK-[A-F0-9]{20}$/.test(reference) || token.length < 32) return response(400, { ok: false, error: "Enter a valid booking reference and private access token." });
      const found = await rows("/rest/v1/stay_bookings?select=booking_reference,property_id,room_unit_id,check_in,check_out,adults,children,rooms_count,special_requests,total_estimate,status,created_at,updated_at&booking_reference=eq." +
        encodeURIComponent(reference) + "&guest_access_token_hash=eq." + tokenHash(token) + "&limit=1");
      if (!found.length) return response(404, { ok: false, error: "We couldn't find a booking with those details." });
      const b = found[0];
      const properties = await rows("/rest/v1/properties?select=name,village,district,state&id=eq." + encodeURIComponent(b.property_id) + "&limit=1");
      const rooms = await rows("/rest/v1/room_units?select=room_name&id=eq." + encodeURIComponent(b.room_unit_id) + "&limit=1");
      return response(200, { ok: true, booking: { ...b, property: properties[0] || null, room: rooms[0] || null } });
    }

    if (action === "cancel") {
      const reference = safeText(body.booking_reference, 40).toUpperCase();
      const token = safeText(body.access_token, 200);
      if (!/^UK-[A-F0-9]{20}$/.test(reference) || token.length < 32) return response(400, { ok: false, error: "Enter a valid booking reference and private access token." });
      const found = await rows("/rest/v1/stay_bookings?select=id,status,check_in&booking_reference=eq." +
        encodeURIComponent(reference) + "&guest_access_token_hash=eq." + tokenHash(token) + "&limit=1");
      if (!found.length) return response(404, { ok: false, error: "We couldn't find a booking with those details." });
      const b = found[0];
      if (!["pending", "confirmed"].includes(b.status)) return response(409, { ok: false, error: "This booking cannot be cancelled online." });
      if (b.status === "confirmed" && b.check_in <= todayInIndia()) return response(409, { ok: false, error: "Contact the property to discuss a cancellation on or after check-in." });
      const r = await db("/rest/v1/stay_bookings?id=eq." + encodeURIComponent(b.id) + "&booking_reference=eq." +
        encodeURIComponent(reference) + "&guest_access_token_hash=eq." + tokenHash(token) + "&status=eq." + encodeURIComponent(b.status), {
        method: "PATCH", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() })
      });
      if (!r.ok) return response(503, { ok: false, error: "The booking could not be cancelled. Please contact the property." });
      if (!(await r.json()).length) return response(409, { ok: false, error: "The booking has already changed. Refresh to see its current status." });
      return response(200, { ok: true, status: "cancelled", message: "Your booking has been cancelled." });
    }

    const roomId = safeText(body.room_unit_id, 80);
    const guestName = safeText(body.guest_name, 120);
    const guestEmail = safeText(body.guest_email, 254).toLowerCase();
    const guestPhone = safeText(body.guest_phone, 40);
    const checkIn = body.check_in, checkOut = body.check_out;
    const adults = Number(body.adults || 1), children = Number(body.children || 0);
    const nights = validDate(checkIn) && validDate(checkOut) ? nightsBetween(checkIn, checkOut) : 0;
    const specialRequests = safeText(body.special_requests, 1000);
    if (!roomId || !guestName || !guestEmail || !guestPhone ||
        !validDate(checkIn) || !validDate(checkOut) || nights < 1 || nights > 60 || checkIn < todayInIndia() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail) || !/^[+0-9() .-]{7,40}$/.test(guestPhone) ||
        !Number.isInteger(adults) || adults < 1 || adults > 20 || !Number.isInteger(children) || children < 0 || children > 20 ||
        adults + children > 20 || adults + children < 1) {
      return response(400, { ok: false, error: "Check your name, contact details, dates and guest count." });
    }
    const listing = await publicRoom(roomId);
    if (!listing) return response(404, { ok: false, error: "This room is not currently accepting booking requests." });
    if (adults + children > Number(listing.room.max_guests)) return response(400, { ok: false, error: "Guest count exceeds the room's maximum capacity." });

    // Availability check is for user feedback only. The database RPC and exclusion
    // constraint are the final concurrency guard at insert time.
    if (!(await isAvailable(roomId, checkIn, checkOut))) return response(409, { ok: false, error: "Those dates are no longer available. Please choose other dates." });

    const accessToken = crypto.randomBytes(32).toString("base64url");
    const bookingReference = newReference();
    const inserted = await db("/rest/v1/rpc/create_guest_booking_request", {
      method: "POST",
      body: JSON.stringify({
        p_booking_reference: bookingReference,
        p_guest_access_token_hash: tokenHash(accessToken),
        p_room_unit_id: roomId,
        p_guest_name: guestName,
        p_guest_email: guestEmail,
        p_guest_phone: guestPhone,
        p_check_in: checkIn,
        p_check_out: checkOut,
        p_adults: adults,
        p_children: children,
        p_special_requests: specialRequests || null
      })
    });
    if (inserted.status === 409 || inserted.status === 400) return response(409, { ok: false, error: "Those dates or details could not be accepted. Refresh availability and try again." });
    if (!inserted.ok) return response(503, { ok: false, error: "Your booking request could not be saved. Please try again." });
    const result = await inserted.json();
    return response(201, {
      ok: true, booking_reference: bookingReference, access_token: accessToken,
      status: "pending", estimated_total: Number(result.estimated_total), nights: Number(result.nights),
      message: "Your request has been sent. It is not confirmed until the host approves it. Save the reference and private access token to track your request."
    });
  } catch (_) {
    return response(503, { ok: false, error: "The booking service is temporarily unavailable. Please try again later." });
  }
};
