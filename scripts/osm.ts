import { inLithuania } from "../src/geo.ts";
import { normalizeBrand, osmFuels } from "../src/brands.ts";
import type { Station } from "../src/types.ts";
import { sleep } from "./geocode.ts";

export const MIN_OSM_STATIONS = 500;

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const AREA_QUERY = `
[out:json][timeout:90];
area(3600072596)->.lt;
(
  node["amenity"="fuel"](area.lt);
  way["amenity"="fuel"](area.lt);
);
out center tags;
`.trim();

const REQUEST_TIMEOUT_MS = 30_000;
const RETRIES_PER_ENDPOINT = 2;
const RETRY_DELAY_MS = 2_000;

function retryDelayMs(err: unknown, attempt: number): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (/HTTP 429/.test(msg)) return RETRY_DELAY_MS * 3 * attempt;
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return RETRY_DELAY_MS * attempt;
  }
  // 5xx / empty / remark: skip extra waits and try the next endpoint.
  return null;
}

interface OverpassEl {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassJson {
  remark?: string;
  elements?: OverpassEl[];
}

export function parseOverpassResponse(json: unknown): Station[] {
  if (!json || typeof json !== "object") throw new Error("Invalid Overpass JSON");
  const body = json as OverpassJson;
  if (typeof body.remark === "string" && body.remark.trim()) {
    throw new Error(`Overpass remark: ${body.remark}`);
  }
  if (!Array.isArray(body.elements) || body.elements.length === 0) {
    throw new Error("Overpass returned no elements");
  }
  const stations = body.elements
    .map(toStation)
    .filter((s): s is Station => s !== null)
    .filter((s) => inLithuania(s));
  if (stations.length === 0) throw new Error("Overpass returned no stations in Lithuania");
  return stations;
}

export function assertHealthyOsmCount(stations: Station[]): void {
  if (stations.length < MIN_OSM_STATIONS) {
    throw new Error(`Overpass returned too few stations (${stations.length})`);
  }
}

/** Prefer a fresh Overpass result when it looks complete; otherwise keep the last good OSM list. */
export function chooseOsmStations(
  existing: Station[],
  fetched: Station[] | undefined,
  err?: unknown,
): Station[] {
  if (fetched && fetched.length >= MIN_OSM_STATIONS) return fetched;
  if (existing.length > 0) return existing;
  if (err instanceof Error) throw err;
  throw new Error(err ? String(err) : "No OSM stations available");
}

export async function fetchOsmStations(): Promise<Station[]> {
  let lastErr: unknown;
  for (const url of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= RETRIES_PER_ENDPOINT; attempt++) {
      try {
        const stations = await queryOverpass(url, AREA_QUERY);
        assertHealthyOsmCount(stations);
        return stations;
      } catch (e) {
        lastErr = e;
        console.warn(`Overpass ${url} attempt ${attempt} failed:`, e);
        const delay = retryDelayMs(e, attempt);
        if (delay == null || attempt >= RETRIES_PER_ENDPOINT) break;
        await sleep(delay);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function queryOverpass(url: string, query: string): Promise<Station[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "KurDegalai/0.1 (https://github.com/Almantask/Degalai-web)",
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return parseOverpassResponse(await res.json());
}

function toStation(el: OverpassEl): Station | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const tags = el.tags ?? {};
  const brand = normalizeBrand(tags.brand, tags.operator, tags.name);
  const name = tags.name || tags.brand || tags.operator || displayFallback(brand);
  const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"];
  const street = tags["addr:street"];
  const housenumber = tags["addr:housenumber"];
  const address = [street && housenumber ? `${street} ${housenumber}` : street, city]
    .filter(Boolean)
    .join(", ");
  return {
    id: `osm:${el.type}:${el.id}`,
    name,
    brand,
    lat,
    lon,
    address: address || undefined,
    city: city || undefined,
    fuels: osmFuels(tags),
    sourceIds: { osm: `${el.type}/${el.id}` },
  };
}

function displayFallback(brand: string): string {
  return brand === "independent" ? "Degalinė" : brand;
}
