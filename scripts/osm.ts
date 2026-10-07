import { inLithuania } from "../src/geo.ts";
import { displayBrandName, normalizeBrand, osmFuels } from "../src/brands.ts";
import type { Station } from "../src/types.ts";
import { sleep } from "./geocode.ts";

export const MIN_OSM_STATIONS = 500;
/** Fewer public chargers than this means Overpass returned a partial answer. */
export const MIN_OSM_CHARGERS = 100;

/** Tried in order. Two mirrors that never answered were dropped; see decision-log.md. */
const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter"];

const AREA_QUERY = `
[out:json][timeout:90];
area(3600072596)->.lt;
(
  node["amenity"="fuel"](area.lt);
  way["amenity"="fuel"](area.lt);
);
out center tags;
`.trim();

const CHARGER_QUERY = `
[out:json][timeout:90];
area(3600072596)->.lt;
(
  node["amenity"="charging_station"](area.lt);
  way["amenity"="charging_station"](area.lt);
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

function overpassElements(json: unknown): OverpassEl[] {
  if (!json || typeof json !== "object") throw new Error("Invalid Overpass JSON");
  const body = json as OverpassJson;
  if (typeof body.remark === "string" && body.remark.trim()) {
    throw new Error(`Overpass remark: ${body.remark}`);
  }
  if (!Array.isArray(body.elements) || body.elements.length === 0) {
    throw new Error("Overpass returned no elements");
  }
  return body.elements;
}

export function parseOverpassResponse(json: unknown): Station[] {
  const stations = overpassElements(json)
    .map(toStation)
    .filter((s): s is Station => s !== null)
    .filter((s) => inLithuania(s));
  if (stations.length === 0) throw new Error("Overpass returned no stations in Lithuania");
  return stations;
}

/** Public car chargers; private, customer-only and bicycle-only points are skipped. */
export function parseOverpassChargers(json: unknown): Station[] {
  const chargers = overpassElements(json)
    .map(toCharger)
    .filter((s): s is Station => s !== null)
    .filter((s) => inLithuania(s));
  if (chargers.length === 0) throw new Error("Overpass returned no chargers in Lithuania");
  return chargers;
}

export function assertHealthyOsmCount(stations: Station[], min = MIN_OSM_STATIONS): void {
  if (stations.length < min) {
    throw new Error(`Overpass returned too few stations (${stations.length})`);
  }
}

/** Prefer a fresh Overpass result when it looks complete; otherwise keep the last good OSM list. */
export function chooseOsmStations(
  existing: Station[],
  fetched: Station[] | undefined,
  err?: unknown,
  min = MIN_OSM_STATIONS,
): Station[] {
  if (fetched && fetched.length >= min) return fetched;
  if (existing.length > 0) return existing;
  if (err instanceof Error) throw err;
  throw new Error(err ? String(err) : "No OSM stations available");
}

export function fetchOsmStations(): Promise<Station[]> {
  return fetchOverpass(AREA_QUERY, parseOverpassResponse, MIN_OSM_STATIONS);
}

export function fetchOsmChargers(): Promise<Station[]> {
  return fetchOverpass(CHARGER_QUERY, parseOverpassChargers, MIN_OSM_CHARGERS);
}

async function fetchOverpass(
  query: string,
  parse: (json: unknown) => Station[],
  min: number,
): Promise<Station[]> {
  let lastErr: unknown;
  for (const url of OVERPASS_ENDPOINTS) {
    for (let attempt = 1; attempt <= RETRIES_PER_ENDPOINT; attempt++) {
      try {
        const stations = await queryOverpass(url, query, parse);
        assertHealthyOsmCount(stations, min);
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

async function queryOverpass(
  url: string,
  query: string,
  parse: (json: unknown) => Station[],
): Promise<Station[]> {
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
  return parse(await res.json());
}

function osmAddress(tags: Record<string, string>): { address?: string; city?: string } {
  const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"];
  const street = tags["addr:street"];
  const housenumber = tags["addr:housenumber"];
  const address = [street && housenumber ? `${street} ${housenumber}` : street, city]
    .filter(Boolean)
    .join(", ");
  return { address: address || undefined, city: city || undefined };
}

function toStation(el: OverpassEl): Station | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const tags = el.tags ?? {};
  const brand = normalizeBrand(tags.brand, tags.operator, tags.name);
  const name = tags.name || tags.brand || tags.operator || displayFallback(brand);
  const { address, city } = osmAddress(tags);
  return {
    id: `osm:${el.type}:${el.id}`,
    name,
    brand,
    lat,
    lon,
    address,
    city,
    fuels: osmFuels(tags),
    sourceIds: { osm: `${el.type}/${el.id}` },
  };
}

const CLOSED_ACCESS = new Set(["private", "no", "customers", "permit", "employees"]);
const SOCKET_KEY = /^socket:([a-z0-9_]+)$/;

function toCharger(el: OverpassEl): Station | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const tags = el.tags ?? {};
  if (CLOSED_ACCESS.has(tags.access ?? "")) return null;
  if (tags.motorcar === "no") return null;
  if (tags.disused === "yes" || tags["operational_status"] === "closed") return null;
  const network = tags.network || tags.operator || tags.brand || undefined;
  const brand = normalizeBrand(tags.network, tags.operator, tags.brand, tags.name);
  const name = tags.name || network || brandName(brand, "Įkrovimo stotelė");
  const { address, city } = osmAddress(tags);
  const chargeTag = parseChargeTag(tags.charge);
  const maxKw = chargerMaxKw(tags);
  const kwBySocket = chargerKwBySocket(tags);
  return {
    id: `ev:${el.type}:${el.id}`,
    name,
    brand,
    lat,
    lon,
    address,
    city,
    fuels: ["EV"],
    sourceIds: { osm: `${el.type}/${el.id}` },
    ev: {
      sockets: chargerSockets(tags),
      ...(maxKw != null ? { maxKw } : {}),
      ...(Object.keys(kwBySocket).length ? { kwBySocket } : {}),
      ...(network ? { network } : {}),
      ...(chargeTag != null ? { chargeTag } : {}),
    },
  };
}

/** Socket kinds with a non-zero count, e.g. `type2`, `type2_combo`, `chademo`. */
export function chargerSockets(tags: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(tags)) {
    const m = k.match(SOCKET_KEY);
    if (!m) continue;
    const value = v.trim().toLowerCase();
    if (value === "no" || value === "0") continue;
    out.push(m[1]);
  }
  return out.sort();
}

/** Highest output in kW from `socket:*:output` or `charging_station:output` (`22 kW`, `50000 W`). */
export function chargerMaxKw(tags: Record<string, string>): number | undefined {
  let max: number | undefined;
  for (const [k, v] of Object.entries(tags)) {
    if (!/^socket:[a-z0-9_]+:output$/.test(k) && k !== "charging_station:output") continue;
    for (const part of v.split(";")) {
      const kw = parsePowerKw(part);
      if (kw != null && (max == null || kw > max)) max = kw;
    }
  }
  return max;
}

/** Highest output of each socket kind from `socket:<kind>:output` (`22 kW`, `50000 W`). */
export function chargerKwBySocket(tags: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(tags)) {
    const socket = k.match(/^socket:([a-z0-9_]+):output$/)?.[1];
    if (!socket) continue;
    for (const part of v.split(";")) {
      const kw = parsePowerKw(part);
      if (kw != null && (out[socket] == null || kw > out[socket])) out[socket] = kw;
    }
  }
  return out;
}

function parsePowerKw(value: string): number | undefined {
  const m = value
    .trim()
    .replace(",", ".")
    .match(/^(\d+(?:\.\d+)?)\s*(kw|w|mw)?$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = (m[2] ?? "kw").toLowerCase();
  const kw = unit === "w" ? n / 1000 : unit === "mw" ? n * 1000 : n;
  return Math.round(kw * 10) / 10;
}

/** €/kWh from an OSM `charge` tag such as `0.39 EUR/kWh` or `EUR 0,35/kWh; 0.05 EUR/min`. */
export function parseChargeTag(value: string | undefined): number | undefined {
  if (!value) return undefined;
  for (const part of value.split(";")) {
    const s = part.trim().replace(",", ".");
    const m =
      s.match(/(\d+(?:\.\d+)?)\s*(?:eur|€)\s*\/\s*kwh/i) ??
      s.match(/(?:eur|€)\s*(\d+(?:\.\d+)?)\s*\/\s*kwh/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000) / 1000;
  }
  return undefined;
}

function brandName(brand: string, fallback: string): string {
  return brand === "independent" ? fallback : displayBrandName(brand);
}

function displayFallback(brand: string): string {
  return brand === "independent" ? "Degalinė" : brand;
}
