
exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Supabase environment variables are not configured."
      })
    };
  }

  try {
    // Fetch published properties, including their photo URLs.
    const endpoint = new URL("/rest/v1/properties", supabaseUrl);
    endpoint.searchParams.set(
      "select",
      "id,slug,name,village,district,state,booking_mode,photos"
    );
    endpoint.searchParams.set("published", "eq.true");
    endpoint.searchParams.set("order", "name.asc");

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          ok: false,
          error: "Supabase properties request failed.",
          upstreamStatus: response.status
        })
      };
    }

    const properties = await response.json();

    // Fetch room prices and capacity for these properties.
    const roomsEndpoint = new URL("/rest/v1/room_units", supabaseUrl);
    roomsEndpoint.searchParams.set(
      "select",
      "id,property_id,room_name,description,max_guests,base_price,active"
    );
    roomsEndpoint.searchParams.set("active", "eq.true");

    const roomsResponse = await fetch(roomsEndpoint.toString(), {
      method: "GET",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Accept": "application/json"
      }
    });

    if (!roomsResponse.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          ok: false,
          error: "Supabase room information request failed.",
          upstreamStatus: roomsResponse.status
        })
      };
    }

    const rooms = await roomsResponse.json();

    // Attach each property's rooms using its property ID.
    const propertiesWithRooms = properties.map((property) => ({
      ...property,
      rooms: rooms.filter(
        (room) => room.property_id === property.id
      )
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        count: propertiesWithRooms.length,
        properties: propertiesWithRooms
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: "Unable to reach Supabase. Check the project URL and function environment."
      })
    };
  }
};
