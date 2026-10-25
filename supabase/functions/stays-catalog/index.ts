import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const allowedOrigin = (origin: string | null) => {
  if (!origin) return true;
  return origin === "https://uttarkunth.netlify.app" ||
    origin === "https://uttarkunth.netlify.com" ||
    /^https:\/\/deploy-preview-\d+--uttarkunth\.netlify\.app$/.test(origin) ||
    /^http:\/\/localhost:(\d+)$/.test(origin);
};
function headers(origin: string | null) {
  const h: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
  };
  if (origin && allowedOrigin(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function reply(status: number, data: unknown, origin: string | null) {
  return new Response(JSON.stringify(data), { status, headers: headers(origin) });
}
async function rows(path: string) {
  const response = await fetch(base + "/rest/v1/" + path, {
    headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, Accept: "application/json" }
  });
  if (!response.ok) throw new Error("catalog query failed");
  return await response.json();
}
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
  if (!allowedOrigin(origin)) return reply(403, { ok: false, error: "Origin not allowed." }, origin);
  if (req.method !== "GET") return reply(405, { ok: false, error: "Use GET to browse stays." }, origin);
  if (!base || !serviceKey) return reply(503, { ok: false, error: "Stay listings are temporarily unavailable." }, origin);
  try {
    const [properties, rooms] = await Promise.all([
      rows("properties?select=id,slug,name,description,address,village,district,state,latitude,longitude,amenities,photos,booking_mode,property_type&published=eq.true&moderation_status=eq.approved&order=name.asc&limit=500"),
      rows("room_units?select=id,property_id,room_name,description,max_guests,base_price,active&active=eq.true&order=base_price.asc&limit=1000")
    ]);
    const activeByProperty = new Map<string, unknown[]>();
    for (const room of rooms as Array<Record<string, unknown>>) {
      const id = String(room.property_id || "");
      if (!id) continue;
      if (!activeByProperty.has(id)) activeByProperty.set(id, []);
      activeByProperty.get(id)!.push({
        id: room.id,
        room_name: room.room_name,
        description: room.description,
        max_guests: room.max_guests,
        base_price: room.base_price
      });
    }
    const result = (properties as Array<Record<string, unknown>>).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      address: p.address,
      village: p.village,
      district: p.district,
      state: p.state,
      latitude: p.latitude,
      longitude: p.longitude,
      amenities: Array.isArray(p.amenities) ? p.amenities : [],
      photos: Array.isArray(p.photos) ? p.photos : [],
      booking_mode: p.booking_mode || "request",
      property_type: p.property_type || "homestay",
      rooms: activeByProperty.get(String(p.id)) || []
    }));
    return reply(200, { ok: true, properties: result, updated_at: new Date().toISOString() }, origin);
  } catch (_) {
    return reply(503, { ok: false, error: "Stay listings are temporarily unavailable." }, origin);
  }
});