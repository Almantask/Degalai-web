import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type {
  DailyPrices,
  FuelType,
  HistoryFile,
  HistoryHourSeries,
  HistorySample,
  Station,
} from "../src/types.ts";
import { FUEL_TYPES, HISTORY_KEEP_DAYS } from "../src/types.ts";
import { round3 } from "../src/calc.ts";

export function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function dayDiff(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function datesWithinDays(
  dates: string[],
  today: string,
  days = HISTORY_KEEP_DAYS,
): string[] {
  return dates.filter((d) => dayDiff(d, today) <= days).sort();
}

export function listPriceDates(pricesDir: string): string[] {
  if (!existsSync(pricesDir)) return [];
  return readdirSync(pricesDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
}

export function prunePriceFiles(
  pricesDir: string,
  today: string,
  days = HISTORY_KEEP_DAYS,
): string[] {
  const removed: string[] = [];
  for (const date of listPriceDates(pricesDir)) {
    if (dayDiff(date, today) <= days) continue;
    unlinkSync(join(pricesDir, `${date}.json`));
    removed.push(date);
  }
  return removed;
}

export function hourInVilnius(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vilnius",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

export function dateInVilnius(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vilnius",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function sampleHour(daily: DailyPrices): number {
  if (daily.generatedAt && dateInVilnius(daily.generatedAt) === daily.date) {
    return hourInVilnius(daily.generatedAt);
  }
  for (const fuels of Object.values(daily.prices)) {
    for (const entry of Object.values(fuels)) {
      if (entry?.observedAt) return hourInVilnius(entry.observedAt);
    }
  }
  return daily.generatedAt ? hourInVilnius(daily.generatedAt) : 12;
}

export function brandAverages(
  daily: DailyPrices,
  stations: Map<string, Station>,
): Partial<Record<FuelType, Record<string, number>>> {
  const out: Partial<Record<FuelType, Record<string, number>>> = {};
  for (const fuel of FUEL_TYPES) {
    const sums = new Map<string, { sum: number; n: number }>();
    for (const [sid, fuels] of Object.entries(daily.prices)) {
      const e = fuels[fuel];
      if (!e || e.stale) continue;
      const brand = stations.get(sid)?.brand ?? "independent";
      const cur = sums.get(brand) ?? { sum: 0, n: 0 };
      cur.sum += e.price;
      cur.n += 1;
      sums.set(brand, cur);
    }
    if (sums.size === 0) continue;
    const brands: Record<string, number> = {};
    for (const [brand, { sum, n }] of sums) brands[brand] = round3(sum / n);
    out[fuel] = brands;
  }
  return out;
}

export function sampleFromDaily(daily: DailyPrices, stations: Map<string, Station>): HistorySample {
  const hour = sampleHour(daily);
  return {
    at: `${daily.date}T${String(hour).padStart(2, "0")}:00:00.000Z`,
    hour,
    byFuel: brandAverages(daily, stations),
  };
}

export function sampleKey(sample: HistorySample): string {
  return `${sample.at.slice(0, 10)}-${String(sample.hour).padStart(2, "0")}`;
}

export function mergeSamples(
  existing: HistorySample[],
  next: HistorySample[],
  now = new Date(),
  keepDays = HISTORY_KEEP_DAYS,
): HistorySample[] {
  const today = dateInVilnius(now.toISOString());
  const byKey = new Map<string, HistorySample>();
  for (const s of [...existing, ...next]) {
    if (dayDiff(s.at.slice(0, 10), today) <= keepDays) byKey.set(sampleKey(s), s);
  }
  return [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at) || a.hour - b.hour);
}

export function rollupHourAverages(
  samples: HistorySample[],
): Partial<Record<FuelType, HistoryHourSeries>> {
  const hours = [...Array(24).keys()];
  const out: Partial<Record<FuelType, HistoryHourSeries>> = {};
  for (const fuel of FUEL_TYPES) {
    const brands = new Set<string>();
    for (const s of samples) {
      const row = s.byFuel[fuel];
      if (row) for (const b of Object.keys(row)) brands.add(b);
    }
    if (brands.size === 0) continue;
    const sums = new Map<string, number[]>();
    const counts = new Map<string, number[]>();
    for (const b of brands) {
      sums.set(
        b,
        hours.map(() => 0),
      );
      counts.set(
        b,
        hours.map(() => 0),
      );
    }
    for (const s of samples) {
      const row = s.byFuel[fuel];
      if (!row) continue;
      for (const [b, price] of Object.entries(row)) {
        sums.get(b)![s.hour] += price;
        counts.get(b)![s.hour] += 1;
      }
    }
    const series: Record<string, Array<number | null>> = {};
    for (const b of [...brands].sort()) {
      series[b] = hours.map((h) => {
        const n = counts.get(b)![h];
        return n ? round3(sums.get(b)![h] / n) : null;
      });
    }
    out[fuel] = { hours, brands: series };
  }
  return out;
}

export function isHistoryFile(value: unknown): value is HistoryFile {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "byFuel" in value &&
    Array.isArray((value as HistoryFile).samples),
  );
}

/** Chart payload without per-hour samples — map search never downloads this extra. */
export function compactHistoryForClient(file: HistoryFile): Omit<HistoryFile, "samples"> {
  return {
    generatedAt: file.generatedAt,
    keepDays: file.keepDays,
    byFuel: file.byFuel,
  };
}

export function buildHistoryFile(
  samples: HistorySample[],
  generatedAt = new Date().toISOString(),
): HistoryFile {
  return {
    generatedAt,
    keepDays: HISTORY_KEEP_DAYS,
    samples,
    byFuel: rollupHourAverages(samples),
  };
}

export function recomputeHistory(
  pricesDir: string,
  stations: Station[],
  previous: HistoryFile | null = null,
  now = new Date(),
): HistoryFile {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const fromFiles: HistorySample[] = [];
  for (const date of listPriceDates(pricesDir)) {
    const daily = JSON.parse(readFileSync(join(pricesDir, `${date}.json`), "utf8")) as DailyPrices;
    fromFiles.push(sampleFromDaily(daily, byId));
  }
  const samples = mergeSamples(previous?.samples ?? [], fromFiles, now);
  return buildHistoryFile(samples, now.toISOString());
}
