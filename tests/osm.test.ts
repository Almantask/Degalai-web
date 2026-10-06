import {
  assertHealthyOsmCount,
  chargerMaxKw,
  chargerSockets,
  chooseOsmStations,
  MIN_OSM_STATIONS,
  parseChargeTag,
  parseOverpassChargers,
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

describe("parseOverpassChargers", () => {
  it("maps public car chargers with network, sockets and power", () => {
    const chargers = parseOverpassChargers({
      elements: [
        {
          type: "node",
          id: 7,
          lat: 54.69,
          lon: 25.27,
          tags: {
            amenity: "charging_station",
            network: "Ignitis ON",
            "socket:type2": "2",
            "socket:type2:output": "22 kW",
            "socket:type2_combo": "1",
            "socket:type2_combo:output": "150 kW",
            charge: "0,39 EUR/kWh",
            "addr:street": "Gedimino pr.",
            "addr:housenumber": "1",
            "addr:city": "Vilnius",
          },
        },
        { type: "node", id: 8, lat: 54.69, lon: 25.27, tags: { access: "private" } },
        { type: "node", id: 9, lat: 54.69, lon: 25.27, tags: { motorcar: "no", bicycle: "yes" } },
      ],
    });
    expect(chargers).toHaveLength(1);
    expect(chargers[0]).toMatchObject({
      id: "ev:node:7",
      name: "Ignitis ON",
      brand: "ignitis-on",
      fuels: ["EV"],
      address: "Gedimino pr. 1, Vilnius",
      ev: { sockets: ["type2", "type2_combo"], maxKw: 150, network: "Ignitis ON", chargeTag: 0.39 },
    });
  });
});

describe("charger tags", () => {
  it("reads kW from W, kW and multi-value outputs", () => {
    expect(chargerMaxKw({ "socket:type2:output": "11000 W" })).toBe(11);
    expect(chargerMaxKw({ "socket:chademo:output": "50kW;25 kW" })).toBe(50);
    expect(chargerMaxKw({ "socket:type2:output": "fast" })).toBeUndefined();
  });

  it("skips sockets tagged as absent", () => {
    expect(chargerSockets({ "socket:type2": "no", "socket:chademo": "1" })).toEqual(["chademo"]);
  });

  it("parses €/kWh from charge tags and ignores per-minute or flat fees", () => {
    expect(parseChargeTag("0.29 EUR/kWh")).toBe(0.29);
    expect(parseChargeTag("EUR 0,35/kWh; 0.05 EUR/min")).toBe(0.35);
    expect(parseChargeTag("0.10 EUR/min")).toBeUndefined();
    expect(parseChargeTag(undefined)).toBeUndefined();
  });
});
