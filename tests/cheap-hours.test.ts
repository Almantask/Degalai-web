import { describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n/index.ts";
import {
  cheapestHourRanges,
  cheapestHoursByFuel,
  filterSeries,
  formatCheapInstant,
  formatCheapRange,
  formatCheapRanges,
  formatHourSpan,
  hourAverages,
  indicesFromHour,
  indicesInLastHours,
  isoOrdinalHours,
  sampleOrdinalHours,
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

describe("sampleOrdinalHours", () => {
  it("rejects a bad hour and falls back to the clock hour without a real date", () => {
    expect(sampleOrdinalHours("2026-09-15", Number.NaN)).toBeNull();
    expect(sampleOrdinalHours(undefined, 4)).toBe(4);
    expect(sampleOrdinalHours("not-a-date", 3)).toBe(3);
    expect(sampleOrdinalHours("2026-09-15", 7)).toBe(
      Date.parse("2026-09-15T00:00:00Z") / 3_600_000 + 7,
    );
  });
});

describe("isoOrdinalHours", () => {
  it("rejects a missing or invalid timestamp and defaults a missing hour part", () => {
    expect(isoOrdinalHours(undefined)).toBeNull();
    expect(isoOrdinalHours("not-a-date")).toBeNull();
    const Real = Intl.DateTimeFormat;
    const Fake = function (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      const fmt = new Real(locales, options);
      const parts = fmt.formatToParts.bind(fmt);
      fmt.formatToParts = (date) => parts(date).filter((p) => p.type !== "hour");
      return fmt;
    } as unknown as typeof Intl.DateTimeFormat;
    Object.defineProperty(Fake, "prototype", { value: Real.prototype });
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(Fake);
    try {
      expect(isoOrdinalHours("2026-09-15T07:30:00Z")).toEqual(expect.any(Number));
    } finally {
      vi.restoreAllMocks();
    }
  });
});

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

  it("falls back to the date row or the first brand when hours are empty", () => {
    expect(hourAverages({ hours: [], dates: ["2026-01-01"], brands: { a: [1.2] } })).toEqual([1.2]);
    expect(hourAverages({ hours: [], brands: { a: [1, 3] } })).toEqual([1, 3]);
    expect(hourAverages({ hours: [], brands: {} })).toEqual([]);
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

  it("returns nothing when every hour is empty", () => {
    expect(cheapestHourRanges(series({}))).toEqual([]);
  });

  it("drops a window that misses the epsilon and skips samples with no clock hour", () => {
    expect(cheapestHourRanges(series({ 7: 1.4 }), -1)).toEqual([]);
    const gap: HistoryHourSeries = {
      hours: [Number.NaN, Number.NaN, Number.NaN],
      brands: { neste: [1.4, 1.8, 1.4] },
    };
    expect(cheapestHourRanges(gap)).toEqual([{ start: 2, end: 0, price: 1.4 }]);
    expect(
      cheapestHourRanges({
        hours: [Number.NaN, Number.NaN],
        brands: { neste: [1.4, 1.401] },
      }),
    ).toEqual([{ start: 0, end: 1, price: 1.4 }]);
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

  it("windows from generatedAt so dropped unchanged hours do not pull in an older day", () => {
    const s = dated([
      { date: "2026-09-14", hour: 11, price: 1.3 },
      { date: "2026-09-15", hour: 10, price: 1.5 },
    ]);
    expect(indicesInLastHours(s)).toEqual([0, 1]);
    expect(indicesInLastHours(s, 24, "2026-09-15T18:12:54.580Z")).toEqual([1]);
  });

  it("ignores a null ordinal and an empty or non-finite window", () => {
    expect(indicesInLastHours({ dates: [], hours: [1], brands: {} })).toBeUndefined();
    expect(
      indicesInLastHours({ dates: ["2026-09-15"], hours: [Number.NaN], brands: {} }),
    ).toBeUndefined();
    expect(
      indicesInLastHours({
        dates: ["2026-09-15", "2026-09-15"],
        hours: [Number.NaN, 10],
        brands: {},
      }),
    ).toEqual([1]);
  });
});

describe("formatHourSpan", () => {
  it("formats a single hour and a range", () => {
    expect(formatHourSpan(7, 7)).toBe("07:00");
    expect(formatHourSpan(7, 9)).toBe("07:00–09:00");
    expect(formatHourSpan(22, 1)).toBe("22:00–01:00");
  });
});

describe("filterSeries", () => {
  it("returns the series unchanged, or without the excluded brands", () => {
    const s = dated([{ date: "2026-09-15", hour: 7, price: 1.4 }]);
    expect(filterSeries(s)).toBe(s);
    expect(filterSeries(s, []).brands).toBe(s.brands);
    expect(filterSeries(s, ["viada"]).brands).toEqual({ neste: [1.4] });
  });
});

describe("formatCheapInstant", () => {
  it("includes the calendar day when a date is present", () => {
    setLocale("en");
    expect(formatCheapInstant("2026-09-15T07:00")).toMatch(/15.*07:00/);
    expect(formatCheapInstant("T11:00")).toBe("11:00");
  });

  it("returns text that is not a timestamp, and a bare time", () => {
    expect(formatCheapInstant("nope")).toBe("nope");
    expect(formatCheapInstant("T09:30")).toBe("09:30");
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

  it("spans two days, one day, or a clock range with no timestamp", () => {
    setLocale("en");
    expect(
      formatCheapRange({
        start: 0,
        end: 1,
        price: 1.4,
        from: "2026-09-15T22:00",
        to: "2026-09-16T02:00",
      }),
    ).toMatch(/22:00/);
    expect(
      formatCheapRange({
        start: 0,
        end: 1,
        price: 1.4,
        from: "2026-09-15T07:00",
        to: "2026-09-15T09:00",
      }),
    ).toMatch(/07:00–09:00/);
    expect(formatCheapRange({ start: 7, end: 9, price: 1.4 })).toBe("07:00–09:00");
    expect(formatCheapRange({ start: 7, end: 7, price: 1.4, from: "2026-09-15T07:00" })).toMatch(
      /07:00/,
    );
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

  it("is empty for none, the only window for one, and joined for two", () => {
    expect(formatCheapRanges([])).toBe("");
    setLocale("lt");
    expect(formatCheapRanges([{ start: 7, end: 7, price: 1.4 }])).toBe("07:00");
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

describe("EV cheap hours look ahead", () => {
  const spot: HistoryHourSeries = {
    dates: ["2026-10-06", "2026-10-06", "2026-10-06", "2026-10-07", "2026-10-07"],
    hours: [3, 14, 15, 3, 4],
    brands: { spot: [0.01, 0.2, 0.18, 0.05, 0.05] },
  };

  it("indexes samples from the current Vilnius hour on", () => {
    // 11:30 UTC is 14:30 in Vilnius (UTC+3).
    expect(indicesFromHour(spot, "2026-10-06T11:30:00Z")).toEqual([1, 2, 3, 4]);
    expect(indicesFromHour(spot, "not-a-date")).toEqual([]);
    expect(
      indicesFromHour(
        { hours: [Number.NaN], dates: ["2026-10-06"], brands: { spot: [0.1] } },
        "2026-10-06T00:00:00Z",
      ),
    ).toEqual([]);
  });

  it("picks the cheapest upcoming hours, not the cheaper past ones", () => {
    const ranges = cheapestHoursByFuel(
      { generatedAt: "2026-10-01T00:00:00Z", keepDays: 7, byFuel: {}, spot },
      [],
      "2026-10-06T11:30:00Z",
    ).EV;
    expect(ranges).toEqual([
      { start: 3, end: 4, price: 0.05, from: "2026-10-07T03:00", to: "2026-10-07T04:00" },
    ]);
  });

  it("falls back to the trailing day when no future hours are published", () => {
    // 03:30 UTC is 06:30 in Vilnius, after the last published hour.
    const ranges = cheapestHourRanges(spot, undefined, "2026-10-07T03:30:00Z", { ahead: true });
    expect(ranges.map((r) => [r.start, r.end])).toEqual([[3, 4]]);
  });

  it("prices each fuel that has a series, and nothing without a file", () => {
    const diesel = dated([
      { date: "2026-10-06", hour: 7, price: 1.4 },
      { date: "2026-10-06", hour: 8, price: 1.9 },
    ]);
    diesel.brands.orlen = [9, 9];
    const out = cheapestHoursByFuel(
      { generatedAt: "2026-10-06T04:00:00Z", keepDays: 7, byFuel: { D: diesel }, spot },
      ["orlen"],
      "2026-10-06T00:00:00Z",
    );
    expect(out.D?.[0]?.price).toBe(1.4);
    expect(out.EV?.length).toBeGreaterThan(0);
    expect(out["95"]).toBeUndefined();
    expect(cheapestHoursByFuel(null)).toEqual({});
    expect(
      cheapestHoursByFuel({
        generatedAt: "2026-10-06T04:00:00Z",
        keepDays: 7,
        byFuel: { D: diesel },
        spot,
      }),
    ).toHaveProperty("EV");
  });

  it("shows nothing when the spot series is days old", () => {
    expect(cheapestHourRanges(spot, undefined, "2026-10-12T12:00:00Z", { ahead: true })).toEqual(
      [],
    );
  });
});
