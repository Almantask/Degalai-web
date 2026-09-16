import type { DailyPrices, FuelType, PriceEntry, Station } from "../src/types.ts";

/** Relative paths from `data/`, with or without a leading slash. */
export function includePublishedDataFile(rel: string, latestPrice: string): boolean {
  const normalized =
    `/${rel.replaceAll("\\", "/")}`.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  if (normalized === "/" || normalized === "/.") return true;
  if (normalized.includes("/cache") || normalized.includes("/downloads")) return false;
  if (normalized === "/prices" || normalized.startsWith("/prices/")) {
    if (!latestPrice) return normalized === "/prices";
    return normalized === "/prices" || normalized === `/prices/${latestPrice}.json`;
  }
  return true;
}

type PublishedPriceEntry = Pick<PriceEntry, "price" | "stale" | "suspicious">;

/** Drops pipeline-only matching ids; the app never reads them. */
export function slimStations(stations: Station[]): Omit<Station, "sourceIds">[] {
  return stations.map(({ sourceIds: _sourceIds, ...rest }) => rest);
}

/** Keeps only the fields the app reads from each price entry. */
export function slimPrices(daily: DailyPrices): Omit<DailyPrices, "prices"> & {
  prices: Record<string, Partial<Record<FuelType, PublishedPriceEntry>>>;
} {
  const prices: Record<string, Partial<Record<FuelType, PublishedPriceEntry>>> = {};
  for (const [id, byFuel] of Object.entries(daily.prices)) {
    const slot: Partial<Record<FuelType, PublishedPriceEntry>> = {};
    for (const [fuel, entry] of Object.entries(byFuel) as [FuelType, PriceEntry | undefined][]) {
      if (!entry) continue;
      const out: PublishedPriceEntry = { price: entry.price };
      if (entry.stale) out.stale = true;
      if (entry.suspicious) out.suspicious = true;
      slot[fuel] = out;
    }
    prices[id] = slot;
  }
  return { date: daily.date, generatedAt: daily.generatedAt, prices };
}
