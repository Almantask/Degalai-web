import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  brandAverages,
  brandStatEqual,
  brandStats,
  buildHistoryFile,
  compactHistoryForClient,
  datesWithinDays,
  fuelPricesEqual,
  hourInVilnius,
  isHistoryFile,
  listPriceDates,
  median,
  mergeSamples,
  prunePriceFiles,
  recomputeHistory,
  rollupHourAverages,
  sampleFromDaily,
  sampleHour,
  sampleKey,
  toBrandStat,
} from "../scripts/history.ts";
import { HISTORY_KEEP_DAYS } from "../src/types.ts";
import type { BrandStat, DailyPrices, HistorySample, Station } from "../src/types.ts";

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

function p(n: number, extra: Partial<BrandStat> = {}): BrandStat {
  return { min: n, max: n, avg: n, median: n, ...extra };
}

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
  it("records min, max, average and median for each provider", () => {
    expect(brandAverages(daily, stations).D).toEqual({
      neste: p(1.6),
      viada: p(1.4),
    });
  });

  it("spreads min and max when a brand has several stations", () => {
    const more = new Map(stations);
    more.set("c", {
      id: "c",
      name: "C",
      brand: "neste",
      lat: 54.8,
      lon: 25.4,
      fuels: ["D"],
      sourceIds: {},
    });
    const snap: DailyPrices = {
      ...daily,
      prices: {
        ...daily.prices,
        c: { D: { price: 1.2, source: "lea", observedAt: "2026-09-14T07:00:00+03:00" } },
      },
    };
    expect(brandAverages(snap, more).D?.neste).toEqual({
      min: 1.2,
      max: 1.6,
      avg: 1.4,
      median: 1.4,
    });
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
      byFuel: { D: { neste: p(1) } },
    };
    const first: HistorySample = {
      at: "2026-09-14T05:00:00.000Z",
      hour: 8,
      byFuel: { D: { neste: p(1.5) } },
    };
    const second: HistorySample = {
      at: "2026-09-14T05:10:00.000Z",
      hour: 8,
      byFuel: { D: { neste: p(1.55) } },
    };
    const merged = mergeSamples([old, first], [second], new Date("2026-09-14T12:00:00Z"), 7);
    expect(merged).toHaveLength(1);
    expect(merged[0].byFuel.D?.neste).toEqual(p(1.55));
  });

  it("drops later hours when brand averages did not change", () => {
    const morning: HistorySample = {
      at: "2026-09-15T10:00:00.000Z",
      hour: 10,
      byFuel: { D: { neste: p(1.6), viada: p(1.4) } },
    };
    const evening: HistorySample = {
      at: "2026-09-15T21:00:00.000Z",
      hour: 21,
      byFuel: { D: { viada: p(1.4), neste: p(1.6) } },
    };
    const changed: HistorySample = {
      at: "2026-09-16T07:00:00.000Z",
      hour: 7,
      byFuel: { D: { neste: p(1.62), viada: p(1.4) } },
    };
    const merged = mergeSamples([morning, evening], [changed], new Date("2026-09-16T12:00:00Z"), 7);
    expect(merged.map((s) => s.hour)).toEqual([10, 7]);
    expect(merged[1].byFuel.D?.neste).toEqual(p(1.62));
  });
});

describe("rollupHourAverages", () => {
  it("keeps each snapshot as a dated point instead of averaging the same hour", () => {
    const samples: HistorySample[] = [
      { at: "2026-09-13T05:00:00Z", hour: 8, byFuel: { D: { neste: p(1.5), viada: p(1.4) } } },
      { at: "2026-09-14T05:00:00Z", hour: 8, byFuel: { D: { neste: p(1.7), viada: p(1.4) } } },
    ];
    const rolled = rollupHourAverages(samples).D!;
    expect(rolled.dates).toEqual(["2026-09-13", "2026-09-14"]);
    expect(rolled.hours).toEqual([8, 8]);
    expect(rolled.brands.neste).toEqual([1.5, 1.7]);
    expect(rolled.brands.viada).toEqual([1.4, 1.4]);
    expect(rolled.stats?.min?.neste).toEqual([1.5, 1.7]);
    expect(rolled.stats?.median?.neste).toEqual([1.5, 1.7]);
  });

  it("omits a fuel's point when that fuel's averages did not change", () => {
    const samples: HistorySample[] = [
      {
        at: "2026-09-15T10:00:00Z",
        hour: 10,
        byFuel: { D: { neste: p(1.5) }, "95": { neste: p(1.8) } },
      },
      {
        at: "2026-09-15T16:00:00Z",
        hour: 16,
        byFuel: { D: { neste: p(1.5) }, "95": { neste: p(1.82) } },
      },
    ];
    expect(rollupHourAverages(samples).D?.hours).toEqual([10]);
    expect(rollupHourAverages(samples)["95"]?.hours).toEqual([10, 16]);
  });
});

describe("compactHistoryForClient", () => {
  it("drops samples so the map bundle does not ship hourly snapshots", () => {
    const compact = compactHistoryForClient({
      generatedAt: "2026-09-14T12:00:00Z",
      keepDays: 7,
      samples: [{ at: "2026-09-14T08:00:00.000Z", hour: 8, byFuel: { D: { neste: p(1.6) } } }],
      byFuel: {
        D: { dates: ["2026-09-14"], hours: [8], brands: { neste: [1.6] } },
      },
    });
    expect(compact).toEqual({
      generatedAt: "2026-09-14T12:00:00Z",
      keepDays: 7,
      byFuel: { D: { dates: ["2026-09-14"], hours: [8], brands: { neste: [1.6] } } },
    });
    expect("samples" in compact).toBe(false);
  });
});

describe("buildHistoryFile", () => {
  // `brand` is the network id that assignNetworkBrands gives each charger.
  const charger = (id: string, network: string, brand: string): [string, Station] => [
    id,
    {
      id,
      name: id,
      brand,
      lat: 54.7,
      lon: 25.3,
      fuels: ["EV"],
      sourceIds: {},
      ev: { sockets: [], network },
    },
  ];
  const ev = (price: number) => ({
    EV: { price, source: "via-lietuva", observedAt: "2026-09-14T07:00:00Z" },
  });

  it("keeps EV stats per charging network, without free chargers, and spot apart", () => {
    const withChargers = new Map([
      ...stations,
      charger("c1", "Ignitis LT", "ignitis-on"),
      charger("c2", "Inbalance grid", "inbalance-grid"),
      charger("c3", "In Balance grid, UAB", "inbalance-grid"),
      charger("c4", "Stuart Energy", "stuart-energy"),
    ]);
    const sample = sampleFromDaily(
      {
        ...daily,
        prices: { ...daily.prices, c1: ev(0.39), c2: ev(0.28), c3: ev(0.36), c4: ev(0) },
      },
      withChargers,
    );
    // Stuart Energy's only charger here is free, so it has no line.
    expect(sample.byFuel.EV).toEqual({
      "ignitis-on": p(0.39),
      "inbalance-grid": { min: 0.28, max: 0.36, avg: 0.32, median: 0.32 },
    });
    const spot = { dates: ["2026-09-14"], hours: [9], brands: { spot: [0.12] } };
    const file = buildHistoryFile([sample], "2026-09-14T12:00:00Z", spot);
    expect(file.spot).toEqual(spot);
    expect(file.byFuel.EV?.stats?.min?.["inbalance-grid"]).toEqual([0.28]);
    expect(file.byFuel.D?.brands.neste).toEqual([1.6]);
    expect(buildHistoryFile([sample], "2026-09-14T12:00:00Z").spot).toBeUndefined();
    expect(compactHistoryForClient(file).spot).toEqual(spot);
  });
});

describe("median", () => {
  it("is zero for an empty list", () => {
    expect(median([])).toBe(0);
  });
});

describe("hourInVilnius", () => {
  it("uses 0 when the formatted time has no hour", () => {
    const Original = Intl.DateTimeFormat;
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      (locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) => {
        const real = new Original(locales, options);
        real.formatToParts = () => [{ type: "literal", value: "x" }];
        return real;
      },
    );
    expect(hourInVilnius("2026-09-14T05:00:00.000Z")).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("sampleHour", () => {
  it("uses the generated hour when that day has no observation", () => {
    expect(
      sampleHour({
        date: "2026-09-14",
        generatedAt: "2026-09-01T05:00:00.000Z",
        prices: { a: { D: { price: 1.2, source: "lea", observedAt: "" } } },
      }),
    ).toBe(8);
  });

  it("uses noon when a snapshot has no clock", () => {
    expect(sampleHour({ date: "2026-09-14", generatedAt: "", prices: {} })).toBe(12);
  });
});

describe("brandStats", () => {
  it("counts an unknown station as independent", () => {
    expect(brandStats(daily, new Map()).D?.independent).toEqual({
      min: 1.4,
      max: 1.6,
      avg: 1.5,
      median: 1.5,
    });
  });
});

describe("toBrandStat", () => {
  it("copies a single number into every stat", () => {
    expect(toBrandStat(1.5)).toEqual({ min: 1.5, max: 1.5, avg: 1.5, median: 1.5 });
  });

  it("rejects a non-finite number", () => {
    expect(toBrandStat(Number.NaN)).toBeUndefined();
  });

  it("rejects a missing value", () => {
    expect(toBrandStat(null)).toBeUndefined();
  });

  it("rejects a stat that is not all numbers", () => {
    expect(toBrandStat({ min: 1, max: 1, avg: 1, median: "x" })).toBeUndefined();
  });
});

describe("sampleFromDaily clock", () => {
  it("uses the clock it was given", () => {
    const sample = sampleFromDaily(daily, stations, new Date("2026-09-14T12:00:00Z"));
    expect(sample.hour).toBe(15);
    expect(sample.at).toBe("2026-09-14T15:00:00.000Z");
  });
});

describe("brandStatEqual", () => {
  it("treats the same stat as equal", () => {
    const stat = p(1);
    expect(brandStatEqual(stat, stat)).toBe(true);
  });

  it("treats a missing stat as different", () => {
    expect(brandStatEqual(p(1), undefined)).toBe(false);
  });
});

describe("fuelPricesEqual", () => {
  it("treats the same price map as equal", () => {
    const row = { neste: p(1) };
    expect(fuelPricesEqual(row, row)).toBe(true);
  });

  it("treats a missing fuel row as different", () => {
    expect(fuelPricesEqual({ neste: p(1) }, undefined)).toBe(false);
  });

  it("treats a different set of brands as different", () => {
    expect(fuelPricesEqual({ neste: p(1) }, { neste: p(1), viada: p(1) })).toBe(false);
  });
});

describe("mergeSamples order", () => {
  it("orders two samples that share a timestamp by hour", () => {
    const later = {
      at: "2026-09-14T08:00:00.000Z",
      hour: 10,
      byFuel: { D: { neste: p(1) } },
    };
    const earlier = {
      at: "2026-09-14T08:00:00.000Z",
      hour: 8,
      byFuel: { D: { neste: p(2) } },
    };
    const merged = mergeSamples([later], [earlier], new Date("2026-09-14T12:00:00Z"), 7);
    expect(merged.map((s) => s.hour)).toEqual([8, 10]);
  });
});

describe("rollupHourAverages blanks", () => {
  it("leaves a blank where a brand has no price on a point", () => {
    const samples: HistorySample[] = [
      {
        at: "2026-09-14T08:00:00.000Z",
        hour: 8,
        byFuel: { D: { neste: p(1.5), viada: p(1.4) } },
      },
      { at: "2026-09-15T08:00:00.000Z", hour: 8, byFuel: { D: { neste: p(1.6) } } },
    ];
    expect(rollupHourAverages(samples).D?.brands.viada).toEqual([1.4, null]);
  });
});

describe("isHistoryFile", () => {
  const file = { generatedAt: "t", keepDays: 7, samples: [], byFuel: {} };

  it("accepts a history file", () => {
    expect(isHistoryFile(file)).toBe(true);
  });

  it("rejects a missing value", () => {
    expect(isHistoryFile(null)).toBe(false);
  });

  it("rejects a string", () => {
    expect(isHistoryFile("file")).toBe(false);
  });

  it("rejects an array", () => {
    expect(isHistoryFile([])).toBe(false);
  });

  it("rejects an object without byFuel", () => {
    expect(isHistoryFile({ samples: [] })).toBe(false);
  });

  it("rejects an object whose samples are not a list", () => {
    expect(isHistoryFile({ byFuel: {}, samples: "no" })).toBe(false);
  });
});

describe("listPriceDates", () => {
  it("is empty when the directory is missing", () => {
    expect(listPriceDates(join(tmpdir(), "missing-prices-dir"))).toEqual([]);
  });

  it("lists price files and ignores other names", () => {
    const dir = mkdtempSync(join(tmpdir(), "prices-"));
    writeFileSync(join(dir, "2026-09-14.json"), "{}");
    writeFileSync(join(dir, "notes.txt"), "");
    writeFileSync(join(dir, "2026-09-01.json"), "{}");
    expect(listPriceDates(dir)).toEqual(["2026-09-01", "2026-09-14"]);
  });
});

describe("prunePriceFiles", () => {
  it("deletes files older than the keep window and leaves the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "prune-"));
    writeFileSync(join(dir, "2026-09-01.json"), "{}");
    writeFileSync(join(dir, "2026-09-14.json"), "{}");
    writeFileSync(join(dir, "readme.txt"), "");
    expect(prunePriceFiles(dir, "2026-09-14", 7)).toEqual(["2026-09-01"]);
    expect(existsSync(join(dir, "2026-09-01.json"))).toBe(false);
    expect(existsSync(join(dir, "2026-09-14.json"))).toBe(true);
  });
});

describe("recomputeHistory", () => {
  const now = new Date("2026-09-14T12:00:00.000Z");

  it("builds samples from price files when there is no previous chart", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-"));
    writeFileSync(
      join(dir, "2026-09-14.json"),
      JSON.stringify({
        date: "2026-09-14",
        generatedAt: "2026-09-14T05:00:00.000Z",
        prices: {
          a: { D: { price: 1.6, source: "lea", observedAt: "2026-09-14T07:00:00+03:00" } },
        },
      }),
    );
    const next = recomputeHistory(dir, [...stations.values()], null, now);
    expect(next.samples).toHaveLength(1);
    expect(next.generatedAt).toBe(now.toISOString());
  });

  it("keeps the previous timestamp when the chart did not change", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-same-"));
    const previous = {
      generatedAt: "2020-01-01T00:00:00.000Z",
      keepDays: HISTORY_KEEP_DAYS,
      samples: [],
      byFuel: {},
    };
    const next = recomputeHistory(dir, [], previous, now);
    expect(next.generatedAt).toBe(previous.generatedAt);
  });

  it("stamps a new time when history changed", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-new-"));
    const previous = {
      generatedAt: "2020-01-01T00:00:00.000Z",
      keepDays: HISTORY_KEEP_DAYS,
      samples: [{ at: "2020-01-01T08:00:00.000Z", hour: 8, byFuel: {} }],
      byFuel: {},
    };
    const next = recomputeHistory(dir, [], previous, now);
    expect(next.generatedAt).toBe(now.toISOString());
  });

  it("keeps a spot series on the recomputed file", () => {
    const dir = mkdtempSync(join(tmpdir(), "history-spot-"));
    const spot = { dates: ["2026-09-14"], hours: [9], brands: { spot: [0.1] } };
    const next = recomputeHistory(dir, [], null, now, spot);
    expect(next.spot).toEqual(spot);
  });
});
