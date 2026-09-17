import { describe, expect, it } from "vitest";
import { matchByAddress, matchObservations } from "../scripts/match.ts";
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
});
