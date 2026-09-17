import type { DailyPrices, Observation } from "../src/types.ts";
import { REPORT_SOURCE } from "./validate.ts";

export const EXCEL_SOURCE = "lea";

export function excelFloorDate(
  byDate: Map<string, Observation[]>,
  requested: string,
): string | null {
  if (byDate.has(requested)) return requested;
  const dates = [...byDate.keys()].sort();
  return dates.at(-1) ?? null;
}

/**
 * Pools every source's rows for one snapshot. Excel is the lagged daily floor
 * (`excelDate`); any other source or a fresh user report moves the snapshot to `requested`
 * (usually today) so hourly deploys can move before the next workbook. Which row wins per
 * station is decided later by `pickPrice`.
 */
export function combinePriceObservations(opts: {
  byProvider: Record<string, Observation[]>;
  reports: Observation[];
  requested: string;
  /** Date of the Excel rows in `byProvider.lea`, or null when the workbook failed. */
  excelDate: string | null;
}): { date: string; observations: Observation[]; sources: string[] } {
  const { byProvider, reports, requested, excelDate } = opts;
  const sources = Object.entries(byProvider)
    .filter(([, rows]) => rows.length > 0)
    .map(([name]) => name);
  if (reports.length) sources.push(REPORT_SOURCE);

  const overlay = sources.some((s) => s !== EXCEL_SOURCE);
  const date = overlay ? requested : (excelDate ?? requested);
  // Excel rows stay first: address matching samples a group's first row, and exact price ties
  // keep the later row, so this order keeps station matches as they were before ranking.
  const observations = [
    ...(byProvider[EXCEL_SOURCE] ?? []),
    ...Object.entries(byProvider)
      .filter(([name]) => name !== EXCEL_SOURCE)
      .flatMap(([, rows]) => rows),
    ...reports,
  ];
  return { date, observations, sources };
}

export interface SourceUsage {
  name: string;
  /** Prices this source supplied in the snapshot, not counting carried-forward stale ones. */
  chosen: number;
  stale: number;
}

/** Sources behind the published snapshot, in ranking order, then reports, then any others. */
export function summarizeSources(daily: DailyPrices, order: string[]): SourceUsage[] {
  const usage = new Map<string, SourceUsage>();
  for (const fuels of Object.values(daily.prices)) {
    for (const entry of Object.values(fuels)) {
      if (!entry) continue;
      const u = usage.get(entry.source) ?? { name: entry.source, chosen: 0, stale: 0 };
      if (entry.stale) u.stale++;
      else u.chosen++;
      usage.set(entry.source, u);
    }
  }
  const position = (name: string): number => {
    const i = order.indexOf(name);
    if (i !== -1) return i;
    return name === REPORT_SOURCE ? order.length : order.length + 1;
  };
  return [...usage.values()].sort(
    (a, b) => position(a.name) - position(b.name) || a.name.localeCompare(b.name),
  );
}
