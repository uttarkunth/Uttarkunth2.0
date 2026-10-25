const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function response(statusCode, payload) {
  return { statusCode, headers, body: JSON.stringify(payload) };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return response(405, { ok: false, error: "Use GET to browse available stays." });
  }

  // This endpoint runs only on Netlify's server. Direct public-table reads are
  // intentionally restricted by the live RLS policy, so use the server-only
  // service key here and return an explicit public allow-list below.
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return response(503, { ok: false, error: "Stay listings are temporarily unavailable." });
  }

  async function getRows(path) {
    const url = new URL(path, supabaseUrl);
    const result = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: "Bearer " + supabaseKey,
        Accept: "application/json"
      }
    });
    if (!result.ok) throw new Error("listing query failed");
    return result.json();
  }

  try {
    // Explicit public allow-list. Never return host or private moderation fields.
    const properties = await getRows(
      "/rest/v1/properties?select=id,slug,name,description,address,village,district,state,latitude,longitude,amenities,photos,booking_mode,property_type&published=eq.true&moderation_status=eq.approved&order=name.asc"
    );
    if (!properties.length) {
      return response(200, { ok: true, count: 0, properties: [] });
    }

    const ids = properties.map((property) => property.id).filter(Boolean);
    if (!ids.length) return response(200, { ok: true, count: 0, properties: [] });

    const rooms = await getRows(
      "/rest/v1/room_units?select=id,property_id,room_name,description,max_guests,base_price,active&active=eq.true&property_id=in.(" +
      ids.map(encodeURIComponent).join(",") + ")&order=base_price.asc"
    );

    const byProperty = new Map();
    for (const room of rooms) {
      if (!byProperty.has(room.property_id)) byProperty.set(room.property_id, []);
      byProperty.get(room.property_id).push({
        id: room.id,
        property_id: room.property_id,
        room_name: room.room_name,
        description: room.description,
        max_guests: room.max_guests,
        base_price: room.base_price
      });
    }

    const publicProperties = properties.map((property) => ({
      ...property,
      rooms: byProperty.get(property.id) || []
    }));

    return response(200, {
      ok: true,
      count: publicProperties.length,
      properties: publicProperties
    });
  } catch (_) {
    return response(503, { ok: false, error: "Stay listings are temporarily unavailable." });
  }
};
