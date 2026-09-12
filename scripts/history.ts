import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyPrices, HistoryPoint, Station } from "../src/types.ts";
import { FUEL_TYPES } from "../src/types.ts";

export function recomputeHistory(pricesDir: string, stations: Station[]): HistoryPoint[] {
  const files = readdirSync(pricesDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const byId = new Map(stations.map((s) => [s.id, s]));
  return files.map((f) => {
    const daily = JSON.parse(readFileSync(join(pricesDir, f), "utf8")) as DailyPrices;
    return historyPointFromDaily(daily, byId);
  });
}

export function historyPointFromDaily(
  daily: DailyPrices,
  stations: Map<string, Station>,
): HistoryPoint {
  const byFuel: HistoryPoint["byFuel"] = {};
  for (const fuel of FUEL_TYPES) {
    const rows: Array<{ price: number; stationId: string; brand: string }> = [];
    for (const [sid, fuels] of Object.entries(daily.prices)) {
      const e = fuels[fuel];
      if (!e || e.stale) continue;
      const brand = stations.get(sid)?.brand ?? "independent";
      rows.push({ price: e.price, stationId: sid, brand });
    }
    if (rows.length === 0) continue;
    rows.sort((a, b) => a.price - b.price);
    const min = rows[0];
    const byBrand: Record<string, { min: number; median: number }> = {};
    const grouped = new Map<string, number[]>();
    for (const r of rows) {
      const g = grouped.get(r.brand) ?? [];
      g.push(r.price);
      grouped.set(r.brand, g);
    }
    for (const [brand, prices] of grouped) {
      const sorted = prices.slice().sort((a, b) => a - b);
      byBrand[brand] = { min: sorted[0], median: median(sorted) };
    }
    byFuel[fuel] = {
      min: min.price,
      median: median(rows.map((r) => r.price)),
      max: rows[rows.length - 1].price,
      minStationId: min.stationId,
      byBrand,
    };
  }
  return { date: daily.date, byFuel };
}

export function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
