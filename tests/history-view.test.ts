import { describe, expect, it } from "vitest";
import { brandColor, hourTickLabel, providerSeries } from "../src/history-view.ts";
import type { HistoryFile } from "../src/types.ts";

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

describe("brandColor", () => {
  it("uses a stable color for known brands", () => {
    expect(brandColor("neste", 0)).toBe("#1d4ed8");
    expect(brandColor("unknown-brand", 0)).not.toBe(brandColor("unknown-brand", 1));
  });
});
