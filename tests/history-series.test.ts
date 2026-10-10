import { describe, expect, it } from "vitest";
import {
  allHistoryBrandsOn,
  brandColor,
  chartBrands,
  isHistoryBrandOn,
  seriesForStat,
  toggleAllHistoryBrands,
  toggleHistoryBrand,
} from "../src/history-series.ts";
import type { HistoryHourSeries } from "../src/types.ts";

const series: HistoryHourSeries = {
  dates: ["2026-09-15"],
  hours: [8],
  brands: { neste: [1.5] },
  stats: {
    min: { neste: [1.2] },
    max: { neste: [1.8] },
  },
};

describe("brandColor", () => {
  it("uses the brand color, or a fallback that wraps", () => {
    expect(brandColor("neste", 0)).toBe("#1d4ed8");
    expect(brandColor("unknown", 0)).toBe("#ea580c");
    expect(brandColor("unknown", 6)).toBe("#ea580c");
  });
});

describe("seriesForStat", () => {
  it("returns the average series, or the stat series when it exists", () => {
    expect(seriesForStat(undefined, "avg")).toBeUndefined();
    expect(seriesForStat(series, "avg")).toBe(series);
    const bare: HistoryHourSeries = {
      dates: series.dates,
      hours: series.hours,
      brands: series.brands,
    };
    expect(seriesForStat(bare, "min")).toBe(bare);
    expect(seriesForStat(series, "median")).toBe(series);
    expect(seriesForStat(series, "min")).toEqual({
      dates: series.dates,
      hours: series.hours,
      brands: series.stats?.min,
    });
  });
});

describe("chartBrands", () => {
  it("drops empty series and sorts the rest by id", () => {
    expect(chartBrands(undefined)).toEqual([]);
    expect(
      chartBrands({
        hours: [1, 2],
        brands: {
          viada: [1, null],
          neste: [null, null],
          orlen: [null, 2],
        },
      }),
    ).toEqual([
      { id: "orlen", values: [null, 2] },
      { id: "viada", values: [1, null] },
    ]);
  });
});

describe("isHistoryBrandOn", () => {
  it("is on unless the id is hidden", () => {
    const hidden = new Set(["viada"]);
    expect(isHistoryBrandOn(hidden, "neste")).toBe(true);
    expect(isHistoryBrandOn(hidden, "viada")).toBe(false);
  });
});

describe("allHistoryBrandsOn", () => {
  it("is true only when none of the ids are hidden", () => {
    expect(allHistoryBrandsOn(new Set(), ["a", "b"])).toBe(true);
    expect(allHistoryBrandsOn(new Set(["b"]), ["a", "b"])).toBe(false);
    expect(allHistoryBrandsOn(new Set(["x"]), [])).toBe(true);
  });
});

describe("toggleHistoryBrand", () => {
  it("hides a visible brand and shows a hidden one", () => {
    expect([...toggleHistoryBrand(new Set(["a"]), "b")]).toEqual(["a", "b"]);
    expect([...toggleHistoryBrand(new Set(["a"]), "a")]).toEqual([]);
  });
});

describe("toggleAllHistoryBrands", () => {
  it("keeps the set when there are no ids, and flips the rest", () => {
    expect([...toggleAllHistoryBrands(new Set(["keep"]), [])]).toEqual(["keep"]);
    expect([...toggleAllHistoryBrands(new Set(), ["a", "b"])].sort()).toEqual(["a", "b"]);
    expect([...toggleAllHistoryBrands(new Set(["a"]), ["a", "b"])]).toEqual([]);
  });
});
