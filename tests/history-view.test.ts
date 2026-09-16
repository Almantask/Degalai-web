import { describe, expect, it } from "vitest";
import {
  HISTORY_HOUR_MIN_PX,
  HISTORY_X_PAD_PX,
  HISTORY_Y_AXIS_PX,
  brandColor,
  historyChartWidth,
  hourTickLabel,
  providerSeries,
} from "../src/history-view.ts";
import {
  allHistoryBrandsOn,
  chartBrands,
  toggleAllHistoryBrands,
  toggleHistoryBrand,
} from "../src/history-series.ts";
import type { HistoryFile, HistoryHourSeries } from "../src/types.ts";

const file: HistoryFile = {
  generatedAt: "2026-09-14T12:00:00Z",
  keepDays: 7,
  samples: [],
  byFuel: {
    D: {
      hours: [...Array(24).keys()],
      brands: {
        "circle-k": Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.55 : null)),
        viada: Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.52 : null)),
      },
    },
  },
};

describe("providerSeries", () => {
  it("lists brands alphabetically for the selected fuel", () => {
    const { brands } = providerSeries(file, "D");
    expect(brands.map((b) => b.id)).toEqual(["circle-k", "viada"]);
    expect(brands[1].values[8]).toBe(1.52);
  });

  it("returns no brands when the fuel is missing", () => {
    expect(providerSeries(file, "LPG").brands).toEqual([]);
    expect(providerSeries(null, "D").brands).toEqual([]);
  });
});

describe("hourTickLabel", () => {
  it("pads hours", () => {
    expect(hourTickLabel(0)).toBe("00:00");
    expect(hourTickLabel(9)).toBe("09:00");
    expect(hourTickLabel(15)).toBe("15:00");
  });
});

describe("historyChartWidth", () => {
  it("is wider than a phone viewport so 24 hours can scroll", () => {
    const min = 24 * HISTORY_HOUR_MIN_PX + HISTORY_Y_AXIS_PX + HISTORY_X_PAD_PX;
    expect(historyChartWidth(320, 24)).toBe(min);
    expect(min).toBeGreaterThan(320);
  });

  it("uses the viewport when it already fits every hour", () => {
    expect(historyChartWidth(1600, 24)).toBe(1600);
  });
});

describe("brandColor", () => {
  it("uses a stable color for known brands", () => {
    expect(brandColor("neste", 0)).toBe("#1d4ed8");
    expect(brandColor("unknown-brand", 0)).not.toBe(brandColor("unknown-brand", 1));
  });
});

describe("chartBrands", () => {
  it("drops brands that have no prices", () => {
    const series: HistoryHourSeries = {
      hours: [...Array(24).keys()],
      brands: {
        viada: Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.52 : null)),
        neste: Array.from({ length: 24 }, () => null),
      },
    };
    expect(chartBrands(series).map((b) => b.id)).toEqual(["viada"]);
    expect(chartBrands(undefined)).toEqual([]);
  });
});

describe("history series visibility", () => {
  const ids = ["circle-k", "viada", "neste"];

  it("starts with every provider on", () => {
    expect(allHistoryBrandsOn(new Set(), ids)).toBe(true);
  });

  it("hides only the clicked provider and leaves the others on", () => {
    const hidden = toggleHistoryBrand(new Set(), "viada");
    expect([...hidden]).toEqual(["viada"]);
    expect(allHistoryBrandsOn(hidden, ids)).toBe(false);
    const restored = toggleHistoryBrand(hidden, "viada");
    expect(restored.size).toBe(0);
  });

  it("toggles all selected providers on, then off", () => {
    const mixed = toggleHistoryBrand(new Set(), "viada");
    const allOn = toggleAllHistoryBrands(mixed, ids);
    expect(allOn.size).toBe(0);
    const allOff = toggleAllHistoryBrands(allOn, ids);
    expect([...allOff].sort()).toEqual([...ids].sort());
  });
});
