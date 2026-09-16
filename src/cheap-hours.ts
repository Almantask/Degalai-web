import { round3 } from "./calc.ts";
import { formatChartDate } from "./format.ts";
import { getLocale } from "./i18n/index.ts";
import {
  FUEL_TYPES,
  type CheapHourRange,
  type FuelType,
  type HistoryFile,
  type HistoryHourSeries,
} from "./types.ts";

/** Hours within this many euros of the cheapest count as the same cheap window. */
export const CHEAP_HOUR_EPS = 0.005;

export function filterSeries(
  series: HistoryHourSeries,
  excluded: readonly string[] = [],
): HistoryHourSeries {
  if (excluded.length === 0) return series;
  const skip = new Set(excluded);
  const brands = Object.fromEntries(Object.entries(series.brands).filter(([id]) => !skip.has(id)));
  return { dates: series.dates, hours: series.hours, brands };
}

export function hourAverages(series: HistoryHourSeries): Array<number | null> {
  const n =
    series.hours.length || series.dates?.length || Object.values(series.brands)[0]?.length || 0;
  return Array.from({ length: n }, (_, i) => {
    const vals: number[] = [];
    for (const row of Object.values(series.brands)) {
      const v = row[i];
      if (v != null) vals.push(v);
    }
    if (vals.length === 0) return null;
    return round3(vals.reduce((a, b) => a + b, 0) / vals.length);
  });
}

export function cheapestHourRanges(
  series: HistoryHourSeries,
  epsilon = CHEAP_HOUR_EPS,
): CheapHourRange[] {
  const avgs = hourAverages(series);
  const cheapHours: number[] = [];
  let min = Infinity;
  for (const price of avgs) {
    if (price != null && price < min) min = price;
  }
  if (!Number.isFinite(min)) return [];
  for (let h = 0; h < avgs.length; h++) {
    const price = avgs[h];
    if (price != null && price <= min + epsilon) cheapHours.push(h);
  }
  if (cheapHours.length === 0) return [];

  const groups: CheapHourRange[] = [];
  for (const h of cheapHours) {
    const last = groups.at(-1);
    const at = sampleWallTime(series, h);
    if (last && h === last.end + 1) {
      last.end = h;
      last.price = Math.min(last.price, avgs[h]!);
      if (at) last.to = at;
    } else {
      groups.push({
        start: h,
        end: h,
        price: avgs[h]!,
        ...(at ? { from: at, to: at } : {}),
      });
    }
  }

  // A 24-hour clock profile can wrap midnight; a dated timeline cannot.
  if (!series.dates?.length && groups.length >= 2) {
    const first = groups[0];
    const last = groups.at(-1)!;
    if (first.start === 0 && last.end === avgs.length - 1) {
      groups.shift();
      groups.pop();
      groups.unshift({
        start: last.start,
        end: first.end,
        price: Math.min(first.price, last.price),
        ...(last.from && first.to ? { from: last.from, to: first.to } : {}),
      });
    }
  }
  return groups;
}

export function formatHourClock(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${String(h).padStart(2, "0")}:00`;
}

export function formatHourSpan(start: number, end: number): string {
  if (start === end) return formatHourClock(start);
  return `${formatHourClock(start)}–${formatHourClock(end)}`;
}

/** `YYYY-MM-DDTHH:mm` in Europe/Vilnius wall time, or a time-only `THH:mm`. */
export function formatCheapInstant(isoLocal: string): string {
  const m = isoLocal.match(/^(?:(\d{4}-\d{2}-\d{2}))?T(\d{2}:\d{2})/);
  if (!m) return isoLocal;
  const time = m[2];
  return m[1] ? `${formatChartDate(m[1])} ${time}` : time;
}

export function formatCheapRange(range: CheapHourRange): string {
  if (range.from) {
    const to = range.to ?? range.from;
    if (to === range.from) return formatCheapInstant(range.from);
    const fromDay = range.from.slice(0, 10);
    const toDay = to.slice(0, 10);
    const fromTime = range.from.slice(11, 16);
    const toTime = to.slice(11, 16);
    if (fromDay.length === 10 && fromDay === toDay) {
      return `${formatChartDate(fromDay)} ${fromTime}–${toTime}`;
    }
    return `${formatCheapInstant(range.from)}–${formatCheapInstant(to)}`;
  }
  return formatHourSpan(range.start, range.end);
}

export function formatCheapRanges(ranges: CheapHourRange[]): string {
  const parts = ranges.map((r) => formatCheapRange(r));
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  const sep = getLocale() === "lt" ? " ir " : " and ";
  return parts.join(sep);
}

export function cheapestHoursByFuel(
  file: HistoryFile | null,
  excluded: readonly string[] = [],
): Partial<Record<FuelType, CheapHourRange[]>> {
  if (!file) return {};
  const out: Partial<Record<FuelType, CheapHourRange[]>> = {};
  for (const fuel of FUEL_TYPES) {
    const series = file.byFuel[fuel];
    if (!series) continue;
    const ranges = cheapestHourRanges(filterSeries(series, excluded));
    if (ranges.length) out[fuel] = ranges;
  }
  return out;
}

function sampleWallTime(series: HistoryHourSeries, index: number): string | undefined {
  const hour = series.hours[index];
  if (hour == null || !Number.isFinite(hour)) return undefined;
  const time = formatHourClock(hour);
  const date = series.dates?.[index];
  return date ? `${date}T${time}` : `T${time}`;
}
