import { describe, expect, it } from "vitest";
import { combinePriceObservations } from "../scripts/merge-sources.ts";
import type { Observation } from "../src/types.ts";

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

describe("combinePriceObservations", () => {
  it("uses the latest Excel day when there is no live overlay", () => {
    const byDate = new Map([
      ["2026-09-15", [excel("2026-09-15", 2.284)]],
      ["2026-09-16", [excel("2026-09-16", 2.284)]],
    ]);
    expect(
      combinePriceObservations({
        byDate,
        live: [],
        reports: [],
        requested: "2026-09-17",
        excelFetched: true,
      }),
    ).toMatchObject({
      date: "2026-09-16",
      sources: ["lea"],
    });
  });

  it("writes today using yesterday's Excel as floor plus live rows", () => {
    const byDate = new Map([["2026-09-16", [excel("2026-09-16", 2.284)]]]);
    const combined = combinePriceObservations({
      byDate,
      live: [live],
      reports: [],
      requested: "2026-09-17",
      excelFetched: true,
    });
    expect(combined.date).toBe("2026-09-17");
    expect(combined.sources).toEqual(["lea", "lea-live"]);
    expect(combined.observations.map((o) => o.source)).toEqual(["lea", "lea-live"]);
    expect(combined.observations[0].price).toBe(2.284);
    expect(combined.observations[1].price).toBe(2.254);
  });

  it("prefers today's Excel when both the workbook and live cover today", () => {
    const byDate = new Map([["2026-09-17", [excel("2026-09-17", 2.284)]]]);
    const combined = combinePriceObservations({
      byDate,
      live: [live],
      reports: [],
      requested: "2026-09-17",
      excelFetched: true,
    });
    expect(combined.observations[0].observedAt).toBe("2026-09-17T10:00:00+03:00");
  });
});
