import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOverrides, matchByAddress, matchObservations } from "../scripts/match.ts";
import type { Observation, Station } from "../src/types.ts";

const station = (id: string, brand: string, city: string, address: string): Station => ({
  id,
  name: brand,
  brand,
  lat: 54.6,
  lon: 25.2,
  city,
  address,
  fuels: ["95", "D"],
  sourceIds: {},
});

const observation = (brand: string, city: string, address: string): Observation => ({
  sourceStationId: `lea:${city}-${address}`,
  brand,
  name: brand,
  city,
  address,
  fuel: "95",
  price: 1.8,
  observedAt: "2026-09-15T07:00:00+03:00",
});

describe("matchByAddress", () => {
  const stations = [
    station("osm:node:1", "circle-k", "Vilnius", "Oslo g. 12"),
    station("osm:node:2", "viada", "Vilnius", "Oslo g. 14"),
    station("osm:node:3", "circle-k", "Kaunas", "Savanorių pr. 100"),
  ];

  it("picks the same-brand station with the closest address, on every call", () => {
    for (let i = 0; i < 3; i++) {
      expect(matchByAddress(stations, observation("Circle K", "Vilnius", "Oslo g. 12"))?.id).toBe(
        "osm:node:1",
      );
      expect(matchByAddress(stations, observation("Viada", "Vilnius", "Oslo g. 14"))?.id).toBe(
        "osm:node:2",
      );
    }
  });

  it("returns nothing when no address is similar enough", () => {
    expect(matchByAddress(stations, observation("Circle K", "Klaipėda", "Taikos pr. 1"))).toBe(
      undefined,
    );
  });
});

describe("matchObservations", () => {
  it("binds osm: source ids directly and keeps the adapter source", () => {
    const stations = [
      station("osm:way:138809868", "circle-k", "Kaunas", "Karaliaus Mindaugo pr. 34A"),
    ];
    const obs: Observation = {
      sourceStationId: "osm:way:138809868",
      brand: "circle-k",
      fuel: "D",
      price: 2.254,
      observedAt: "2026-09-17T09:00:00+03:00",
      source: "report",
    };
    const result = matchObservations(stations, [obs], []);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      sourceStationId: "osm:way:138809868",
      source: "report",
      price: 2.254,
    });
    expect(result.unmatched).toEqual([]);
  });

  it("follows an override to an OSM station and renames it", () => {
    const stations = [station("osm:node:1", "circle-k", "Vilnius", "Gedimino pr. 1")];
    const obs: Observation = {
      sourceStationId: "lea:abc",
      brand: "viada",
      fuel: "98",
      price: 1.9,
      observedAt: "2026-09-17T09:00:00+03:00",
    };
    const result = matchObservations(stations, [obs], [
      { sourceStationId: "lea:abc", osmId: "osm:node:1", brand: "neste" },
    ]);
    expect(result.observations[0].sourceStationId).toBe("osm:node:1");
    expect(stations[0].brand).toBe("neste");
    expect(stations[0].fuels).toContain("98");
    expect(stations[0].sourceIds.lea).toBe("lea:abc");
  });

  it("binds the nearest same-brand station and ignores a farther one", () => {
    const close = station("osm:node:1", "circle-k", "Vilnius", "Gedimino pr. 1");
    close.lat = 54.6872;
    close.lon = 25.2797;
    const far = station("osm:node:2", "circle-k", "Vilnius", "Gedimino pr. 9");
    far.lat = 54.6892;
    far.lon = 25.2797;
    const obs: Observation = {
      sourceStationId: "lea:near",
      brand: "Circle K",
      fuel: "95",
      price: 1.8,
      observedAt: "2026-09-17T09:00:00+03:00",
      lat: 54.6872,
      lon: 25.2797,
    };
    const result = matchObservations([close, far], [obs], []);
    expect(result.observations[0].sourceStationId).toBe("osm:node:1");
    expect(result.extraStations).toEqual([]);
  });

  it("does not bind a different brand", () => {
    const other = station("osm:node:2", "viada", "Vilnius", "Gedimino pr. 1");
    other.lat = 54.6872;
    other.lon = 25.2797;
    const obs: Observation = {
      sourceStationId: "manual",
      brand: "Circle K",
      name: "Circle K",
      fuel: "95",
      price: 1.8,
      observedAt: "2026-09-17T09:00:00+03:00",
      lat: 54.6872,
      lon: 25.2797,
    };
    const result = matchObservations([other], [obs], []);
    expect(result.extraStations[0].id).toBe("src:manual");
    expect(result.extraStations[0].sourceIds.src).toBe("manual");
  });

  it("binds an independent observation to the nearest station", () => {
    const any = station("osm:node:3", "viada", "Vilnius", "Gedimino pr. 1");
    any.lat = 54.6872;
    any.lon = 25.2797;
    const obs: Observation = {
      sourceStationId: "lea:free",
      brand: "unknown shop",
      fuel: "95",
      price: 1.8,
      observedAt: "2026-09-17T09:00:00+03:00",
      lat: 54.6872,
      lon: 25.2797,
    };
    const result = matchObservations([any], [obs], []);
    expect(result.observations[0].sourceStationId).toBe("osm:node:3");
  });

  it("leaves a row unmatched when it has no coordinates", () => {
    const obs: Observation = {
      sourceStationId: "lea:lost",
      brand: "Circle K",
      fuel: "95",
      price: 1.8,
      observedAt: "2026-09-17T09:00:00+03:00",
    };
    const result = matchObservations([], [obs], []);
    expect(result.unmatched).toEqual([obs]);
    expect(result.extraStations).toEqual([]);
  });

  it("creates a station from an override coordinate", () => {
    const obs: Observation = {
      sourceStationId: "lea:placed",
      brand: "Circle K",
      name: "Circle K Savanoriai",
      fuel: "95",
      price: 1.8,
      observedAt: "2026-09-17T09:00:00+03:00",
    };
    const result = matchObservations([], [obs], [
      { sourceStationId: "lea:placed", lat: 54.9, lon: 23.9, name: "Override", brand: "neste" },
    ]);
    expect(result.extraStations[0]).toMatchObject({
      id: "lea:placed",
      name: "Override",
      brand: "neste",
      lat: 54.9,
      lon: 23.9,
    });
  });

  it("uses the sample name when the override does not", () => {
    const obs: Observation = {
      sourceStationId: "lea:named",
      brand: "Circle K",
      name: "Sample name",
      fuel: "95",
      price: 1.8,
      observedAt: "2026-09-17T09:00:00+03:00",
      lat: 54.9,
      lon: 23.9,
    };
    const result = matchObservations([], [obs], []);
    expect(result.extraStations[0].name).toBe("Sample name");
    expect(result.extraStations[0].brand).toBe("circle-k");
  });

  it("uses the sample coordinate when the override has none", () => {
    const obs: Observation = {
      sourceStationId: "lea:mix",
      brand: "Circle K",
      name: "Mixed",
      fuel: "95",
      price: 1.8,
      observedAt: "2026-09-17T09:00:00+03:00",
      lat: 54.9,
      lon: 23.9,
    };
    const result = matchObservations([], [obs], [{ sourceStationId: "lea:mix" }]);
    expect(result.extraStations[0]).toMatchObject({ lat: 54.9, lon: 23.9, name: "Mixed" });
  });

  it("uses the sample brand when neither side has a name", () => {
    const obs: Observation = {
      sourceStationId: "lea:branded",
      brand: "Circle K",
      fuel: "95",
      price: 1.8,
      observedAt: "2026-09-17T09:00:00+03:00",
      lat: 54.9,
      lon: 23.9,
    };
    const result = matchObservations([], [obs], []);
    expect(result.extraStations[0].name).toBe("Circle K");
  });
});

describe("loadOverrides", () => {
  it("returns nothing when the file is missing", () => {
    expect(loadOverrides(join(tmpdir(), "missing-overrides.json"))).toEqual([]);
  });

  it("reads the override file", () => {
    const dir = mkdtempSync(join(tmpdir(), "overrides-"));
    const path = join(dir, "stations.json");
    writeFileSync(path, JSON.stringify([{ sourceStationId: "lea:1", osmId: "osm:node:1" }]));
    expect(loadOverrides(path)).toEqual([{ sourceStationId: "lea:1", osmId: "osm:node:1" }]);
  });
});

describe("matchByAddress tokens", () => {
  it("returns nothing when the address has no tokens", () => {
    const bare: Station = {
      id: "osm:node:9",
      name: "X",
      brand: "circle-k",
      lat: 54.6,
      lon: 25.2,
      fuels: ["95"],
      sourceIds: {},
    };
    const obs: Observation = {
      sourceStationId: "lea:empty",
      brand: "Circle K",
      fuel: "95",
      price: 1.8,
      observedAt: "2026-09-17T09:00:00+03:00",
    };
    expect(matchByAddress([bare], obs)).toBeUndefined();
  });
});
