import { LT_BOUNDS } from "./types.ts";
import type { Locale } from "./i18n/index.ts";
import type { LngLat } from "./geo.ts";

export interface GeoHit {
  label: string;
  lat: number;
  lon: number;
}

function featureLabel(p: {
  name?: string;
  street?: string;
  housenumber?: string;
  city?: string;
}): string {
  return [p.name, [p.street, p.housenumber].filter(Boolean).join(" "), p.city]
    .filter(Boolean)
    .join(", ");
}

interface PhotonResponse {
  features?: Array<{
    geometry: { coordinates: [number, number] };
    properties: { name?: string; street?: string; housenumber?: string; city?: string };
  }>;
}

function parseHits(json: PhotonResponse): GeoHit[] {
  return (json.features ?? []).map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    return {
      label: featureLabel(f.properties) || `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
      lat,
      lon,
    };
  });
}

export async function geocode(query: string, locale: Locale): Promise<GeoHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("lang", locale === "lt" ? "default" : locale);
  url.searchParams.set("limit", "5");
  url.searchParams.set("lat", "55.3");
  url.searchParams.set("lon", "23.9");
  url.searchParams.set(
    "bbox",
    `${LT_BOUNDS.minLon},${LT_BOUNDS.minLat},${LT_BOUNDS.maxLon},${LT_BOUNDS.maxLat}`,
  );
  const res = await fetch(url);
  if (!res.ok) return [];
  return parseHits((await res.json()) as PhotonResponse);
}

export async function reverseGeocode(ll: LngLat, locale: Locale): Promise<GeoHit | null> {
  const url = new URL("https://photon.komoot.io/reverse");
  url.searchParams.set("lat", String(ll.lat));
  url.searchParams.set("lon", String(ll.lon));
  url.searchParams.set("lang", locale === "lt" ? "default" : locale);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return parseHits((await res.json()) as PhotonResponse)[0] ?? null;
  } catch {
    return null;
  }
}

export interface RouteResult {
  geometry: LngLat[];
  distanceKm: number;
  durationMin: number;
  profile: "shortest" | "fastest";
}

export async function fetchRoute(
  start: LngLat,
  end: LngLat,
  preference: "shortest" | "fastest",
  via?: LngLat,
): Promise<RouteResult | null> {
  const orsKey = import.meta.env.VITE_ORS_KEY as string | undefined;
  if (orsKey) {
    const ors = await openRoute(start, end, preference, orsKey, via);
    if (ors) return ors;
  }
  const osrm = await osrmRoute(start, end, via);
  if (osrm) return { ...osrm, profile: "fastest" };
  return null;
}

async function osrmRoute(
  start: LngLat,
  end: LngLat,
  via?: LngLat,
): Promise<Omit<RouteResult, "profile"> | null> {
  const parts = [start, via, end].filter(Boolean) as LngLat[];
  const coords = parts.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
      }>;
    };
    const r = json.routes?.[0];
    if (!r) return null;
    return {
      geometry: r.geometry.coordinates.map(([lon, lat]) => ({ lon, lat })),
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
    };
  } catch {
    return null;
  }
}

async function openRoute(
  start: LngLat,
  end: LngLat,
  preference: "shortest" | "fastest",
  key: string,
  via?: LngLat,
): Promise<RouteResult | null> {
  const coords = [start, via, end].filter(Boolean).map((p) => [p!.lon, p!.lat]);
  try {
    const res = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({
        coordinates: coords,
        preference: preference === "shortest" ? "shortest" : "fastest",
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      features: Array<{
        geometry: { coordinates: [number, number][] };
        properties: { summary: { distance: number; duration: number } };
      }>;
    };
    const f = json.features?.[0];
    if (!f) return null;
    return {
      geometry: f.geometry.coordinates.map(([lon, lat]) => ({ lon, lat })),
      distanceKm: f.properties.summary.distance / 1000,
      durationMin: f.properties.summary.duration / 60,
      profile: preference,
    };
  } catch {
    return null;
  }
}
