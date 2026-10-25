import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const allowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  return origin === "https://uttarkunth.netlify.app" ||
    /^https:\/\/deploy-preview-\d+--uttarkunth\.netlify\.app$/.test(origin) ||
    /^http:\/\/localhost:(\d+)$/.test(origin);
};
function cors(origin: string | null) {
  const h: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
  if (origin && allowedOrigin(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function reply(status: number, data: unknown, origin: string | null) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}
const text = (v: unknown, n = 500) => typeof v === "string" ? v.trim().slice(0, n) : "";
const slugify = (v: string) => v.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
async function db(path: string, init: RequestInit = {}) {
  return await fetch(base + "/rest/v1/" + path, {
    ...init, headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Accept: "application/json", ...(init.headers || {}) }
  });
}
async function rows(path: string) {
  const r = await db(path);
  if (!r.ok) throw new Error("Database request failed");
  return await r.json();
}
async function send(path: string, method: string, data?: unknown, prefer = "return=representation") {
  return await db(path, { method, headers: { Prefer: prefer }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
}
async function currentUser(req: Request) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1] || !anonKey) return { user: null, error: "Sign in to continue." };
  const r = await fetch(base + "/auth/v1/user", { headers: { apikey: anonKey, Authorization: "Bearer " + match[1], Accept: "application/json" } });
  if (!r.ok) return { user: null, error: "Your session has expired. Please sign in again." };
  const user = await r.json();
  if (!user.id || !user.email_confirmed_at) return { user: null, error: "Please verify your email before using host tools." };
  return { user, error: "" };
}
async function propertyForHost(propertyId: string, userId: string) {
  const props = await rows("properties?select=id,host_id,name,slug,published,moderation_status,photos,amenities&id=eq." + encodeURIComponent(propertyId) + "&limit=1");
  if (!props.length) return null;
  const p = props[0];
  if (p.host_id === userId) return p;
  const links = await rows("property_hosts?select=id&property_id=eq." + encodeURIComponent(propertyId) + "&user_id=eq." + encodeURIComponent(userId) + "&limit=1");
  return links.length ? p : null;
}
async function logAudit(userId: string, action: string, targetType: string, targetId: string, details: unknown) {
  await send("admin_audit_log", "POST", { actor_user_id: userId, action, target_type: targetType, target_id: targetId, details });
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (!allowedOrigin(origin)) return reply(403, { ok: false, error: "Origin not allowed." }, origin);
  if (!["GET", "POST"].includes(req.method)) return reply(405, { ok: false, error: "Use GET or POST." }, origin);
  if (!base || !serviceKey || !anonKey) return reply(503, { ok: false, error: "Host tools are temporarily unavailable." }, origin);
  const auth = await currentUser(req);
  if (!auth.user) return reply(401, { ok: false, error: auth.error }, origin);
  const user = auth.user;
  try {
    if (req.method === "GET") {
      const owned = await rows("properties?select=id,slug,name,description,address,village,district,state,amenities,photos,property_type,published,moderation_status,moderation_notes,created_at,updated_at,host_id&host_id=eq." + encodeURIComponent(user.id) + "&order=created_at.desc&limit=200");
      const links = await rows("property_hosts?select=property_id&user_id=eq." + encodeURIComponent(user.id) + "&limit=200");
      const ids = new Set<string>((owned as Array<Record<string, string>>).map((p) => String(p.id)));
      for (const link of links as Array<Record<string, string>>) if (link.property_id) ids.add(link.property_id);
      const properties = owned.slice();
      if (ids.size) {
        const assigned = await rows("properties?select=id,slug,name,description,address,village,district,state,amenities,photos,property_type,published,moderation_status,moderation_notes,created_at,updated_at,host_id&id=in.(" + Array.from(ids).map(encodeURIComponent).join(",") + ")&order=created_at.desc&limit=200");
        for (const p of assigned) if (!properties.some((x: Record<string, string>) => x.id === p.id)) properties.push(p);
      }
      if (!properties.length) return reply(200, { ok: true, user: { id: user.id, email: user.email, name: user.user_metadata?.full_name || "" }, properties: [], rooms: [], bookings: [], blocks: [] }, origin);
      const filter = "in.(" + properties.map((p: Record<string, string>) => p.id).map(encodeURIComponent).join(",") + ")";
      const [rooms, bookings] = await Promise.all([
        rows("room_units?select=id,property_id,room_name,description,max_guests,base_price,active,created_at&property_id=" + filter + "&order=created_at.asc&limit=1000"),
        rows("stay_bookings?select=id,booking_reference,property_id,room_unit_id,guest_name,guest_email,guest_phone,check_in,check_out,adults,children,rooms_count,special_requests,status,total_estimate,host_notes,created_at,updated_at,commission_percent_snapshot,commission_amount_snapshot&property_id=" + filter + "&order=created_at.desc&limit=1000")
      ]);
      const roomFilter = rooms.length ? "in.(" + rooms.map((r: Record<string, string>) => encodeURIComponent(r.id)).join(",") + ")" : "eq.00000000-0000-0000-0000-000000000000";
      const blocks = await rows("room_availability_blocks?select=id,room_unit_id,blocked_from,blocked_until,reason,created_at&room_unit_id=" + roomFilter + "&order=blocked_from.asc&limit=1000");
      return reply(200, { ok: true, user: { id: user.id, email: user.email, name: user.user_metadata?.full_name || "" }, properties, rooms, bookings, blocks }, origin);
    }

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const action = text(form.get("action"), 40);
      if (action !== "upload-photo") return reply(400, { ok: false, error: "Unsupported upload action." }, origin);
      const propertyId = text(form.get("property_id"), 80);
      const file = form.get("file");
      if (!propertyId || !(file instanceof File)) return reply(400, { ok: false, error: "Choose a property and an image." }, origin);
      const property = await propertyForHost(propertyId, user.id);
      if (!property) return reply(403, { ok: false, error: "You can only upload images for your own property." }, origin);
      if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.type) || file.size < 1 || file.size > 8 * 1024 * 1024) {
        return reply(400, { ok: false, error: "Use a JPG, PNG, WebP or AVIF image under 8 MB." }, origin);
      }
      const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "avif";
      const objectPath = propertyId + "/" + user.id + "/" + crypto.randomUUID() + "." + ext;
      const upload = await fetch(base + "/storage/v1/object/property-photos/" + objectPath.split("/").map(encodeURIComponent).join("/"), {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": file.type, "x-upsert": "false" },
        body: await file.arrayBuffer()
      });
      if (!upload.ok) return reply(503, { ok: false, error: "The image could not be uploaded. Please try again." }, origin);
      const publicUrl = base + "/storage/v1/object/public/property-photos/" + objectPath.split("/").map(encodeURIComponent).join("/");
      const photos = Array.isArray(property.photos) ? property.photos.slice() : [];
      photos.push(publicUrl);
      const updated = await send("properties?id=eq." + encodeURIComponent(propertyId), "PATCH", { photos, published: false, moderation_status: "pending", moderation_notes: null, reviewed_at: null, reviewed_by: null, updated_at: new Date().toISOString() });
      if (!updated.ok) return reply(503, { ok: false, error: "Image uploaded, but listing update did not finish. Refresh your listing before retrying." }, origin);
      return reply(200, { ok: true, photo_url: publicUrl, message: "Image uploaded. The updated listing will need review before republishing." }, origin);
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Enter valid information." }, origin); }
    const action = text(body.action, 50);
    if (action === "property.create") {
      const name = text(body.name, 120), village = text(body.village, 100), district = text(body.district, 100);
      const roomName = text(body.room_name, 120);
      const rate = Number(body.base_price), capacity = Number(body.max_guests || 2);
      const type = text(body.property_type, 30) || "homestay";
      if (name.length < 3 || village.length < 2 || district.length < 2 || roomName.length < 2 ||
          !Number.isFinite(rate) || rate < 0 || rate > 10000000 || !Number.isInteger(capacity) || capacity < 1 || capacity > 30 ||
          !["homestay","hotel","resort","villa","guesthouse","cottage","other"].includes(type)) {
        return reply(400, { ok: false, error: "Complete the property, location, room and price fields with valid values." }, origin);
      }
      const baseSlug = slugify(name + "-" + village) || "himalayan-stay";
      let slug = baseSlug;
      const existing = await rows("properties?select=id&slug=eq." + encodeURIComponent(slug) + "&limit=1");
      if (existing.length) slug = baseSlug.slice(0, 60) + "-" + crypto.randomUUID().slice(0, 6);
      const propResponse = await send("properties", "POST", {
        slug, name, description: text(body.description, 3000), address: text(body.address, 240) || null,
        village, district, state: text(body.state, 100) || "Himachal Pradesh",
        amenities: Array.isArray(body.amenities) ? body.amenities.filter((x) => typeof x === "string").slice(0, 30) : [],
        photos: [], booking_mode: "request", published: false, host_id: user.id,
        moderation_status: "pending", property_type: type
      });
      if (!propResponse.ok) return reply(503, { ok: false, error: "The listing could not be saved. Please check the details and try again." }, origin);
      const inserted = await propResponse.json();
      const p = inserted[0];
      const roomResponse = await send("room_units", "POST", {
        property_id: p.id, room_name: roomName, description: text(body.room_description, 1000),
        max_guests: capacity, base_price: rate, active: true
      });
      if (!roomResponse.ok) {
        await send("properties?id=eq." + encodeURIComponent(p.id), "DELETE", undefined, "return=minimal");
        return reply(503, { ok: false, error: "The room could not be saved, so the incomplete draft was rolled back. Please try again." }, origin);
      }
      const room = (await roomResponse.json())[0];
      await logAudit(user.id, "property_moderated", "property", p.id, { action: "host_submitted", status: "pending" }).catch(() => {});
      return reply(201, { ok: true, property: p, room, message: "Your listing has been submitted for Uttarkunth review. It will not appear publicly until approved." }, origin);
    }
    if (action === "property.update") {
      const id = text(body.property_id, 80);
      const property = await propertyForHost(id, user.id);
      if (!property) return reply(403, { ok: false, error: "You can only edit your own property." }, origin);
      const patch: Record<string, unknown> = { published: false, moderation_status: "pending", moderation_notes: null, reviewed_at: null, reviewed_by: null, updated_at: new Date().toISOString() };
      for (const k of ["name","description","address","village","district","state"] as const) if (body[k] !== undefined) patch[k] = text(body[k], k === "description" ? 3000 : 240);
      if (body.property_type !== undefined && ["homestay","hotel","resort","villa","guesthouse","cottage","other"].includes(text(body.property_type, 30))) patch.property_type = text(body.property_type, 30);
      if (Array.isArray(body.amenities)) patch.amenities = body.amenities.filter((x) => typeof x === "string").map((x) => text(x, 80)).slice(0, 30);
      if (typeof patch.name === "string" && patch.name.length < 3) return reply(400, { ok: false, error: "The property name must contain at least 3 characters." }, origin);
      const updated = await send("properties?id=eq." + encodeURIComponent(id), "PATCH", patch);
      if (!updated.ok) return reply(503, { ok: false, error: "The listing could not be updated." }, origin);
      return reply(200, { ok: true, property: (await updated.json())[0], message: "Changes saved and sent for review. The listing will remain unpublished until approved." }, origin);
    }
    if (action === "property.submit") {
      const id = text(body.property_id, 80);
      if (!(await propertyForHost(id, user.id))) return reply(403, { ok: false, error: "You can only submit your own property." }, origin);
      const updated = await send("properties?id=eq." + encodeURIComponent(id), "PATCH", { published: false, moderation_status: "pending", moderation_notes: null, reviewed_at: null, reviewed_by: null, updated_at: new Date().toISOString() });
      if (!updated.ok || !(await updated.json()).length) return reply(503, { ok: false, error: "The listing could not be submitted." }, origin);
      return reply(200, { ok: true, message: "Your listing is awaiting Uttarkunth review." }, origin);
    }
    if (action === "room.create" || action === "room.update") {
      const propertyId = text(body.property_id, 80);
      const property = await propertyForHost(propertyId, user.id);
      if (!property) return reply(403, { ok: false, error: "You can only manage rooms for your own property." }, origin);
      const roomName = text(body.room_name, 120), rate = Number(body.base_price), capacity = Number(body.max_guests || 2);
      if (roomName.length < 2 || !Number.isFinite(rate) || rate < 0 || rate > 10000000 || !Number.isInteger(capacity) || capacity < 1 || capacity > 30) return reply(400, { ok: false, error: "Enter a room name, a valid nightly rate and guest capacity." }, origin);
      let r: Response;
      if (action === "room.create") {
        r = await send("room_units", "POST", { property_id: propertyId, room_name: roomName, description: text(body.description, 1000), max_guests: capacity, base_price: rate, active: true });
      } else {
        const roomId = text(body.room_id, 80);
        const matches = await rows("room_units?select=id,property_id&id=eq." + encodeURIComponent(roomId) + "&property_id=eq." + encodeURIComponent(propertyId) + "&limit=1");
        if (!matches.length) return reply(403, { ok: false, error: "This room does not belong to your property." }, origin);
        r = await send("room_units?id=eq." + encodeURIComponent(roomId) + "&property_id=eq." + encodeURIComponent(propertyId), "PATCH", { room_name: roomName, description: text(body.description, 1000), max_guests: capacity, base_price: rate });
      }
      if (!r.ok) return reply(503, { ok: false, error: "The room could not be saved." }, origin);
      const room = (await r.json())[0];
      await send("properties?id=eq." + encodeURIComponent(propertyId), "PATCH", { published: false, moderation_status: "pending", updated_at: new Date().toISOString() }).catch(() => {});
      return reply(200, { ok: true, room, message: "Room saved. Listing changes are pending review." }, origin);
    }
    if (action === "booking.decision") {
      const bookingId = text(body.booking_id, 80);
      const decision = text(body.decision, 20);
      if (!bookingId || !["confirm","decline"].includes(decision)) return reply(400, { ok: false, error: "Choose confirm or decline for a valid booking." }, origin);
      const r = await send("rpc/respond_to_stay_booking", "POST", {
        p_stay_booking_id: bookingId, p_action: decision, p_actor_user_id: user.id, p_host_notes: text(body.host_notes, 1000) || null
      }, "return=representation");
      if (!r.ok) return reply(r.status === 400 || r.status === 409 ? 409 : 403, { ok: false, error: "This booking could not be updated. It may no longer be pending, dates may conflict, or you may not manage this property." }, origin);
      return reply(200, { ok: true, result: await r.json() }, origin);
    }
    if (action === "availability.block") {
      const roomId = text(body.room_unit_id, 80), from = body.blocked_from, until = body.blocked_until;
      if (!isDate(from) || !isDate(until) || String(until) <= String(from)) return reply(400, { ok: false, error: "Choose valid blocked-from and blocked-until dates." }, origin);
      const found = await rows("room_units?select=id,property_id&id=eq." + encodeURIComponent(roomId) + "&limit=1");
      if (!found.length || !(await propertyForHost(found[0].property_id, user.id))) return reply(403, { ok: false, error: "You can only block dates for your own rooms." }, origin);
      const r = await send("room_availability_blocks", "POST", { room_unit_id: roomId, blocked_from: from, blocked_until: until, reason: text(body.reason, 240) || "Unavailable", created_by: user.id });
      if (!r.ok) return reply(503, { ok: false, error: "The dates could not be blocked. Refresh and try again." }, origin);
      return reply(200, { ok: true, block: (await r.json())[0] }, origin);
    }
    if (action === "availability.unblock") {
      const blockId = text(body.block_id, 80);
      const blocks = await rows("room_availability_blocks?select=id,room_unit_id&id=eq." + encodeURIComponent(blockId) + "&limit=1");
      if (!blocks.length) return reply(404, { ok: false, error: "Blocked dates not found." }, origin);
      const room = (await rows("room_units?select=property_id&id=eq." + encodeURIComponent(blocks[0].room_unit_id) + "&limit=1"))[0];
      if (!room || !(await propertyForHost(room.property_id, user.id))) return reply(403, { ok: false, error: "You can only remove blocks for your own property." }, origin);
      const r = await send("room_availability_blocks?id=eq." + encodeURIComponent(blockId), "DELETE", undefined, "return=minimal");
      if (!r.ok) return reply(503, { ok: false, error: "The block could not be removed." }, origin);
      return reply(200, { ok: true }, origin);
    }
    return reply(400, { ok: false, error: "Unsupported host action." }, origin);
  } catch (_) {
    return reply(503, { ok: false, error: "Host tools are temporarily unavailable. Please try again." }, origin);
  }
});