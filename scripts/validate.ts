import type { DailyPrices, FuelType, Observation, PriceEntry } from "../src/types.ts";
import { FUEL_TYPES } from "../src/types.ts";
import { dateInVilnius } from "./history.ts";
import { DEFAULT_MAX_AGE_HOURS, SOURCE_META } from "./source-health.ts";

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

/** How one station's fuel price is chosen when several sources have it. */
export interface SelectionPolicy {
  /** Ranked source names, most reliable first. Unknown sources rank last. */
  order: string[];
  maxAgeHours: Record<string, number>;
  now: Date;
}

export const REPORT_SOURCE = "report";

export function defaultSelectionPolicy(now = new Date()): SelectionPolicy {
  return {
    order: [...SOURCE_META].sort((a, b) => b.seedScore - a.seedScore).map((m) => m.name),
    maxAgeHours: Object.fromEntries(SOURCE_META.map((m) => [m.name, m.maxAgeHours])),
    now,
  };
}

export function observationsToDaily(
  date: string,
  observations: Observation[],
  previous: DailyPrices | null,
  policy: SelectionPolicy = defaultSelectionPolicy(),
): { daily: DailyPrices; log: ValidationLog } {
  const log: ValidationLog = { dropped: [], suspicious: [] };
  const prices: DailyPrices["prices"] = {};

  // Fuel codes contain no ":", so the key cannot collide across stations.
  const groups = new Map<string, Observation[]>();
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
    const key = `${o.fuel}:${o.sourceStationId}`;
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }

  for (const candidates of groups.values()) {
    const o = pickPrice(candidates, policy);
    const entry: PriceEntry = {
      price: o.price,
      source: sourceOfObservation(o),
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
    (prices[o.sourceStationId] ??= {})[o.fuel] = entry;
  }

  return {
    daily: { date, generatedAt: new Date().toISOString(), prices },
    log,
  };
}

/**
 * Picks one price for a station and fuel:
 * 1. among ranked sources whose price is still fresh, the most reliable source wins;
 * 2. if none is fresh, the newest Vilnius day wins, then the more reliable source;
 * 3. a user report replaces that winner unless the winner was observed later.
 * Candidates are compared as a group, so input order only settles exact ties (same source and
 * time, e.g. two LEA rows matched to one OSM station), where the later row wins as before.
 */
export function pickPrice(candidates: Observation[], policy: SelectionPolicy): Observation {
  if (candidates.length === 0) throw new Error("pickPrice needs at least one candidate");
  type Candidate = { o: Observation; index: number; source: string; ms: number };
  const rankOf = (c: Candidate): number => {
    const i = policy.order.indexOf(c.source);
    return i === -1 ? policy.order.length : i;
  };
  const newestFirst = (a: Candidate, b: Candidate): number => b.ms - a.ms || b.index - a.index;

  const all: Candidate[] = candidates.map((o, index) => ({
    o,
    index,
    source: sourceOfObservation(o),
    ms: Date.parse(o.observedAt),
  }));
  const ranked = all.filter((c) => c.source !== REPORT_SOURCE);
  const fresh = ranked.filter((c) => isFresh(c.o, policy));
  let winner: Candidate | undefined;
  if (fresh.length) {
    winner = [...fresh].sort((a, b) => rankOf(a) - rankOf(b) || newestFirst(a, b))[0];
  } else if (ranked.length) {
    winner = [...ranked].sort(
      (a, b) =>
        dateInVilnius(b.o.observedAt).localeCompare(dateInVilnius(a.o.observedAt)) ||
        rankOf(a) - rankOf(b) ||
        newestFirst(a, b),
    )[0];
  }

  // Reports are filtered for expiry before they reach the pipeline.
  const report = all.filter((c) => c.source === REPORT_SOURCE).sort(newestFirst)[0];
  if (report && (!winner || report.ms >= winner.ms)) return report.o;
  return winner!.o;
}

function isFresh(o: Observation, policy: SelectionPolicy): boolean {
  const hours = policy.maxAgeHours[sourceOfObservation(o)] ?? DEFAULT_MAX_AGE_HOURS;
  return policy.now.getTime() - Date.parse(o.observedAt) <= hours * 3_600_000;
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

function sourceOfObservation(o: Observation): string {
  return o.source ?? sourceOf(o.sourceStationId);
}

function sourceOf(stationId: string): string {
  if (stationId.startsWith("osm:")) return "lea";
  if (stationId.startsWith("lea:")) return "lea";
  return "unknown";
}

function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}
