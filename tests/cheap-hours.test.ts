import { describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n/index.ts";
import {
  cheapestHourRanges,
  formatCheapInstant,
  formatCheapRange,
  formatCheapRanges,
  formatHourSpan,
  hourAverages,
  indicesInLastHours,
} from "../src/cheap-hours.ts";
import type { HistoryHourSeries } from "../src/types.ts";

function series(hours: Record<number, number>): HistoryHourSeries {
  const values = Array.from({ length: 24 }, (_, h) => hours[h] ?? null);
  return { hours: [...Array(24).keys()], brands: { neste: values, viada: values } };
}

function dated(points: Array<{ date: string; hour: number; price: number }>): HistoryHourSeries {
  return {
    dates: points.map((p) => p.date),
    hours: points.map((p) => p.hour),
    brands: { neste: points.map((p) => p.price), viada: points.map((p) => p.price) },
  };
}

describe("hourAverages", () => {
  it("averages brands at each sample", () => {
    const s: HistoryHourSeries = {
      dates: Array.from({ length: 24 }, () => "2026-09-14"),
      hours: [...Array(24).keys()],
      brands: {
        neste: Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.5 : null)),
        viada: Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.7 : null)),
      },
    };
    expect(hourAverages(s)[8]).toBe(1.6);
    expect(hourAverages(s)[7]).toBeNull();
  });

  it("indexes by sample, not by hour-of-day value", () => {
    const s = dated([
      { date: "2026-09-14", hour: 7, price: 1.4 },
      { date: "2026-09-15", hour: 16, price: 1.6 },
    ]);
    expect(hourAverages(s)).toEqual([1.4, 1.6]);
  });
});

describe("cheapestHourRanges", () => {
  it("returns a single cheapest hour", () => {
    const ranges = cheapestHourRanges(series({ 7: 1.4, 11: 1.6 }));
    expect(ranges).toEqual([{ start: 7, end: 7, price: 1.4, from: "T07:00", to: "T07:00" }]);
  });

  it("merges consecutive hours within a small epsilon", () => {
    const ranges = cheapestHourRanges(series({ 7: 1.4, 8: 1.403, 11: 1.6 }));
    expect(ranges).toEqual([{ start: 7, end: 8, price: 1.4, from: "T07:00", to: "T08:00" }]);
  });

  it("wraps a cheap window across midnight on a 24-hour profile", () => {
    const ranges = cheapestHourRanges(series({ 0: 1.4, 1: 1.4, 23: 1.4, 12: 1.8 }));
    expect(ranges).toEqual([{ start: 23, end: 1, price: 1.4, from: "T23:00", to: "T01:00" }]);
  });

  it("marks the cheapest samples in the last 24 hours, not the whole week", () => {
    const ranges = cheapestHourRanges(
      dated([
        { date: "2026-09-08", hour: 7, price: 1.2 },
        { date: "2026-09-14", hour: 7, price: 1.3 },
        { date: "2026-09-15", hour: 10, price: 1.5 },
        { date: "2026-09-15", hour: 21, price: 1.4 },
      ]),
    );
    expect(ranges).toEqual([
      {
        start: 3,
        end: 3,
        price: 1.4,
        from: "2026-09-15T21:00",
        to: "2026-09-15T21:00",
      },
    ]);
  });

  it("does not wrap midnight on a dated timeline", () => {
    const ranges = cheapestHourRanges(
      dated([
        { date: "2026-09-14", hour: 23, price: 1.4 },
        { date: "2026-09-15", hour: 7, price: 1.8 },
        { date: "2026-09-15", hour: 21, price: 1.4 },
      ]),
    );
    expect(ranges).toEqual([
      {
        start: 0,
        end: 0,
        price: 1.4,
        from: "2026-09-14T23:00",
        to: "2026-09-14T23:00",
      },
      {
        start: 2,
        end: 2,
        price: 1.4,
        from: "2026-09-15T21:00",
        to: "2026-09-15T21:00",
      },
    ]);
  });

  it("collapses a flat last-24h plateau to the cheapest snapshot", () => {
    const ranges = cheapestHourRanges(
      dated([
        { date: "2026-09-16", hour: 0, price: 1.501 },
        { date: "2026-09-16", hour: 6, price: 1.5 },
        { date: "2026-09-16", hour: 12, price: 1.502 },
        { date: "2026-09-16", hour: 18, price: 1.501 },
      ]),
    );
    expect(ranges).toEqual([
      {
        start: 1,
        end: 1,
        price: 1.5,
        from: "2026-09-16T06:00",
        to: "2026-09-16T06:00",
      },
    ]);
  });

  it("keeps a short consecutive valley on a dated timeline", () => {
    const ranges = cheapestHourRanges(
      dated([
        { date: "2026-09-16", hour: 7, price: 1.4 },
        { date: "2026-09-16", hour: 8, price: 1.403 },
        { date: "2026-09-16", hour: 14, price: 1.6 },
      ]),
    );
    expect(ranges).toEqual([
      {
        start: 0,
        end: 1,
        price: 1.4,
        from: "2026-09-16T07:00",
        to: "2026-09-16T08:00",
      },
    ]);
  });

  it("returns nothing when every hour is empty", () => {
    expect(cheapestHourRanges(series({}))).toEqual([]);
  });
});

describe("indicesInLastHours", () => {
  it("keeps samples on or after the latest sample minus 24 hours", () => {
    const s = dated([
      { date: "2026-09-14", hour: 7, price: 1.3 },
      { date: "2026-09-14", hour: 21, price: 1.4 },
      { date: "2026-09-15", hour: 10, price: 1.5 },
      { date: "2026-09-15", hour: 21, price: 1.4 },
    ]);
    expect(indicesInLastHours(s)).toEqual([1, 2, 3]);
    expect(indicesInLastHours(series({ 7: 1.4 }))).toBeUndefined();
  });
});

describe("formatHourSpan", () => {
  it("formats a single hour and a range", () => {
    expect(formatHourSpan(7, 7)).toBe("07:00");
    expect(formatHourSpan(7, 9)).toBe("07:00–09:00");
    expect(formatHourSpan(22, 1)).toBe("22:00–01:00");
  });
});

describe("formatCheapInstant", () => {
  it("includes the calendar day when a date is present", () => {
    setLocale("en");
    expect(formatCheapInstant("2026-09-15T07:00")).toMatch(/15.*07:00/);
    expect(formatCheapInstant("T11:00")).toBe("11:00");
  });
});

describe("formatCheapRange", () => {
  it("shows date and time, collapsing the day when the range stays on one date", () => {
    setLocale("en");
    expect(
      formatCheapRange({
        start: 0,
        end: 0,
        price: 1.4,
        from: "2026-09-15T07:00",
        to: "2026-09-15T07:00",
      }),
    ).toMatch(/15.*07:00/);
    expect(
      formatCheapRange({
        start: 0,
        end: 1,
        price: 1.4,
        from: "2026-09-15T07:00",
        to: "2026-09-15T16:00",
      }),
    ).toMatch(/15.*07:00–16:00/);
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
