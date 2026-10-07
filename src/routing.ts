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
  const [osrm] = await osrmRoutes(start, end, via);
  return osrm ?? null;
}

/** Routes offered to choose from: the best one first. */
export const MAX_ROUTES = 3;

/**
 * The route and, from OSRM, up to two alternatives, best first; empty when routing fails.
 * OpenRouteService answers with its one route.
 */
export async function fetchRoutes(
  start: LngLat,
  end: LngLat,
  preference: "shortest" | "fastest",
): Promise<RouteResult[]> {
  const orsKey = import.meta.env.VITE_ORS_KEY as string | undefined;
  if (orsKey) {
    const ors = await openRoute(start, end, preference, orsKey);
    if (ors) return [ors];
  }
  const routes = await osrmRoutes(start, end, undefined, MAX_ROUTES - 1);
  if (routes.length) return routes.slice(0, MAX_ROUTES);
  // A server that refuses alternatives still answers a plain route.
  return osrmRoutes(start, end);
}

async function osrmRoutes(
  start: LngLat,
  end: LngLat,
  via?: LngLat,
  alternatives = 0,
): Promise<RouteResult[]> {
  const parts = [start, via, end].filter(Boolean) as LngLat[];
  const coords = parts.map((p) => `${p.lon},${p.lat}`).join(";");
  // Reach a station with it on the driver's side, as fetchDetours does.
  const approaches = via ? "&approaches=unrestricted;curb;unrestricted" : "";
  const alts = alternatives > 0 ? `&alternatives=${alternatives}` : "";
  const url = `${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson${approaches}${alts}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = (await res.json()) as {
      code?: string;
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: [number, number][] };
      }>;
    };
    return (json.routes ?? []).map((r) => ({
      geometry: r.geometry.coordinates.map(([lon, lat]) => ({ lon, lat })),
      distanceKm: r.distance / 1000,
      durationMin: r.duration / 60,
      profile: "fastest" as const,
    }));
  } catch {
    return [];
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
  /** What leave → stop → rejoin adds over leave → rejoin. */
  extraKm: number;
  extraMin: number;
}

/** A stop and the route points where the trip leaves for it and rejoins. */
export interface DetourTrip {
  leave: LngLat & { bearing: number };
  stop: LngLat;
  rejoin: LngLat & { bearing: number };
}

interface OsrmTable {
  code?: string;
  durations?: Array<Array<number | null>>;
  distances?: Array<Array<number | null>>;
}

/** Stops per table request: 90 coordinates and a 60 × 60 table, under osrm-routed's 100. */
const TABLE_CHUNK = 30;
/** How far a route point's road may turn from the route heading and still be the route. */
const BEARING_RANGE = 60;

/**
 * Road detour for each stop from OSRM's table service: leave the route, visit the stop, rejoin
 * the route, against driving straight through. The route points keep the route's heading, and
 * stops are reached and left on the driver's side of the road (`approaches=curb`), so a station
 * across the road costs its turnaround. Null when the service fails; a stop the router cannot
 * reach is null.
 */
export async function fetchDetours(trips: DetourTrip[]): Promise<Array<Detour | null> | null> {
  if (trips.length === 0) return [];
  const chunks: DetourTrip[][] = [];
  for (let i = 0; i < trips.length; i += TABLE_CHUNK) chunks.push(trips.slice(i, i + TABLE_CHUNK));
  const parts = await Promise.all(chunks.map(osrmDetours));
  if (parts.some((p) => p == null)) return null;
  return (parts as Array<Array<Detour | null>>).flat();
}

async function osrmDetours(trips: DetourTrip[]): Promise<Array<Detour | null> | null> {
  const n = trips.length;
  // Coordinates: every leave point, then every stop, then every rejoin point.
  const points = [
    ...trips.map((t) => t.leave),
    ...trips.map((t) => t.stop),
    ...trips.map((t) => t.rejoin),
  ];
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const indices = (from: number, to: number): string =>
    Array.from({ length: to - from }, (_, i) => from + i).join(";");
  const heading = (p: { bearing: number }): string =>
    `${Math.round(p.bearing) % 360},${BEARING_RANGE}`;
  const bearings = [
    ...trips.map((t) => heading(t.leave)),
    ...trips.map(() => ""),
    ...trips.map((t) => heading(t.rejoin)),
  ].join(";");
  const approaches = [
    ...trips.map(() => "unrestricted"),
    ...trips.map(() => "curb"),
    ...trips.map(() => "unrestricted"),
  ].join(";");
  const url =
    `${OSRM}/table/v1/driving/${coords}?sources=${indices(0, 2 * n)}` +
    `&destinations=${indices(n, 3 * n)}&annotations=duration,distance` +
    `&bearings=${bearings}&approaches=${approaches}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return detoursFromTable((await res.json()) as OsrmTable, n);
  } catch {
    return null;
  }
}

/**
 * Sources are [...leave, ...stops] and destinations [...stops, ...rejoin], so for stop k:
 * leave → stop is [k][k], stop → rejoin is [n + k][n + k], and leave → rejoin is [k][n + k].
 */
export function detoursFromTable(json: OsrmTable, n: number): Array<Detour | null> | null {
  const { durations: s, distances: m } = json;
  if (json.code !== "Ok" || !s || !m) return null;
  return Array.from({ length: n }, (_, k) => {
    const toS = s[k]?.[k];
    const toM = m[k]?.[k];
    const backS = s[n + k]?.[n + k];
    const backM = m[n + k]?.[n + k];
    const directS = s[k]?.[n + k];
    const directM = m[k]?.[n + k];
    if (toS == null || toM == null || backS == null || backM == null) return null;
    if (directS == null || directM == null) return null;
    return {
      extraKm: Math.max(0, (toM + backM - directM) / 1000),
      extraMin: Math.max(0, (toS + backS - directS) / 60),
    };
  });
}
