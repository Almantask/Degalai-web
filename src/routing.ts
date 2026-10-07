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

const OSRM = "https://router.project-osrm.org";

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
  // Reach a station with it on the driver's side, as fetchDetours does.
  const approaches = via ? "&approaches=unrestricted;curb;unrestricted" : "";
  const url = `${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson${approaches}`;
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

export interface Detour {
  /** Road distance from the start to the stop. */
  toKm: number;
  /** What start → stop → end adds over start → end. */
  extraKm: number;
  extraMin: number;
}

interface OsrmTable {
  code?: string;
  durations?: Array<Array<number | null>>;
  distances?: Array<Array<number | null>>;
}

/** Stops per table request; osrm-routed caps a table at 100 coordinates by default. */
const TABLE_CHUNK = 50;

/**
 * Road detour through each stop, from OSRM's table service: one request per 50 stops instead
 * of a via-route each. Stops are reached and left on the driver's side of the road
 * (`approaches=curb`), so a station across the road costs its turnaround. Null when the service
 * fails; a stop the router cannot reach is null.
 */
export async function fetchDetours(
  start: LngLat,
  end: LngLat,
  stops: LngLat[],
): Promise<Array<Detour | null> | null> {
  if (stops.length === 0) return [];
  const chunks: LngLat[][] = [];
  for (let i = 0; i < stops.length; i += TABLE_CHUNK) chunks.push(stops.slice(i, i + TABLE_CHUNK));
  const parts = await Promise.all(chunks.map((chunk) => osrmDetours(start, end, chunk)));
  if (parts.some((p) => p == null)) return null;
  return (parts as Array<Array<Detour | null>>).flat();
}

async function osrmDetours(
  start: LngLat,
  end: LngLat,
  stops: LngLat[],
): Promise<Array<Detour | null> | null> {
  const n = stops.length;
  const coords = [start, ...stops, end].map((p) => `${p.lon},${p.lat}`).join(";");
  const indices = (from: number, to: number): string =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i).join(";");
  const approaches = ["unrestricted", ...stops.map(() => "curb"), "unrestricted"].join(";");
  const url =
    `${OSRM}/table/v1/driving/${coords}?sources=${indices(0, n)}` +
    `&destinations=${indices(1, n + 1)}&annotations=duration,distance&approaches=${approaches}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return detoursFromTable((await res.json()) as OsrmTable, n);
  } catch {
    return null;
  }
}

/**
 * Sources are [start, ...stops] and destinations [...stops, end], so row 0 is start → each
 * stop, column n is each stop → end, and [0][n] is the direct trip.
 */
export function detoursFromTable(json: OsrmTable, n: number): Array<Detour | null> | null {
  const { durations: s, distances: m } = json;
  if (json.code !== "Ok" || !s || !m) return null;
  const directS = s[0]?.[n];
  const directM = m[0]?.[n];
  if (directS == null || directM == null) return null;
  return Array.from({ length: n }, (_, k) => {
    const toS = s[0]?.[k];
    const toM = m[0]?.[k];
    const fromS = s[k + 1]?.[n];
    const fromM = m[k + 1]?.[n];
    if (toS == null || toM == null || fromS == null || fromM == null) return null;
    return {
      toKm: toM / 1000,
      extraKm: Math.max(0, (toM + fromM - directM) / 1000),
      extraMin: Math.max(0, (toS + fromS - directS) / 60),
    };
  });
}
