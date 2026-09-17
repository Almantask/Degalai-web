import { describe, expect, it } from "vitest";
import {
  combinePriceObservations,
  excelFloorDate,
  summarizeSources,
} from "../scripts/merge-sources.ts";
import type { DailyPrices, Observation } from "../src/types.ts";

const excel = (date: string, price: number): Observation => ({
  sourceStationId: "lea:mindaugo",
  brand: "circle-k",
  fuel: "D",
  price,
  observedAt: `${date}T10:00:00+03:00`,
  source: "lea",
});

const live: Observation = {
  sourceStationId: "lea:mindaugo",
  brand: "circle-k",
  fuel: "D",
  price: 2.254,
  observedAt: "2026-09-17T09:45:16+03:00",
  source: "lea-live",
};

const circleK: Observation = {
  sourceStationId: "circle-k:19-kaunas-pl-žemaičių",
  brand: "circle-k",
  fuel: "98",
  price: 2.043,
  observedAt: "2026-09-17T00:00:00+03:00",
  source: "circle-k",
};

describe("excelFloorDate", () => {
  it("uses the requested day when the workbook has it, else the latest day", () => {
    const byDate = new Map([
      ["2026-09-15", [excel("2026-09-15", 2.284)]],
      ["2026-09-16", [excel("2026-09-16", 2.284)]],
    ]);
    expect(excelFloorDate(byDate, "2026-09-16")).toBe("2026-09-16");
    expect(excelFloorDate(byDate, "2026-09-17")).toBe("2026-09-16");
    expect(excelFloorDate(new Map(), "2026-09-17")).toBeNull();
  });
});

describe("combinePriceObservations", () => {
  it("uses the Excel day when no other source has rows", () => {
    expect(
      combinePriceObservations({
        byProvider: { "lea-live": [], lea: [excel("2026-09-16", 2.284)], "circle-k": [] },
        reports: [],
        requested: "2026-09-17",
        excelDate: "2026-09-16",
      }),
    ).toMatchObject({ date: "2026-09-16", sources: ["lea"] });
  });

  it("writes today with yesterday's Excel rows first, then live and Circle K rows", () => {
    const combined = combinePriceObservations({
      byProvider: {
        "lea-live": [live],
        lea: [excel("2026-09-16", 2.284)],
        "circle-k": [circleK],
      },
      reports: [],
      requested: "2026-09-17",
      excelDate: "2026-09-16",
    });
    expect(combined.date).toBe("2026-09-17");
    expect(combined.sources).toEqual(["lea-live", "lea", "circle-k"]);
    expect(combined.observations.map((o) => o.source)).toEqual(["lea", "lea-live", "circle-k"]);
  });

  it("moves to today for a fresh user report even when every fetch failed", () => {
    const report: Observation = { ...live, source: "report", price: 2.199 };
    const combined = combinePriceObservations({
      byProvider: { "lea-live": [], lea: [], "circle-k": [] },
      reports: [report],
      requested: "2026-09-17",
      excelDate: null,
    });
    expect(combined).toMatchObject({ date: "2026-09-17", sources: ["report"] });
    expect(combined.observations).toEqual([report]);
  });
});

describe("summarizeSources", () => {
  const daily: DailyPrices = {
    date: "2026-09-17",
    generatedAt: "2026-09-17T12:00:00.000Z",
    prices: {
      a: {
        D: { price: 2.2, source: "lea", observedAt: "2026-09-17T10:00:00+03:00" },
        "95": { price: 1.9, source: "report", observedAt: "2026-09-17T11:00:00+03:00" },
      },
      b: {
        D: { price: 2.25, source: "lea-live", observedAt: "2026-09-17T09:00:00+03:00" },
        LPG: { price: 0.8, source: "lea", observedAt: "2026-09-16T10:00:00+03:00", stale: true },
      },
      c: { "98": { price: 2.04, source: "circle-k", observedAt: "2026-09-17T00:00:00+03:00" } },
    },
  };

  it("orders sources by ranking, then reports, and counts stale prices separately", () => {
    expect(summarizeSources(daily, ["lea", "lea-live", "circle-k"])).toEqual([
      { name: "lea", chosen: 1, stale: 1 },
      { name: "lea-live", chosen: 1, stale: 0 },
      { name: "circle-k", chosen: 1, stale: 0 },
      { name: "report", chosen: 1, stale: 0 },
    ]);
  });
});
