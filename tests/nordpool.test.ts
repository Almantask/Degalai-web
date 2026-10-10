import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fetchSpot,
  loadSpotCache,
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

  it("rejects a payload that is not an object", () => {
    expect(() => parseEleringPrices(null)).toThrow(/Invalid Elering JSON/);
    expect(() => parseEleringPrices("x")).toThrow(/Invalid Elering JSON/);
    expect(() => parseEleringPrices(1)).toThrow(/Invalid Elering JSON/);
  });

  it("skips broken rows and prices outside the feed's range", () => {
    const points = parseEleringPrices({
      data: {
        lt: [
          null,
          "nope",
          { timestamp: "x", price: 10 },
          { timestamp: t("2026-10-06T09:00:00Z"), price: "x" },
          { timestamp: t("2026-10-06T10:00:00Z"), price: -2000 },
          { timestamp: t("2026-10-06T11:00:00Z"), price: 6000 },
          { timestamp: t("2026-10-06T12:00:00Z"), price: 50 },
        ],
      },
    });
    expect(points).toEqual([{ at: "2026-10-06T12:00:00.000Z", price: 0.05 }]);
  });

  it("rejects a feed whose prices are all unusable", () => {
    expect(() =>
      parseEleringPrices({
        data: { lt: [{ timestamp: t("2026-10-06T10:00:00Z"), price: 9000 }] },
      }),
    ).toThrow(/no usable lt prices/);
  });
});

describe("fetchSpot", () => {
  it("throws on HTTP errors so the pipeline keeps its cache", async () => {
    const fail = (async () => new Response("", { status: 503 })) as typeof fetch;
    await expect(fetchSpot(new Date("2026-10-06T12:00:00Z"), 7, fail)).rejects.toThrow(/503/);
  });

  it("returns the parsed LT prices", async () => {
    const ok = (async () =>
      new Response(
        JSON.stringify({
          data: { lt: [{ timestamp: t("2026-10-06T09:00:00Z"), price: 100 }] },
        }),
        { status: 200 },
      )) as typeof fetch;
    await expect(fetchSpot(new Date("2026-10-06T12:00:00Z"), 7, ok)).resolves.toEqual([
      { at: "2026-10-06T09:00:00.000Z", price: 0.1 },
    ]);
  });
});

describe("loadSpotCache", () => {
  it("loads a cache and ignores a missing, broken or shapeless file", () => {
    const dir = mkdtempSync(join(tmpdir(), "spot-"));
    try {
      const path = join(dir, "spot.json");
      expect(loadSpotCache(path)).toBeNull();
      writeFileSync(path, "{");
      expect(loadSpotCache(path)).toBeNull();
      writeFileSync(path, "null");
      expect(loadSpotCache(path)).toBeNull();
      writeFileSync(path, JSON.stringify({ fetchedAt: 1, points: [] }));
      expect(loadSpotCache(path)).toBeNull();
      writeFileSync(path, JSON.stringify({ fetchedAt: "2026-10-06T00:00:00Z", points: "no" }));
      expect(loadSpotCache(path)).toBeNull();
      const cache = {
        fetchedAt: "2026-10-06T00:00:00Z",
        points: [{ at: "2026-10-06T09:00:00.000Z", price: 0.1 }],
      };
      writeFileSync(path, JSON.stringify(cache));
      expect(loadSpotCache(path)).toEqual(cache);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
