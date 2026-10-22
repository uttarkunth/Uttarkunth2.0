const crypto = require("crypto");

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z"));
}

function nightsBetween(start, end) {
  return Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / 86400000);
}

function reference() {
  return "UK-" + Date.now().toString(36).toUpperCase() + "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase();
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return response(405, { ok: false, error: "Use GET to check availability or POST to request a booking." });
  }

  const baseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceKey) {
    return response(500, {
      ok: false,
      error: "Booking service is not configured. Add SUPABASE_SERVICE_ROLE_KEY in Netlify environment variables."
    });
  }

  const apiHeaders = {
    apikey: serviceKey,
    Authorization: "Bearer " + serviceKey,
    "Content-Type": "application/json",
    Accept: "application/json"
  };

  async function supabase(path, options = {}) {
    return fetch(new URL(path, baseUrl).toString(), {
      ...options,
      headers: { ...apiHeaders, ...(options.headers || {}) }
    });
  }

  try {
    if (event.httpMethod === "GET") {
      const q = event.queryStringParameters || {};
      const roomId = q.room_unit_id;
      const checkIn = q.check_in;
      const checkOut = q.check_out;
      if (!roomId || !validDate(checkIn) || !validDate(checkOut) || nightsBetween(checkIn, checkOut) < 1) {
        return response(400, { ok: false, error: "Provide room_unit_id, check_in and check_out. Check-out must be after check-in." });
      }

      const roomResponse = await supabase(
        "/rest/v1/room_units?select=id,property_id,room_name,max_guests,base_price,active&id=eq." +
        encodeURIComponent(roomId) + "&active=eq.true"
      );
      if (!roomResponse.ok) return response(502, { ok: false, error: "Could not check room information." });
      const rooms = await roomResponse.json();
      if (!rooms.length) return response(404, { ok: false, error: "Room not found or inactive." });

      const room = rooms[0];
      const propertyResponse = await supabase(
        "/rest/v1/properties?select=id,published&id=eq." + encodeURIComponent(room.property_id) + "&published=eq.true"
      );
      if (!propertyResponse.ok) return response(502, { ok: false, error: "Could not check property listing." });
      if (!(await propertyResponse.json()).length) return response(404, { ok: false, error: "Property is not currently published." });

      const bookingsResponse = await supabase(
        "/rest/v1/stay_bookings?select=id,check_in,check_out,status&room_unit_id=eq." +
        encodeURIComponent(roomId) + "&status=in.(pending,confirmed)&check_in=lt." +
        encodeURIComponent(checkOut) + "&check_out=gt." + encodeURIComponent(checkIn)
      );
      if (!bookingsResponse.ok) return response(502, { ok: false, error: "Could not check existing reservations." });
      const overlaps = await bookingsResponse.json();
      return response(200, {
        ok: true,
        available: overlaps.length === 0,
        room: { id: room.id, property_id: room.property_id, room_name: room.room_name, max_guests: room.max_guests, base_price: room.base_price },
        check_in: checkIn,
        check_out: checkOut,
        nights: nightsBetween(checkIn, checkOut),
        estimated_total: Number(room.base_price) * nightsBetween(checkIn, checkOut),
        message: overlaps.length ? "These dates are not available. Please try other dates." : "Dates look available. The host must still confirm your request."
      });
    }

    let body;
    try { body = JSON.parse(event.body || "{}"); }
    catch (_) { return response(400, { ok: false, error: "Booking form data must be valid JSON." }); }

    const required = ["room_unit_id", "guest_name", "guest_email", "guest_phone", "check_in", "check_out"];
    const missing = required.filter((key) => !String(body[key] || "").trim());
    if (missing.length) return response(400, { ok: false, error: "Please complete all required fields.", fields: missing });
    if (!validDate(body.check_in) || !validDate(body.check_out) || nightsBetween(body.check_in, body.check_out) < 1) {
      return response(400, { ok: false, error: "Please choose valid check-in and check-out dates." });
    }

    const adults = Number(body.adults || 1);
    const children = Number(body.children || 0);
    const roomsCount = Number(body.rooms_count || 1);
    if (!Number.isInteger(adults) || adults < 1 || !Number.isInteger(children) || children < 0 ||
        !Number.isInteger(roomsCount) || roomsCount < 1) {
      return response(400, { ok: false, error: "Please enter valid guest and room counts." });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.guest_email)) {
      return response(400, { ok: false, error: "Please enter a valid email address." });
    }

    const roomResponse = await supabase(
      "/rest/v1/room_units?select=id,property_id,room_name,max_guests,base_price,active&id=eq." +
      encodeURIComponent(body.room_unit_id) + "&active=eq.true"
    );
    if (!roomResponse.ok) return response(502, { ok: false, error: "Could not verify the requested room." });
    const rooms = await roomResponse.json();
    if (!rooms.length) return response(404, { ok: false, error: "The selected room is no longer available for booking." });
    const room = rooms[0];

    if (adults + children > Number(room.max_guests || 99)) {
      return response(400, { ok: false, error: "Guest count exceeds the listed room capacity." });
    }

    const propertyResponse = await supabase(
      "/rest/v1/properties?select=id,published&id=eq." + encodeURIComponent(room.property_id) + "&published=eq.true"
    );
    if (!propertyResponse.ok) return response(502, { ok: false, error: "Could not verify the property." });
    if (!(await propertyResponse.json()).length) return response(404, { ok: false, error: "This property is not currently accepting requests." });

    const bookingRef = reference();
    const booking = {
      booking_reference: bookingRef,
      property_id: room.property_id,
      room_unit_id: room.id,
      guest_name: String(body.guest_name).trim().slice(0, 120),
      guest_email: String(body.guest_email).trim().slice(0, 254),
      guest_phone: String(body.guest_phone).trim().slice(0, 40),
      check_in: body.check_in,
      check_out: body.check_out,
      adults,
      children,
      rooms_count: roomsCount,
      special_requests: String(body.special_requests || "").trim().slice(0, 2000) || null,
      status: "pending",
      total_estimate: Number(room.base_price) * nightsBetween(body.check_in, body.check_out) * roomsCount
    };

    const insertResponse = await supabase("/rest/v1/stay_bookings", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(booking)
    });
    if (insertResponse.status === 409) {
      return response(409, { ok: false, error: "These dates have just been requested by another guest. Please select different dates." });
    }
    if (!insertResponse.ok) {
      return response(502, { ok: false, error: "Booking request could not be saved. Please try again.", upstreamStatus: insertResponse.status });
    }

    return response(201, {
      ok: true,
      booking_reference: bookingRef,
      status: "pending",
      estimated_total: booking.total_estimate,
      message: "Your booking request has been sent. It is not confirmed until the host approves it."
    });
  } catch (error) {
    return response(500, { ok: false, error: "Unexpected booking service error. Please try again later." });
  }
};
