import { describe, expect, it } from "vitest";
import { lastUpdatedAt, pricesObservedAt, sourceLabels } from "../src/data.ts";
import type { DailyPrices, DataMeta } from "../src/types.ts";

const prices: DailyPrices = {
  date: "2026-09-15",
  generatedAt: "2026-09-15T07:46:15.824Z",
  prices: {},
};

const meta: DataMeta = {
  date: "2026-09-15",
  generatedAt: "2026-09-15T07:46:15.859Z",
  stationCount: 1,
  pricedStationCount: 1,
  sources: ["lea"],
};

describe("lastUpdatedAt", () => {
  it("uses the price snapshot time, not a later unchanged check", () => {
    expect(
      lastUpdatedAt({
        prices,
        meta: { ...meta, checkedAt: "2026-09-15T12:17:00.000Z" },
      }),
    ).toBe(prices.generatedAt);
  });

  it("falls back to meta when a price file is missing", () => {
    expect(lastUpdatedAt({ prices, meta })).toBe(prices.generatedAt);
    expect(lastUpdatedAt({ prices: null, meta })).toBe(meta.generatedAt);
    expect(lastUpdatedAt({ prices: null, meta: null })).toBeUndefined();
  });
});

describe("pricesObservedAt", () => {
  it("is omitted when the pipeline has not recorded a source snapshot", () => {
    expect(pricesObservedAt({ prices, meta })).toBeUndefined();
  });

  it("returns the LEA snapshot when it differs from last updated", () => {
    expect(
      pricesObservedAt({
        prices,
        meta: {
          ...meta,
          observedAt: "2026-09-16T10:00:00+03:00",
          checkedAt: "2026-09-17T06:18:18.431Z",
        },
      }),
    ).toBe("2026-09-16T10:00:00+03:00");
  });

  it("hides a duplicate when last updated landed on the same minute as the snapshot", () => {
    expect(
      pricesObservedAt({
        prices: { ...prices, generatedAt: "2026-09-16T07:00:20.000Z" },
        meta: {
          ...meta,
          generatedAt: "2026-09-16T07:00:20.000Z",
          observedAt: "2026-09-16T10:00:00+03:00",
          checkedAt: "2026-09-16T12:00:00.000Z",
        },
      }),
    ).toBeUndefined();
  });
});

describe("sourceLabels", () => {
  it("merges both LEA feeds and keeps ranked order for other sources", () => {
    expect(sourceLabels({ ...meta, sources: ["lea-live", "lea", "circle-k", "report"] })).toEqual([
      "lea",
      "circle-k",
      "report",
    ]);
    expect(sourceLabels({ ...meta, sources: ["circle-k", "lea"] })).toEqual(["circle-k", "lea"]);
  });

  it("falls back to LEA when the sources are empty or unknown", () => {
    expect(sourceLabels({ ...meta, sources: [] })).toEqual(["lea"]);
    expect(sourceLabels({ ...meta, sources: ["mystery"] })).toEqual(["lea"]);
    expect(sourceLabels(null)).toEqual(["lea"]);
  });
});
