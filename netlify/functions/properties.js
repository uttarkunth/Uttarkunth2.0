exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: false, error: "Supabase environment variables are not configured." })
    };
  }

  try {
    const endpoint = new URL("/rest/v1/properties", supabaseUrl);
    endpoint.searchParams.set("select", "id,slug,name,village,district,state,booking_mode");
    endpoint.searchParams.set("published", "eq.true");

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
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        body: JSON.stringify({
          ok: false,
          error: "Supabase request failed.",
          upstreamStatus: response.status
        })
      };
    }

    const properties = await response.json();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify({ ok: true, count: properties.length, properties })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: false, error: "Unable to reach Supabase. Check the project URL and function environment." })
    };
  }
};
