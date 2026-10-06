import { describe, expect, it } from "vitest";
import {
  fetchSpot,
  mergeSpot,
  parseEleringPrices,
  spotSeries,
} from "../scripts/adapters/nordpool.ts";
import { SPOT_SERIES } from "../src/types.ts";

const t = (iso: string): number => Date.parse(iso) / 1000;

describe("parseEleringPrices", () => {
  it("averages 15-minute slots into hours and converts €/MWh to €/kWh", () => {
    const points = parseEleringPrices({
      success: true,
      data: {
        ee: [{ timestamp: t("2026-10-06T09:00:00Z"), price: 999 }],
        lt: [
          { timestamp: t("2026-10-06T09:00:00Z"), price: 100 },
          { timestamp: t("2026-10-06T09:15:00Z"), price: 120 },
          { timestamp: t("2026-10-06T09:30:00Z"), price: 80 },
          { timestamp: t("2026-10-06T09:45:00Z"), price: 100 },
          { timestamp: t("2026-10-06T10:00:00Z"), price: -20 },
        ],
      },
    });
    expect(points).toEqual([
      { at: "2026-10-06T09:00:00.000Z", price: 0.1 },
      { at: "2026-10-06T10:00:00.000Z", price: -0.02 },
    ]);
  });

  it("rejects a payload without the LT area", () => {
    expect(() => parseEleringPrices({ data: { ee: [] } })).toThrow(/no lt prices/);
  });
});

describe("fetchSpot", () => {
  it("throws on HTTP errors so the pipeline keeps its cache", async () => {
    const fail = (async () => new Response("", { status: 503 })) as typeof fetch;
    await expect(fetchSpot(new Date("2026-10-06T12:00:00Z"), 7, fail)).rejects.toThrow(/503/);
  });
});

describe("mergeSpot", () => {
  it("lets fresh hours win and drops hours older than the history window", () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const merged = mergeSpot(
      [
        { at: "2026-10-01T00:00:00.000Z", price: 0.5 },
        { at: "2026-10-09T10:00:00.000Z", price: 0.1 },
      ],
      [
        { at: "2026-10-09T10:00:00.000Z", price: 0.2 },
        { at: "2026-10-11T03:00:00.000Z", price: 0.05 },
      ],
      now,
      7,
    );
    expect(merged).toEqual([
      { at: "2026-10-09T10:00:00.000Z", price: 0.2 },
      { at: "2026-10-11T03:00:00.000Z", price: 0.05 },
    ]);
  });
});

describe("spotSeries", () => {
  it("labels each hour with its Vilnius date and hour, including the DST change", () => {
    const series = spotSeries([
      { at: "2026-10-24T21:00:00.000Z", price: 0.1 },
      { at: "2026-10-25T00:00:00.000Z", price: 0.2 },
      { at: "2026-10-25T01:00:00.000Z", price: 0.3 },
    ]);
    expect(series).toEqual({
      dates: ["2026-10-25", "2026-10-25", "2026-10-25"],
      hours: [0, 3, 3],
      brands: { [SPOT_SERIES]: [0.1, 0.2, 0.3] },
    });
    expect(spotSeries([])).toBeUndefined();
  });
});
