import { existsSync, readFileSync } from "node:fs";
import { round3 } from "../../src/calc.ts";
import type { HistoryHourSeries } from "../../src/types.ts";
import { HISTORY_KEEP_DAYS, SPOT_SERIES } from "../../src/types.ts";
import { dateInVilnius, hourInVilnius } from "../history.ts";
import { FETCH_UA } from "./types.ts";

/** Elering's public Nord Pool day-ahead feed for the Baltic and Finnish areas. No key needed. */
export const ELERING_URL = "https://dashboard.elering.ee/api/nps/price";
export const SPOT_AREA = "lt";
const REQUEST_TIMEOUT_MS = 30_000;
/** Spot prices outside this €/kWh band are feed errors, not prices. */
const SPOT_RANGE = { min: -1, max: 5 };

/** Hourly Nord Pool LT day-ahead price. */
export interface SpotPoint {
  /** Start of the hour, ISO UTC. */
  at: string;
  /** €/kWh, excluding VAT, grid fees and supplier margin. Can be negative. */
  price: number;
}

export interface SpotCache {
  fetchedAt: string;
  points: SpotPoint[];
}

/** `{ data: { lt: [{ timestamp: unixSeconds, price: €/MWh }] } }`, 15- or 60-minute slots. */
export function parseEleringPrices(json: unknown, area = SPOT_AREA): SpotPoint[] {
  if (!json || typeof json !== "object") throw new Error("Invalid Elering JSON");
  const rows = (json as { data?: Record<string, unknown> }).data?.[area];
  if (!Array.isArray(rows)) throw new Error(`Elering returned no ${area} prices`);
  const byHour = new Map<number, number[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const ts = Number((row as { timestamp?: unknown }).timestamp);
    const mwh = Number((row as { price?: unknown }).price);
    if (!Number.isFinite(ts) || !Number.isFinite(mwh)) continue;
    const hour = Math.floor(ts / 3600) * 3600;
    const list = byHour.get(hour) ?? [];
    list.push(mwh);
    byHour.set(hour, list);
  }
  const points: SpotPoint[] = [];
  for (const [hour, prices] of [...byHour].sort((a, b) => a[0] - b[0])) {
    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    const price = round3(avg / 1000);
    if (price < SPOT_RANGE.min || price > SPOT_RANGE.max) continue;
    points.push({ at: new Date(hour * 1000).toISOString(), price });
  }
  if (points.length === 0) throw new Error(`Elering returned no usable ${area} prices`);
  return points;
}

/** Last `days` days plus whatever of tomorrow is already published (~14:00 Vilnius). */
export async function fetchSpot(
  now = new Date(),
  days = HISTORY_KEEP_DAYS,
  fetchImpl: typeof fetch = fetch,
): Promise<SpotPoint[]> {
  const start = new Date(now.getTime() - (days + 1) * 86_400_000);
  const end = new Date(now.getTime() + 2 * 86_400_000);
  const url = `${ELERING_URL}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": FETCH_UA, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Elering HTTP ${res.status}`);
  return parseEleringPrices(await res.json());
}

export function loadSpotCache(path: string): SpotCache | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SpotCache;
    if (typeof raw?.fetchedAt !== "string" || !Array.isArray(raw.points)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Union by hour (fresh wins), keeping the last `keepDays` Vilnius days and anything later. */
export function mergeSpot(
  cached: SpotPoint[],
  fresh: SpotPoint[],
  now = new Date(),
  keepDays = HISTORY_KEEP_DAYS,
): SpotPoint[] {
  const byAt = new Map<string, SpotPoint>();
  for (const p of [...cached, ...fresh]) byAt.set(p.at, p);
  const cutoff = now.getTime() - keepDays * 86_400_000;
  return [...byAt.values()]
    .filter((p) => Date.parse(p.at) >= cutoff)
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Chart series on the same dated, Vilnius-hour timeline as the pump fuels. */
export function spotSeries(points: SpotPoint[]): HistoryHourSeries | undefined {
  if (points.length === 0) return undefined;
  return {
    dates: points.map((p) => dateInVilnius(p.at)),
    hours: points.map((p) => hourInVilnius(p.at)),
    brands: { [SPOT_SERIES]: points.map((p) => p.price) },
  };
}
