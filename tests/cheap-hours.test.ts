import { describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n/index.ts";
import {
  cheapestHourRanges,
  formatCheapRanges,
  formatHourSpan,
  hourAverages,
} from "../src/cheap-hours.ts";
import type { HistoryHourSeries } from "../src/types.ts";

function series(hours: Record<number, number>): HistoryHourSeries {
  const values = Array.from({ length: 24 }, (_, h) => hours[h] ?? null);
  return { hours: [...Array(24).keys()], brands: { neste: values, viada: values } };
}

describe("hourAverages", () => {
  it("averages brands at each hour", () => {
    const s: HistoryHourSeries = {
      hours: [...Array(24).keys()],
      brands: {
        neste: Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.5 : null)),
        viada: Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.7 : null)),
      },
    };
    expect(hourAverages(s)[8]).toBe(1.6);
    expect(hourAverages(s)[7]).toBeNull();
  });
});

describe("cheapestHourRanges", () => {
  it("returns a single cheapest hour", () => {
    const ranges = cheapestHourRanges(series({ 7: 1.4, 11: 1.6 }));
    expect(ranges).toEqual([{ start: 7, end: 7, price: 1.4 }]);
  });

  it("merges consecutive hours within a small epsilon", () => {
    const ranges = cheapestHourRanges(series({ 7: 1.4, 8: 1.403, 11: 1.6 }));
    expect(ranges).toEqual([{ start: 7, end: 8, price: 1.4 }]);
  });

  it("wraps a cheap window across midnight", () => {
    const ranges = cheapestHourRanges(series({ 0: 1.4, 1: 1.4, 23: 1.4, 12: 1.8 }));
    expect(ranges).toEqual([{ start: 23, end: 1, price: 1.4 }]);
  });

  it("returns nothing when every hour is empty", () => {
    expect(cheapestHourRanges(series({}))).toEqual([]);
  });
});

describe("formatHourSpan", () => {
  it("formats a single hour and a range", () => {
    expect(formatHourSpan(7, 7)).toBe("07:00");
    expect(formatHourSpan(7, 9)).toBe("07:00–09:00");
    expect(formatHourSpan(22, 1)).toBe("22:00–01:00");
  });
});

describe("formatCheapRanges", () => {
  it("joins disjoint windows in the active locale", () => {
    setLocale("lt");
    expect(
      formatCheapRanges([
        { start: 7, end: 7, price: 1.4 },
        { start: 19, end: 19, price: 1.4 },
      ]),
    ).toBe("07:00 ir 19:00");
    setLocale("en");
    expect(
      formatCheapRanges([
        { start: 7, end: 7, price: 1.4 },
        { start: 19, end: 19, price: 1.4 },
      ]),
    ).toBe("07:00 and 19:00");
  });
});
