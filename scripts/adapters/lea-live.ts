import { normalizeBrand } from "../../src/brands.ts";
import type { Observation } from "../../src/types.ts";
import { vilniusLocalToIso } from "../vilnius-time.ts";
import { leaSourceId } from "./lea.ts";
import { FETCH_UA, mapLeaFuel, parsePrice } from "./types.ts";

const SPA_PAGE = "https://degalukainos.ena.lt/";
const MAX_JS_FETCHES = 6;

export interface LeaLiveConfig {
  apiBase: string;
  token: string;
}

export interface LeaLiveRow {
  company_name?: string;
  gas_station_name?: string;
  municipality?: string;
  address?: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  fuel_type?: string;
  price?: string | number | null;
  submitted_at?: string | null;
}

export interface LeaLivePayload {
  data?: LeaLiveRow[];
  last_updated?: string;
}

export async function discoverLeaLiveConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<LeaLiveConfig> {
  const html = await (await fetchImpl(SPA_PAGE, { headers: { "User-Agent": FETCH_UA } })).text();
  const entry = [
    ...html.matchAll(/src="(\.?\/assets\/(?:FuelPriceSiteApp|index)-[^"]+\.js)"/g),
  ].map((m) => m[1]);
  if (!entry.length) throw new Error("LEA live map JS bundle not found");
  const seen = new Set<string>();
  const queue = entry.map((path) => new URL(path, SPA_PAGE).toString());
  while (queue.length && seen.size < MAX_JS_FETCHES) {
    const jsUrl = queue.shift()!;
    if (seen.has(jsUrl)) continue;
    seen.add(jsUrl);
    const js = await (await fetchImpl(jsUrl, { headers: { "User-Agent": FETCH_UA } })).text();
    const apiBase = js.match(/apiBase:\s*["'](https:\/\/[^"']+)["']/)?.[1];
    const token = js.match(/token:\s*["']([^"']+)["']/)?.[1];
    if (apiBase && token) return { apiBase: apiBase.replace(/\/$/, ""), token };
    for (const m of js.matchAll(/(?:\.\/)?(FuelPriceSiteApp-[^"'\s]+\.js)/g)) {
      queue.push(new URL(m[1], jsUrl).toString());
    }
  }
  throw new Error("LEA live API config not found in map bundle");
}

export function parseLeaLivePayload(payload: LeaLivePayload): Observation[] {
  const rows = payload.data ?? [];
  const fallbackAt = payload.last_updated ? vilniusLocalToIso(payload.last_updated) : null;
  const out: Observation[] = [];
  for (const row of rows) {
    const company = (row.company_name ?? "").trim();
    const addr = (row.address ?? "").trim();
    const muni = (row.municipality ?? "").trim();
    const fuel = mapLeaFuel(row.fuel_type ?? "");
    const price = parsePrice(row.price);
    if (!fuel || price == null || !company || !addr) continue;
    const observedAt =
      (row.submitted_at ? vilniusLocalToIso(row.submitted_at) : null) ?? fallbackAt;
    if (!observedAt) continue;
    const lat = parseCoord(row.latitude);
    const lon = parseCoord(row.longitude);
    out.push({
      sourceStationId: leaSourceId(company, muni, addr),
      brand: normalizeBrand(company, row.gas_station_name),
      name: row.gas_station_name || company,
      address: addr,
      city: muni,
      ...(lat != null ? { lat } : {}),
      ...(lon != null ? { lon } : {}),
      fuel,
      price,
      observedAt,
      source: "lea-live",
    });
  }
  return out;
}

function parseCoord(value: string | number | null | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export async function fetchLeaLive(fetchImpl: typeof fetch = fetch): Promise<Observation[]> {
  const { apiBase, token } = await discoverLeaLiveConfig(fetchImpl);
  const res = await fetchImpl(`${apiBase}/read/prices/latest`, {
    headers: {
      "User-Agent": FETCH_UA,
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error(`LEA live API HTTP ${res.status}`);
  return parseLeaLivePayload((await res.json()) as LeaLivePayload);
}
