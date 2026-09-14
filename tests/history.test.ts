import { describe, expect, it } from "vitest";
import {
  brandAverages,
  compactHistoryForClient,
  datesWithinDays,
  mergeSamples,
  rollupHourAverages,
  sampleFromDaily,
  sampleKey,
} from "../scripts/history.ts";
import type { DailyPrices, HistorySample, Station } from "../src/types.ts";

const stations = new Map<string, Station>([
  [
    "a",
    {
      id: "a",
      name: "A",
      brand: "neste",
      lat: 54.6,
      lon: 25.2,
      fuels: ["D"],
      sourceIds: {},
    },
  ],
  [
    "b",
    {
      id: "b",
      name: "B",
      brand: "viada",
      lat: 54.7,
      lon: 25.3,
      fuels: ["D"],
      sourceIds: {},
    },
  ],
]);

const daily: DailyPrices = {
  date: "2026-09-14",
  generatedAt: "2026-09-14T05:00:00.000Z",
  prices: {
    a: { D: { price: 1.6, source: "lea", observedAt: "2026-09-14T07:00:00+03:00" } },
    b: { D: { price: 1.4, source: "lea", observedAt: "2026-09-14T07:00:00+03:00" } },
  },
};

describe("datesWithinDays", () => {
  it("keeps dates up to a week back", () => {
    expect(datesWithinDays(["2026-09-01", "2026-09-07", "2026-09-14"], "2026-09-14", 7)).toEqual([
      "2026-09-07",
      "2026-09-14",
    ]);
  });
});

describe("brandAverages", () => {
  it("averages each provider for a fuel", () => {
    expect(brandAverages(daily, stations).D).toEqual({ neste: 1.6, viada: 1.4 });
  });
});

describe("sampleFromDaily", () => {
  it("records the Vilnius hour of the snapshot", () => {
    const sample = sampleFromDaily(daily, stations);
    expect(sample.hour).toBe(8);
    expect(sample.at).toBe("2026-09-14T08:00:00.000Z");
    expect(sampleKey(sample)).toBe("2026-09-14-08");
  });

  it("keys by the file date when generatedAt is from a later backfill", () => {
    const backfilled: DailyPrices = {
      date: "2026-09-07",
      generatedAt: "2026-09-14T08:39:52.000Z",
      prices: {
        a: { D: { price: 1.6, source: "lea", observedAt: "2026-09-07T07:00:00+03:00" } },
        b: { D: { price: 1.4, source: "lea", observedAt: "2026-09-07T07:00:00+03:00" } },
      },
    };
    const sample = sampleFromDaily(backfilled, stations);
    expect(sample.hour).toBe(7);
    expect(sampleKey(sample)).toBe("2026-09-07-07");
  });

  it("keeps two backfilled days distinct even when generatedAt matches", () => {
    const other: DailyPrices = {
      ...daily,
      date: "2026-09-13",
      generatedAt: daily.generatedAt,
      prices: {
        a: { D: { price: 1.5, source: "lea", observedAt: "2026-09-13T07:00:00+03:00" } },
      },
    };
    const keys = [sampleFromDaily(daily, stations), sampleFromDaily(other, stations)].map(
      sampleKey,
    );
    expect(keys).toEqual(["2026-09-14-08", "2026-09-13-07"]);
  });
});

describe("mergeSamples", () => {
  it("drops samples older than a week and replaces the same hour", () => {
    const old: HistorySample = {
      at: "2026-09-01T08:00:00.000Z",
      hour: 11,
      byFuel: { D: { neste: 1 } },
    };
    const first: HistorySample = {
      at: "2026-09-14T05:00:00.000Z",
      hour: 8,
      byFuel: { D: { neste: 1.5 } },
    };
    const second: HistorySample = {
      at: "2026-09-14T05:10:00.000Z",
      hour: 8,
      byFuel: { D: { neste: 1.55 } },
    };
    const merged = mergeSamples([old, first], [second], new Date("2026-09-14T12:00:00Z"), 7);
    expect(merged).toHaveLength(1);
    expect(merged[0].byFuel.D?.neste).toBe(1.55);
  });
});

describe("rollupHourAverages", () => {
  it("averages providers into a 24-hour profile", () => {
    const samples: HistorySample[] = [
      { at: "2026-09-13T05:00:00Z", hour: 8, byFuel: { D: { neste: 1.5, viada: 1.4 } } },
      { at: "2026-09-14T05:00:00Z", hour: 8, byFuel: { D: { neste: 1.7, viada: 1.4 } } },
    ];
    const rolled = rollupHourAverages(samples).D!;
    expect(rolled.brands.neste[8]).toBe(1.6);
    expect(rolled.brands.viada[8]).toBe(1.4);
    expect(rolled.brands.neste[9]).toBeNull();
  });
});

describe("compactHistoryForClient", () => {
  it("drops samples so the map bundle does not ship hourly snapshots", () => {
    const compact = compactHistoryForClient({
      generatedAt: "2026-09-14T12:00:00Z",
      keepDays: 7,
      samples: [{ at: "2026-09-14T08:00:00.000Z", hour: 8, byFuel: { D: { neste: 1.6 } } }],
      byFuel: { D: { hours: [8], brands: { neste: [1.6] } } },
    });
    expect(compact).toEqual({
      generatedAt: "2026-09-14T12:00:00Z",
      keepDays: 7,
      byFuel: { D: { hours: [8], brands: { neste: [1.6] } } },
    });
    expect("samples" in compact).toBe(false);
  });
});
