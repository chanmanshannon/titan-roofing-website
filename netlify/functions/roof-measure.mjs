/*
 * Roof measurement endpoint for the Titan estimator.
 *
 *   GET /api/roof-measure?address=123 Main St, Conroe TX
 *     -> { ok, address, lat, lng, roofAreaSqft, pitchRise, segments, quality, imageryDate, ... }
 *   GET /api/roof-measure?image=1&lat=..&lng=..
 *     -> satellite photo of the home (PNG), so the API key never reaches the browser.
 *
 * Needs one environment variable in Netlify (Site settings > Environment variables):
 *   GOOGLE_MAPS_API_KEY  — a Google Cloud key with these APIs enabled:
 *                           Geocoding API, Solar API, Maps Static API
 * Without the key the endpoint returns 501 and the estimator falls back to
 * asking for home size instead. Set daily quota caps in Google Cloud so a
 * bot can't run up the bill.
 */

const SQFT_PER_M2 = 10.7639;
// Rough box around the Titan service area (Texas Gulf Coast to Brazos Valley).
const BOUNDS = { minLat: 28.4, maxLat: 31.6, minLng: -97.6, maxLng: -93.4 };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });

const inBounds = (lat, lng) =>
  lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;

function distanceMeters(a, b) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function satelliteImage(url, key) {
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inBounds(lat, lng)) {
    return json({ ok: false, reason: "bad_location" }, 400);
  }
  const params = new URLSearchParams({
    center: `${lat},${lng}`,
    zoom: "20",
    size: "640x400",
    scale: "2",
    maptype: "satellite",
    key
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/staticmap?${params}`);
  if (!res.ok) return json({ ok: false, reason: "image_unavailable" }, 502);
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") || "image/png",
      "cache-control": "public, max-age=86400"
    }
  });
}

export default async (req) => {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const url = new URL(req.url);
  // Lets the page check, without a Google call, whether satellite measuring is on.
  if (url.searchParams.get("probe")) return json({ ok: true, configured: Boolean(key) });
  if (!key) return json({ ok: false, reason: "not_configured" }, 501);

  try {
    if (url.searchParams.get("image")) return await satelliteImage(url, key);

    const address = (url.searchParams.get("address") || "").trim().slice(0, 200);
    if (address.length < 6) return json({ ok: false, reason: "address_too_short" }, 400);

    // 1) Address -> coordinates (limited to Texas)
    const geoParams = new URLSearchParams({
      address,
      components: "country:US|administrative_area:TX",
      key
    });
    const geo = await (await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${geoParams}`)).json();
    const hit = geo.results && geo.results[0];
    if (geo.status !== "OK" || !hit) return json({ ok: false, reason: "address_not_found" }, 404);

    const precise =
      ["ROOFTOP", "RANGE_INTERPOLATED"].includes(hit.geometry.location_type) &&
      hit.types.some((t) => ["street_address", "premise", "subpremise"].includes(t));
    if (!precise) return json({ ok: false, reason: "address_not_precise", address: hit.formatted_address }, 422);

    const { lat, lng } = hit.geometry.location;
    if (!inBounds(lat, lng)) {
      return json({ ok: false, reason: "outside_service_area", address: hit.formatted_address }, 422);
    }

    // 2) Coordinates -> roof geometry (Google Solar API)
    const solarParams = new URLSearchParams({
      "location.latitude": String(lat),
      "location.longitude": String(lng),
      requiredQuality: "LOW",
      key
    });
    const solarRes = await fetch(`https://solar.googleapis.com/v1/buildingInsights:findClosest?${solarParams}`);
    if (!solarRes.ok) {
      return json({ ok: false, reason: "roof_not_found", address: hit.formatted_address, lat, lng }, 404);
    }
    const b = await solarRes.json();
    const sp = b.solarPotential || {};
    const segs = (sp.roofSegmentStats || []).filter((s) => s.stats && s.stats.areaMeters2 >= 3);

    const segArea = segs.reduce((sum, s) => sum + s.stats.areaMeters2, 0);
    const roofM2 = (sp.wholeRoofStats && sp.wholeRoofStats.areaMeters2) || segArea;
    if (!roofM2) return json({ ok: false, reason: "roof_not_found", address: hit.formatted_address, lat, lng }, 404);

    // Area-weighted median pitch, ignoring flat bits like porches and AC pads.
    const sloped = segs.filter((s) => (s.pitchDegrees || 0) >= 7).sort((x, y) => x.pitchDegrees - y.pitchDegrees);
    const slopedArea = sloped.reduce((sum, s) => sum + s.stats.areaMeters2, 0);
    let pitchDegrees = null;
    let acc = 0;
    for (const s of sloped) {
      acc += s.stats.areaMeters2;
      if (acc >= slopedArea / 2) { pitchDegrees = s.pitchDegrees; break; }
    }
    const flatShare = segArea ? 1 - slopedArea / segArea : 0;

    const center = b.center ? { lat: b.center.latitude, lng: b.center.longitude } : { lat, lng };
    const d = b.imageryDate;

    return json({
      ok: true,
      address: hit.formatted_address,
      lat,
      lng,
      buildingLat: center.lat,
      buildingLng: center.lng,
      distanceFromAddressM: Math.round(distanceMeters({ lat, lng }, center)),
      roofAreaSqft: Math.round(roofM2 * SQFT_PER_M2),
      groundAreaSqft: Math.round(segs.reduce((sum, s) => sum + (s.stats.groundAreaMeters2 || 0), 0) * SQFT_PER_M2),
      pitchDegrees: pitchDegrees == null ? null : Math.round(pitchDegrees * 10) / 10,
      pitchRise: pitchDegrees == null ? null : Math.round(Math.tan((pitchDegrees * Math.PI) / 180) * 12 * 10) / 10,
      flatShare: Math.round(flatShare * 100) / 100,
      segments: segs.length,
      quality: b.imageryQuality || "UNKNOWN",
      imageryDate: d ? `${d.year}-${String(d.month).padStart(2, "0")}` : null
    });
  } catch (err) {
    return json({ ok: false, reason: "lookup_failed" }, 502);
  }
};

export const config = { path: "/api/roof-measure" };
