import { describe, expect, it } from "vitest";
import { lastCheckedAt } from "../src/data.ts";
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

describe("lastCheckedAt", () => {
  it("prefers the pipeline check time over the last price snapshot", () => {
    expect(
      lastCheckedAt({
        prices,
        meta: { ...meta, checkedAt: "2026-09-15T12:17:00.000Z" },
      }),
    ).toBe("2026-09-15T12:17:00.000Z");
  });

  it("falls back to snapshot times when a check has not been recorded", () => {
    expect(lastCheckedAt({ prices, meta })).toBe(prices.generatedAt);
    expect(lastCheckedAt({ prices: null, meta })).toBe(meta.generatedAt);
    expect(lastCheckedAt({ prices: null, meta: null })).toBeUndefined();
  });
});
