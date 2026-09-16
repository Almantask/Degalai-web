import { describe, expect, it } from "vitest";
import { includePublishedDataFile, slimPrices, slimStations } from "../scripts/publish-data.ts";

describe("includePublishedDataFile", () => {
  it("ships only the latest daily snapshot", () => {
    expect(includePublishedDataFile("", "2026-09-14")).toBe(true);
    expect(includePublishedDataFile("prices", "2026-09-14")).toBe(true);
    expect(includePublishedDataFile("prices/2026-09-14.json", "2026-09-14")).toBe(true);
    expect(includePublishedDataFile("prices/2026-09-07.json", "2026-09-14")).toBe(false);
    expect(includePublishedDataFile("prices/.gitkeep", "2026-09-14")).toBe(false);
  });

  it("keeps compact history and stations, skips caches", () => {
    expect(includePublishedDataFile("history.json", "2026-09-14")).toBe(true);
    expect(includePublishedDataFile("stations.json", "2026-09-14")).toBe(true);
    expect(includePublishedDataFile("cache/geocode.json", "2026-09-14")).toBe(false);
    expect(includePublishedDataFile("downloads/lea.xlsx", "2026-09-14")).toBe(false);
  });
});

describe("slimStations", () => {
  it("drops source ids and keeps what the map and list read", () => {
    const [slim] = slimStations([
      {
        id: "osm:node:1",
        name: "Circle K",
        brand: "circle-k",
        lat: 54.6,
        lon: 25.2,
        address: "Oslo g. 12",
        city: "Vilnius",
        fuels: ["95", "D"],
        sourceIds: { osm: "node/1", lea: "lea:x" },
      },
    ]);
    expect(slim).toEqual({
      id: "osm:node:1",
      name: "Circle K",
      brand: "circle-k",
      lat: 54.6,
      lon: 25.2,
      address: "Oslo g. 12",
      city: "Vilnius",
      fuels: ["95", "D"],
    });
  });
});

describe("slimPrices", () => {
  it("keeps price and flags, drops source and observation time", () => {
    const observedAt = "2026-09-15T07:00:00+03:00";
    expect(
      slimPrices({
        date: "2026-09-15",
        generatedAt: "2026-09-15T13:34:41.125Z",
        prices: {
          a: {
            "95": { price: 1.879, source: "lea", observedAt },
            D: { price: 2.179, source: "lea", observedAt, stale: true, suspicious: true },
          },
          b: { LPG: { price: 0.899, source: "lea", observedAt, stale: false } },
        },
      }),
    ).toEqual({
      date: "2026-09-15",
      generatedAt: "2026-09-15T13:34:41.125Z",
      prices: {
        a: { "95": { price: 1.879 }, D: { price: 2.179, stale: true, suspicious: true } },
        b: { LPG: { price: 0.899 } },
      },
    });
  });
});
