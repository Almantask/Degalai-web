import {
  assertHealthyOsmCount,
  chooseOsmStations,
  MIN_OSM_STATIONS,
  parseOverpassResponse,
} from "../scripts/osm.ts";
import type { Station } from "../src/types.ts";

function station(id: string, lat = 54.7, lon = 25.3): Station {
  return {
    id,
    name: id,
    brand: "circle-k",
    lat,
    lon,
    fuels: ["95", "D"],
    sourceIds: { osm: id.replace("osm:", "").replace(":", "/") },
  };
}

describe("parseOverpassResponse", () => {
  it("maps nodes with coordinates and tags", () => {
    const stations = parseOverpassResponse({
      elements: [
        {
          type: "node",
          id: 42,
          lat: 54.687,
          lon: 25.28,
          tags: { amenity: "fuel", name: "Circle K", brand: "Circle K", "addr:city": "Vilnius" },
        },
      ],
    });
    expect(stations).toHaveLength(1);
    expect(stations[0]).toMatchObject({
      id: "osm:node:42",
      name: "Circle K",
      brand: "circle-k",
      city: "Vilnius",
    });
  });

  it("rejects timeout remarks even when some elements are present", () => {
    expect(() =>
      parseOverpassResponse({
        remark: "runtime error: Query timed out in 'query' after 120 seconds.",
        elements: [{ type: "node", id: 1, lat: 54.7, lon: 25.3 }],
      }),
    ).toThrow(/remark/i);
  });

  it("rejects empty or missing elements", () => {
    expect(() => parseOverpassResponse({ elements: [] })).toThrow(/no elements/i);
    expect(() => parseOverpassResponse({})).toThrow(/no elements/i);
  });

  it("drops stations outside Lithuania", () => {
    expect(() =>
      parseOverpassResponse({
        elements: [{ type: "node", id: 1, lat: 52.2, lon: 21.0, tags: { name: "Warsaw" } }],
      }),
    ).toThrow(/no stations in Lithuania/i);
  });
});

describe("chooseOsmStations", () => {
  const existing = Array.from({ length: 250 }, (_, i) => station(`osm:node:${i}`));

  it("keeps the last good list when Overpass returns too few stations", () => {
    const chosen = chooseOsmStations(existing, [station("osm:node:1")]);
    expect(chosen).toBe(existing);
  });

  it("uses a healthy fresh fetch", () => {
    const fetched = Array.from({ length: MIN_OSM_STATIONS }, (_, i) => station(`osm:way:${i}`));
    expect(chooseOsmStations(existing, fetched)).toBe(fetched);
  });

  it("rethrows when there is nothing to fall back to", () => {
    expect(() => chooseOsmStations([], undefined, new Error("Overpass HTTP 504"))).toThrow(
      /Overpass HTTP 504/,
    );
  });
});

describe("assertHealthyOsmCount", () => {
  it("rejects short lists that would wipe the station file", () => {
    expect(() => assertHealthyOsmCount([station("osm:node:1")])).toThrow(/too few stations/i);
  });
});
