import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type {
  BrandStat,
  DailyPrices,
  FuelType,
  HistoryFile,
  HistoryHourSeries,
  HistorySample,
  HistoryStat,
  Station,
} from "../src/types.ts";
import { FUEL_TYPES, HISTORY_KEEP_DAYS, HISTORY_STATS } from "../src/types.ts";
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

export function brandStats(
  daily: DailyPrices,
  stations: Map<string, Station>,
): Partial<Record<FuelType, Record<string, BrandStat>>> {
  const out: Partial<Record<FuelType, Record<string, BrandStat>>> = {};
  for (const fuel of FUEL_TYPES) {
    const bags = new Map<string, number[]>();
    for (const [sid, fuels] of Object.entries(daily.prices)) {
      const e = fuels[fuel];
      if (!e || e.stale) continue;
      const brand = stations.get(sid)?.brand ?? "independent";
      const list = bags.get(brand) ?? [];
      list.push(e.price);
      bags.set(brand, list);
    }
    if (bags.size === 0) continue;
    const brands: Record<string, BrandStat> = {};
    for (const [brand, prices] of bags) brands[brand] = statFromPrices(prices);
    out[fuel] = brands;
  }
  return out;
}

/** @deprecated use brandStats */
export const brandAverages = brandStats;

function statFromPrices(prices: number[]): BrandStat {
  const sorted = [...prices].sort((a, b) => a - b);
  const sum = sorted.reduce((s, p) => s + p, 0);
  return {
    min: round3(sorted[0]),
    max: round3(sorted[sorted.length - 1]),
    avg: round3(sum / sorted.length),
    median: round3(median(sorted)),
  };
}

export function toBrandStat(value: unknown): BrandStat | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = round3(value);
    return { min: n, max: n, avg: n, median: n };
  }
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const min = Number(v.min);
  const max = Number(v.max);
  const avg = Number(v.avg);
  const medianValue = Number(v.median);
  if (![min, max, avg, medianValue].every(Number.isFinite)) return undefined;
  return { min, max, avg, median: medianValue };
}

export function normalizeSample(sample: HistorySample): HistorySample {
  const byFuel: HistorySample["byFuel"] = {};
  for (const fuel of FUEL_TYPES) {
    const row = sample.byFuel[fuel] as Record<string, unknown> | undefined;
    if (!row) continue;
    const next: Record<string, BrandStat> = {};
    for (const [brand, value] of Object.entries(row)) {
      const stat = toBrandStat(value);
      if (stat) next[brand] = stat;
    }
    if (Object.keys(next).length) byFuel[fuel] = next;
  }
  return { at: sample.at, hour: sample.hour, byFuel };
}

export function sampleFromDaily(
  daily: DailyPrices,
  stations: Map<string, Station>,
  at?: Date,
): HistorySample {
  const hour = at ? hourInVilnius(at.toISOString()) : sampleHour(daily);
  return {
    at: `${daily.date}T${String(hour).padStart(2, "0")}:00:00.000Z`,
    hour,
    byFuel: brandStats(daily, stations),
  };
}

export function sampleKey(sample: HistorySample): string {
  return `${sample.at.slice(0, 10)}-${String(sample.hour).padStart(2, "0")}`;
}

export function brandStatEqual(a: BrandStat | undefined, b: BrandStat | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.min === b.min && a.max === b.max && a.avg === b.avg && a.median === b.median;
}

export function fuelPricesEqual(
  a: Record<string, BrandStat> | undefined,
  b: Record<string, BrandStat> | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.hasOwn(b, k) && brandStatEqual(a[k], b[k]));
}

export function samplePricesEqual(a: HistorySample, b: HistorySample): boolean {
  const fuels = new Set([...Object.keys(a.byFuel), ...Object.keys(b.byFuel)]);
  for (const fuel of fuels) {
    if (!fuelPricesEqual(a.byFuel[fuel as FuelType], b.byFuel[fuel as FuelType])) return false;
  }
  return true;
}

/** Keep the first sample of an unchanged run so the chart only moves when prices move. */
export function dropUnchangedSamples(samples: HistorySample[]): HistorySample[] {
  const out: HistorySample[] = [];
  for (const s of samples) {
    const prev = out.at(-1);
    if (prev && samplePricesEqual(prev, s)) continue;
    out.push(s);
  }
  return out;
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
    const sample = normalizeSample(s);
    if (dayDiff(sample.at.slice(0, 10), today) <= keepDays) byKey.set(sampleKey(sample), sample);
  }
  const merged = [...byKey.values()].sort((a, b) => a.at.localeCompare(b.at) || a.hour - b.hour);
  return dropUnchangedSamples(merged);
}

function appendChangedPoint(
  points: Array<{ date: string; hour: number; prices: Record<string, BrandStat> }>,
  brands: Set<string>,
  sample: HistorySample,
  fuel: FuelType,
): void {
  const row = sample.byFuel[fuel];
  if (!row) return;
  const prev = points.at(-1);
  if (prev && fuelPricesEqual(prev.prices, row)) return;
  for (const b of Object.keys(row)) brands.add(b);
  points.push({ date: sample.at.slice(0, 10), hour: sample.hour, prices: row });
}

function seriesForBrands(
  brands: string[],
  points: Array<{ prices: Record<string, BrandStat> }>,
  stat: HistoryStat,
): Record<string, Array<number | null>> {
  const series: Record<string, Array<number | null>> = {};
  for (const b of brands) {
    series[b] = points.map((p) => (p.prices[b] != null ? p.prices[b][stat] : null));
  }
  return series;
}

/** One chart point per price change so the timeline can show date and time. */
export function rollupHourAverages(
  samples: HistorySample[],
): Partial<Record<FuelType, HistoryHourSeries>> {
  const out: Partial<Record<FuelType, HistoryHourSeries>> = {};
  for (const fuel of FUEL_TYPES) {
    const brands = new Set<string>();
    const points: Array<{ date: string; hour: number; prices: Record<string, BrandStat> }> = [];
    for (const s of samples) appendChangedPoint(points, brands, normalizeSample(s), fuel);
    if (brands.size === 0 || points.length === 0) continue;
    const ids = [...brands].sort((x, y) => x.localeCompare(y));
    const stats = Object.fromEntries(
      HISTORY_STATS.map((stat) => [stat, seriesForBrands(ids, points, stat)]),
    ) as NonNullable<HistoryHourSeries["stats"]>;
    out[fuel] = {
      dates: points.map((p) => p.date),
      hours: points.map((p) => p.hour),
      brands: stats.avg ?? {},
      stats,
    };
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
  const next = buildHistoryFile(samples, now.toISOString());
  if (previous && historyPayload(previous) === historyPayload(next)) {
    next.generatedAt = previous.generatedAt;
  }
  return next;
}

function historyPayload(file: HistoryFile): string {
  return JSON.stringify({
    keepDays: file.keepDays,
    samples: file.samples,
    byFuel: file.byFuel,
  });
}
