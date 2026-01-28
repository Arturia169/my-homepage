export async function onRequest({ env, request }) {
  const url = new URL(request.url);
  const city =
    url.searchParams.get("city") ||
    env.WEATHER_CITY ||
    env.WEATHER_DEFAULT_CITY;

  if (!city) return json(400, { error: "Missing city" });

  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    city
  )}&count=1&language=zh&format=json`;
  const geo = await fetchJson(geoUrl);
  const place = geo.json?.results?.[0];
  if (!place) return json(404, { error: "City not found" });

  const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current_weather=true&timezone=auto`;
  const forecast = await fetchJson(forecastUrl);
  const current = forecast.json?.current_weather;

  if (!current) {
    return json(502, { error: "Weather unavailable" });
  }

  return json(200, {
    city: place.name,
    time: current.time,
    temperature: Math.round(current.temperature),
    wind: Math.round(current.windspeed),
    code: current.weathercode,
    updated_at: new Date().toISOString(),
  });
}

async function fetchJson(url, headers) {
  const r = await fetch(url, { headers });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, json: j };
}

function json(status, obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
