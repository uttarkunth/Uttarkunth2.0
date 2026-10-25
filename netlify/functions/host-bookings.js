const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};
function response(statusCode, payload) { return { statusCode, headers, body: JSON.stringify(payload) }; }
function textValue(value, max) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }

exports.handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) return response(405, { ok: false, error: "Use GET or POST." });
  const baseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!baseUrl || !serviceKey || !anonKey) return response(503, { ok: false, error: "Host service is not configured." });

  const headersFor = (key) => ({
    apikey: key, Authorization: "Bearer " + key,
    "Content-Type": "application/json", Accept: "application/json"
  });
  async function serverDb(path, options = {}) {
    return fetch(new URL(path, baseUrl), { ...options, headers: { ...headersFor(serviceKey), ...(options.headers || {}) } });
  }
  async function rows(path) {
    const r = await serverDb(path);
    if (!r.ok) throw new Error("query failed");
    return r.json();
  }
  const authHeader = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === "authorization")?.[1] || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return response(401, { ok: false, error: "Please sign in to continue." });
  const accessToken = match[1];
  try {
    const auth = await fetch(new URL("/auth/v1/user", baseUrl), {
      headers: { apikey: anonKey, Authorization: "Bearer " + accessToken, Accept: "application/json" }
    });
    if (!auth.ok) return response(401, { ok: false, error: "Your session is invalid or expired. Please sign in again." });
    const user = await auth.json();
    if (!user.id || !user.email || !user.email_confirmed_at) return response(403, { ok: false, error: "Please verify your email before accessing host tools." });

    const admins = await rows("/rest/v1/platform_admins?select=user_id,role&user_id=eq." + encodeURIComponent(user.id) + "&role=eq.admin&limit=1");
    const isAdmin = admins.length > 0;
    const hostLinks = await rows("/rest/v1/property_hosts?select=property_id&user_id=eq." + encodeURIComponent(user.id));
    const propertiesOwned = await rows("/rest/v1/properties?select=id,name,slug,village,district,state,published,moderation_status,host_id" +
      (isAdmin ? "&limit=500" : "&host_id=eq." + encodeURIComponent(user.id) + "&limit=500"));
    const propertyMap = new Map(propertiesOwned.map((p) => [p.id, p]));
    for (const link of hostLinks) {
      const extra = await rows("/rest/v1/properties?select=id,name,slug,village,district,state,published,moderation_status,host_id&id=eq." + encodeURIComponent(link.property_id) + "&limit=1");
      if (extra.length) propertyMap.set(extra[0].id, extra[0]);
    }
    const properties = [...propertyMap.values()];
    const ids = properties.map((p) => p.id);
    if (!isAdmin && !ids.length) return response(403, { ok: false, error: "No Uttarkunth Stays property is assigned to this account yet." });

    if (event.httpMethod === "GET") {
      const filter = isAdmin ? "&limit=250" : "&property_id=in.(" + ids.map(encodeURIComponent).join(",") + ")&limit=250";
      const bookings = await rows("/rest/v1/stay_bookings?select=id,booking_reference,property_id,room_unit_id,guest_name,guest_email,guest_phone,check_in,check_out,adults,children,rooms_count,special_requests,status,total_estimate,host_notes,created_at,updated_at&order=created_at.desc" + filter);
      return response(200, {
        ok: true, is_admin: isAdmin,
        properties,
        bookings
      });
    }

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch (_) { return response(400, { ok: false, error: "Submit valid JSON." }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return response(400, { ok: false, error: "Submit valid booking decision details." });
    const bookingId = textValue(body.booking_id, 50);
    const action = textValue(body.action, 20);
    const notes = textValue(body.host_notes, 1000);
    if (!/^[0-9a-f-]{36}$/i.test(bookingId) || !["confirm", "decline", "cancel"].includes(action)) {
      return response(400, { ok: false, error: "Choose a valid booking and action." });
    }

    // The database function independently rechecks property ownership, admin role,
    // status transitions, blocks, capacity, conflicts and commission snapshots.
    const result = await serverDb("/rest/v1/rpc/respond_to_stay_booking", {
      method: "POST",
      body: JSON.stringify({
        p_stay_booking_id: bookingId,
        p_action: action,
        p_actor_user_id: user.id,
        p_host_notes: notes || null
      })
    });
    if (!result.ok) return response(409, { ok: false, error: "The booking could not be updated. It may have changed or your account may not be assigned to this property." });
    return response(200, { ok: true, result: await result.json() });
  } catch (_) {
    return response(503, { ok: false, error: "Host tools are temporarily unavailable." });
  }
};
