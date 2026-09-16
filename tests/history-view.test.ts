import { describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n/index.ts";
import { formatChartDate } from "../src/format.ts";
import {
  HISTORY_HOUR_MIN_PX,
  HISTORY_X_PAD_PX,
  HISTORY_Y_AXIS_PX,
  brandColor,
  historyChartInitialHour,
  historyChartScrollLeft,
  historyChartWheelDelta,
  historyChartWidth,
  historyTickLabel,
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
      dates: Array.from({ length: 24 }, () => "2026-09-14"),
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

describe("historyTickLabel", () => {
  it("pairs time with the calendar day", () => {
    setLocale("en");
    expect(historyTickLabel("2026-09-15", 7)).toBe(`07:00\n${formatChartDate("2026-09-15")}`);
    expect(historyTickLabel(undefined, 9)).toBe("09:00");
  });
});

describe("historyChartWidth", () => {
  it("is wider than a phone viewport so several days can scroll", () => {
    const min = 24 * HISTORY_HOUR_MIN_PX + HISTORY_Y_AXIS_PX + HISTORY_X_PAD_PX;
    expect(historyChartWidth(320, 24)).toBe(min);
    expect(min).toBeGreaterThan(320);
  });

  it("uses the viewport when it already fits every hour", () => {
    expect(historyChartWidth(1600, 24)).toBe(1600);
  });
});

describe("historyChartWheelDelta", () => {
  it("pans from deltaX, or from shift+wheel when only deltaY is set", () => {
    expect(historyChartWheelDelta(40, 12, false)).toBe(40);
    expect(historyChartWheelDelta(0, 40, true)).toBe(40);
    expect(historyChartWheelDelta(0, 40, false)).toBe(0);
  });
});

describe("historyChartInitialHour", () => {
  it("uses the cheapest sample index when given, otherwise the first with prices", () => {
    const hours = [...Array(24).keys()];
    const values = [Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.5 : null))];
    expect(historyChartInitialHour(hours, values, 7)).toBe(7);
    expect(historyChartInitialHour(hours, values)).toBe(8);
    expect(historyChartInitialHour(hours, [Array(24).fill(null)])).toBe(0);
  });
});

describe("historyChartScrollLeft", () => {
  it("clamps to the scrollable range and starts near the requested hour", () => {
    expect(historyChartScrollLeft(1600, 1196, 7)).toBe(0);
    expect(historyChartScrollLeft(320, 1196, 0)).toBe(0);
    expect(historyChartScrollLeft(320, 1196, 7)).toBe(7 * HISTORY_HOUR_MIN_PX);
    expect(historyChartScrollLeft(320, 1196, 23)).toBe(1196 - 320);
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
      dates: Array.from({ length: 24 }, () => "2026-09-14"),
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
