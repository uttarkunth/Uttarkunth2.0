import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
const founderEmail = "uttarkunth@gmail.com";
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
function reply(status: number, data: unknown, origin: string | null) { return new Response(JSON.stringify(data), { status, headers: cors(origin) }); }
const text = (v: unknown, n = 500) => typeof v === "string" ? v.trim().slice(0, n) : "";
function isDate(v: unknown): v is string { if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false; const d = new Date(v + "T00:00:00Z"); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; }
async function db(path: string, init: RequestInit = {}) { return await fetch(base + "/rest/v1/" + path, { ...init, headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Accept: "application/json", ...(init.headers || {}) } }); }
async function rows(path: string) { const r = await db(path); if (!r.ok) throw new Error("Database request failed"); return await r.json(); }
async function send(path: string, method: string, data?: unknown, prefer = "return=representation") { return await db(path, { method, headers: { Prefer: prefer }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); }
async function currentUser(req: Request) {
  const match = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1] || !anonKey) return null;
  const r = await fetch(base + "/auth/v1/user", { headers: { apikey: anonKey, Authorization: "Bearer " + match[1], Accept: "application/json" } });
  if (!r.ok) return null;
  const user = await r.json();
  return user && user.id && user.email && user.email_confirmed_at ? user : null;
}
async function adminCheck(user: Record<string, any>) {
  const matches = await rows("platform_admins?select=user_id,email,role&user_id=eq." + encodeURIComponent(user.id) + "&role=eq.admin&limit=1");
  return matches.length > 0;
}
async function audit(userId: string, action: string, targetType: string, targetId: string, details: unknown) {
  await send("admin_audit_log", "POST", { actor_user_id: userId, action, target_type: targetType, target_id: targetId, details }).catch(() => {});
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (!allowedOrigin(origin)) return reply(403, { ok: false, error: "Origin not allowed." }, origin);
  if (!["GET", "POST"].includes(req.method)) return reply(405, { ok: false, error: "Use GET or POST." }, origin);
  if (!base || !serviceKey || !anonKey) return reply(503, { ok: false, error: "Administration is temporarily unavailable." }, origin);
  const user = await currentUser(req);
  if (!user) return reply(401, { ok: false, error: "Sign in with a verified administrator account." }, origin);
  let body: Record<string, unknown> = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Enter valid information." }, origin); } }
  const action = text(body.action, 50);
  try {
    if (req.method === "POST" && action === "bootstrap") {
      const adminCount = await rows("platform_admins?select=user_id&role=eq.admin&limit=1");
      if (adminCount.length) return reply(409, { ok: false, error: "An administrator is already registered. Ask an existing administrator to grant access." }, origin);
      if (String(user.email).toLowerCase() !== founderEmail) return reply(403, { ok: false, error: "Only the verified founding Uttarkunth account can claim first administrator access." }, origin);
      const added = await send("platform_admins", "POST", { user_id: user.id, email: founderEmail, role: "admin" });
      if (!added.ok) return reply(503, { ok: false, error: "Administrator access could not be provisioned. Please contact the project owner." }, origin);
      await audit(user.id, "property_moderated", "property", "00000000-0000-0000-0000-000000000000", { action: "first_admin_bootstrap" });
      return reply(200, { ok: true, message: "Administrator account created. Reload the dashboard." }, origin);
    }
    if (!(await adminCheck(user))) return reply(403, { ok: false, error: "This account does not have Uttarkunth administrator permissions." }, origin);
    if (req.method === "GET") {
      const [properties, rooms, bookings, agreements, hostLinks, auditLog, usersResponse] = await Promise.all([
        rows("properties?select=id,slug,name,description,address,village,district,state,property_type,photos,published,moderation_status,moderation_notes,reviewed_at,reviewed_by,host_id,created_at,updated_at&order=created_at.desc&limit=1000"),
        rows("room_units?select=id,property_id,room_name,max_guests,base_price,active&limit=2000"),
        rows("stay_bookings?select=id,booking_reference,property_id,room_unit_id,guest_name,guest_email,guest_phone,check_in,check_out,adults,children,status,total_estimate,created_at,updated_at,commission_percent_snapshot,commission_amount_snapshot&order=created_at.desc&limit=2000"),
        rows("host_agreements?select=id,property_id,host_name,host_contact,agreement_start,agreement_end,commission_percent,agreement_status,notes,host_user_id,terms_version,accepted_at,intro_commission_percent,intro_period_months,standard_commission_percent,created_at&order=created_at.desc&limit=1000"),
        rows("property_hosts?select=id,property_id,user_id,created_at&limit=1000"),
        rows("admin_audit_log?select=id,actor_user_id,action,target_type,target_id,details,created_at&order=created_at.desc&limit=200"),
        (async () => { const r = await fetch(base + "/auth/v1/admin/users?page=1&per_page=200", { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" } }); if (!r.ok) return { users: [] }; const data = await r.json(); return { users: Array.isArray(data.users) ? data.users.map((u: Record<string, any>) => ({ id: u.id, email: u.email, name: u.user_metadata?.full_name || u.user_metadata?.name || "", email_confirmed_at: u.email_confirmed_at })) : [] }; })()
      ]);
      return reply(200, { ok: true, user: { id: user.id, email: user.email }, properties, rooms, bookings, agreements, host_links: hostLinks, audit: auditLog, users: usersResponse.users }, origin);
    }
    if (action === "property.moderate") {
      const id = text(body.property_id, 80), status = text(body.status, 40);
      const note = text(body.note, 1000);
      if (!id || !["approved","rejected","changes_requested","suspended"].includes(status)) return reply(400, { ok: false, error: "Choose a valid moderation decision." }, origin);
      const r = await send("properties?id=eq." + encodeURIComponent(id), "PATCH", { moderation_status: status, moderation_notes: note || null, published: status === "approved", reviewed_at: new Date().toISOString(), reviewed_by: user.id, updated_at: new Date().toISOString() });
      if (!r.ok || !(await r.json()).length) return reply(404, { ok: false, error: "Property not found or could not be updated." }, origin);
      await audit(user.id, "property_moderated", "property", id, { status, note });
      return reply(200, { ok: true, status }, origin);
    }
    if (action === "host.assign") {
      const propertyId = text(body.property_id, 80), hostId = text(body.host_user_id, 80);
      if (!propertyId || !hostId) return reply(400, { ok: false, error: "Choose a property and a verified host account." }, origin);
      const users = await fetch(base + "/auth/v1/admin/users/" + encodeURIComponent(hostId), { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" } });
      if (!users.ok) return reply(404, { ok: false, error: "Host account not found." }, origin);
      const host = await users.json();
      if (!host.email_confirmed_at) return reply(409, { ok: false, error: "Host email must be confirmed before assigning a property." }, origin);
      const props = await rows("properties?select=id,host_id,name&id=eq." + encodeURIComponent(propertyId) + "&limit=1");
      if (!props.length) return reply(404, { ok: false, error: "Property not found." }, origin);
      if (props[0].host_id && props[0].host_id !== hostId) return reply(409, { ok: false, error: "This property already has a host. Reassignment requires a separate verified handover." }, origin);
      const updated = await send("properties?id=eq." + encodeURIComponent(propertyId), "PATCH", { host_id: hostId, updated_at: new Date().toISOString() });
      if (!updated.ok) return reply(503, { ok: false, error: "Property assignment could not be saved." }, origin);
      const existingLink = await rows("property_hosts?select=id&property_id=eq." + encodeURIComponent(propertyId) + "&user_id=eq." + encodeURIComponent(hostId) + "&limit=1");
      if (!existingLink.length) {
        const link = await send("property_hosts", "POST", { property_id: propertyId, user_id: hostId });
        if (!link.ok) return reply(503, { ok: false, error: "Primary host saved, but backup host assignment did not finish. Review the property before further changes." }, origin);
      }
      await audit(user.id, "host_assigned", "property", propertyId, { host_user_id: hostId, email: host.email });
      return reply(200, { ok: true, message: "Host assignment saved." }, origin);
    }
    if (action === "booking.decision") {
      const bookingId = text(body.booking_id, 80), decision = text(body.decision, 20);
      if (!bookingId || !["confirm","decline","cancel"].includes(decision)) return reply(400, { ok: false, error: "Choose a valid booking decision." }, origin);
      const r = await send("rpc/respond_to_stay_booking", "POST", { p_stay_booking_id: bookingId, p_action: decision, p_actor_user_id: user.id, p_host_notes: text(body.note, 1000) || null });
      if (!r.ok) return reply(409, { ok: false, error: "The booking could not be updated. Check its current status and dates." }, origin);
      const result = await r.json();
      await audit(user.id, "booking_decided", "booking", bookingId, { decision, result });
      return reply(200, { ok: true, result }, origin);
    }
    if (action === "agreement.save") {
      const propertyId = text(body.property_id, 80), hostId = text(body.host_user_id, 80);
      const start = body.agreement_start, end = body.agreement_end || null;
      const signed = body.signed === true;
      const status = signed ? "active" : "draft";
      const notes = text(body.notes, 1500);
      if (!propertyId || !hostId || !isDate(start) || (end && (!isDate(end) || String(end) < String(start)))) return reply(400, { ok: false, error: "Choose a property, host and valid agreement dates." }, origin);
      if (signed && String(start) > new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())) return reply(400, { ok: false, error: "A signed agreement cannot be effective in the future." }, origin);
      const users = await fetch(base + "/auth/v1/admin/users/" + encodeURIComponent(hostId), { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" } });
      if (!users.ok) return reply(404, { ok: false, error: "Host account not found." }, origin);
      const host = await users.json();
      if (!host.email_confirmed_at) return reply(409, { ok: false, error: "Host email must be confirmed before signing an agreement." }, origin);
      const property = (await rows("properties?select=id,name,host_id&id=eq." + encodeURIComponent(propertyId) + "&limit=1"))[0];
      if (!property || (property.host_id !== hostId && !(await rows("property_hosts?select=id&property_id=eq." + encodeURIComponent(propertyId) + "&user_id=eq." + encodeURIComponent(hostId) + "&limit=1")).length)) {
        return reply(409, { ok: false, error: "Assign this verified host to the property before creating an agreement." }, origin);
      }
      const agreement = {
        property_id: propertyId, host_user_id: hostId, host_name: text(host.user_metadata?.full_name || host.email, 160),
        host_contact: text(host.phone || "", 80) || null, agreement_start: start, agreement_end: end,
        commission_percent: 0, intro_commission_percent: 0, intro_period_months: 12,
        standard_commission_percent: 10, agreement_status: status,
        accepted_at: signed ? new Date().toISOString() : null, terms_version: "uttarkunth-stays-v1",
        notes
      };
      const r = await send("host_agreements", "POST", agreement);
      if (!r.ok) return reply(503, { ok: false, error: "The agreement could not be saved." }, origin);
      const row = (await r.json())[0];
      await audit(user.id, "agreement_saved", "agreement", row.id, { property_id: propertyId, host_user_id: hostId, status });
      return reply(200, { ok: true, agreement: row, message: signed ? "Agreement recorded as signed." : "Draft agreement saved. It does not activate commission terms until signed." }, origin);
    }
    return reply(400, { ok: false, error: "Unsupported administrator action." }, origin);
  } catch (_) {
    return reply(503, { ok: false, error: "Administration is temporarily unavailable. Please try again." }, origin);
  }
});