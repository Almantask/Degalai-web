import type { DailyPrices, FuelType, Observation, PriceEntry } from "../src/types.ts";
import { FUEL_TYPES } from "../src/types.ts";

export const PRICE_RANGE: Record<FuelType, { min: number; max: number }> = {
  "95": { min: 0.9, max: 2.5 },
  "98": { min: 0.9, max: 2.8 },
  D: { min: 0.9, max: 2.6 },
  LPG: { min: 0.4, max: 1.6 },
};

export interface ValidationLog {
  dropped: Array<{ stationId: string; fuel: FuelType; price: number; reason: string }>;
  suspicious: Array<{ stationId: string; fuel: FuelType; prev: number; next: number }>;
}

export function observationsToDaily(
  date: string,
  observations: Observation[],
  previous: DailyPrices | null,
): { daily: DailyPrices; log: ValidationLog } {
  const log: ValidationLog = { dropped: [], suspicious: [] };
  const prices: DailyPrices["prices"] = {};

  for (const o of observations) {
    const range = PRICE_RANGE[o.fuel];
    if (o.price < range.min || o.price > range.max) {
      log.dropped.push({
        stationId: o.sourceStationId,
        fuel: o.fuel,
        price: o.price,
        reason: "out_of_range",
      });
      continue;
    }
    const entry: PriceEntry = {
      price: o.price,
      source: o.source ?? sourceOf(o.sourceStationId),
      observedAt: o.observedAt,
    };
    const prev = previous?.prices[o.sourceStationId]?.[o.fuel];
    if (prev && prev.price > 0) {
      const jump = Math.abs(o.price - prev.price) / prev.price;
      if (jump > 0.15) {
        entry.suspicious = true;
        log.suspicious.push({
          stationId: o.sourceStationId,
          fuel: o.fuel,
          prev: prev.price,
          next: o.price,
        });
      }
    }
    const slot = (prices[o.sourceStationId] ??= {});
    const existing = slot[o.fuel];
    if (!existing || takesPrecedence(o, existing)) slot[o.fuel] = entry;
  }

  return {
    daily: { date, generatedAt: new Date().toISOString(), prices },
    log,
  };
}

/** Newest observation time in a daily file; used so the UI can show the source snapshot. */
export function latestObservedAt(daily: DailyPrices): string | undefined {
  let best: string | undefined;
  for (const fuels of Object.values(daily.prices)) {
    for (const entry of Object.values(fuels)) {
      if (entry?.observedAt && (!best || entry.observedAt > best)) best = entry.observedAt;
    }
  }
  return best;
}

/** @deprecated use latestObservedAt */
export const firstObservedAt = latestObservedAt;

/** Keep the previous snapshot timestamp when this check found the same prices. */
export function reuseGeneratedAtIfUnchanged(
  previous: DailyPrices | null,
  next: DailyPrices,
): DailyPrices {
  if (
    previous &&
    previous.date === next.date &&
    JSON.stringify(previous.prices) === JSON.stringify(next.prices)
  ) {
    return { ...next, generatedAt: previous.generatedAt };
  }
  return next;
}

export function applyStale(
  daily: DailyPrices,
  previous: DailyPrices | null,
  previousDate: string | null,
): DailyPrices {
  if (!previous) return daily;
  const ageDays = previousDate ? dayDiff(previousDate, daily.date) : 1;
  if (ageDays > 7) return daily;
  for (const [sid, fuels] of Object.entries(previous.prices)) {
    const slot = (daily.prices[sid] ??= {});
    for (const fuel of FUEL_TYPES) {
      const prev = fuels[fuel];
      if (!prev) continue;
      if (slot[fuel]) continue;
      if (ageDays > 2) {
        slot[fuel] = { ...prev, stale: true };
      } else {
        slot[fuel] = { ...prev, stale: true };
      }
    }
  }
  return daily;
}

function sourceOf(stationId: string): string {
  if (stationId.startsWith("osm:")) return "lea";
  if (stationId.startsWith("lea:")) return "lea";
  return "unknown";
}

const SOURCE_RANK: Record<string, number> = {
  lea: 0,
  "lea-live": 1,
  report: 2,
};

/** Live LEA and user reports overlay the lagged Excel dump even when their clocks are earlier. */
export function takesPrecedence(next: Observation, existing: PriceEntry): boolean {
  const nextSource = next.source ?? sourceOf(next.sourceStationId);
  if (existing.source === "lea" && nextSource !== "lea") return true;
  if (nextSource === "lea" && existing.source !== "lea") return false;
  if (next.observedAt !== existing.observedAt) return next.observedAt > existing.observedAt;
  return (SOURCE_RANK[nextSource] ?? 0) >= (SOURCE_RANK[existing.source] ?? 0);
}

function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
