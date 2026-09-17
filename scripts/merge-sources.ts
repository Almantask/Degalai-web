import type { Observation } from "../src/types.ts";

export function excelFloorDate(
  byDate: Map<string, Observation[]>,
  requested: string,
): string | null {
  if (byDate.has(requested)) return requested;
  const dates = [...byDate.keys()].sort();
  return dates.at(-1) ?? null;
}

/**
 * Excel is the lagged daily floor. Live LEA rows and fresh user reports overlay it
 * onto `requested` (usually today) so hourly deploys can move before the next workbook.
 */
export function combinePriceObservations(opts: {
  byDate: Map<string, Observation[]>;
  live: Observation[];
  reports: Observation[];
  requested: string;
  excelFetched: boolean;
}): { date: string; observations: Observation[]; sources: string[] } {
  const { byDate, live, reports, requested, excelFetched } = opts;
  const sources: string[] = [];
  if (excelFetched) sources.push("lea");
  if (live.length) sources.push("lea-live");
  if (reports.length) sources.push("report");

  const floor = excelFloorDate(byDate, requested);
  const overlay = live.length > 0 || reports.length > 0;
  const date = overlay ? requested : (floor ?? requested);
  const floorRows = overlay
    ? (byDate.get(requested) ?? (floor ? (byDate.get(floor) ?? []) : []))
    : (byDate.get(date) ?? []);

  return { date, observations: [...floorRows, ...live, ...reports], sources };
}
