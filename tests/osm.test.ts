const { sleep } = vi.hoisted(() => ({ sleep: vi.fn(async () => {}) }));

vi.mock("../scripts/geocode.ts", () => ({ sleep }));

import {
  assertHealthyOsmCount,
  brandName,
  chargerKwBySocket,
  chargerMaxKw,
  chargerSockets,
  chooseOsmStations,
  displayFallback,
  fetchOsmChargers,
  fetchOsmStations,
  MIN_OSM_CHARGERS,
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

  it("reads each socket kind's power apart from the station total", () => {
    expect(
      chargerKwBySocket({
        "socket:type2:output": "22 kW",
        "socket:type2_combo:output": "150 kW;50 kW",
        "charging_station:output": "172 kW",
        "socket:chademo:output": "fast",
      }),
    ).toEqual({ type2: 22, type2_combo: 150 });
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

  it("ignores a zero output", () => {
    expect(chargerMaxKw({ "socket:type2:output": "0 kW" })).toBeUndefined();
  });

  it("reads megawatts", () => {
    expect(chargerMaxKw({ "charging_station:output": "1.5 MW" })).toBe(1500);
  });

  it("reads a bare number as kilowatts", () => {
    expect(chargerMaxKw({ "socket:type2:output": "15" })).toBe(15);
  });
});

describe("brand names", () => {
  it("uses the fallback for an independent brand", () => {
    expect(brandName("independent", "Įkrovimo stotelė")).toBe("Įkrovimo stotelė");
  });

  it("uses the display name for a known brand", () => {
    expect(brandName("circle-k", "Įkrovimo stotelė")).toBe("Circle K");
  });

  it("names an independent fuel station Degalinė", () => {
    expect(displayFallback("independent")).toBe("Degalinė");
  });

  it("keeps a known brand id when the tags have no name", () => {
    expect(displayFallback("circle-k")).toBe("circle-k");
  });
});

describe("chooseOsmStations fallbacks", () => {
  it("throws when nothing was fetched and nothing is cached", () => {
    expect(() => chooseOsmStations([], undefined)).toThrow(/No OSM stations available/);
  });

  it("throws a failure that is not an Error", () => {
    expect(() => chooseOsmStations([], undefined, "overpass down")).toThrow(/overpass down/);
  });
});

function fuelElements(count: number) {
  return {
    elements: Array.from({ length: count }, (_, i) => ({
      type: "node" as const,
      id: i + 1,
      lat: 54.7,
      lon: 25.3,
      tags: { name: "Circle K", brand: "Circle K" },
    })),
  };
}

function chargerElements(count: number) {
  return {
    elements: Array.from({ length: count }, (_, i) => ({
      type: "node" as const,
      id: i + 1,
      lat: 54.7,
      lon: 25.3,
      tags: { amenity: "charging_station", network: "Ignitis ON" },
    })),
  };
}

describe("fetchOsmStations", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    sleep.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns a healthy Overpass answer", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => fuelElements(MIN_OSM_STATIONS),
    });
    const stations = await fetchOsmStations();
    expect(stations).toHaveLength(MIN_OSM_STATIONS);
  });

  it("stops on an HTTP error that should not be retried", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 504, json: async () => ({}) });
    await expect(fetchOsmStations()).rejects.toThrow(/HTTP 504/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and then accepts the answer", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => fuelElements(MIN_OSM_STATIONS),
      });
    const stations = await fetchOsmStations();
    expect(stations).toHaveLength(MIN_OSM_STATIONS);
  });

  it("retries a timeout and then accepts the answer", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValueOnce(timeout).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => fuelElements(MIN_OSM_STATIONS),
    });
    const stations = await fetchOsmStations();
    expect(stations).toHaveLength(MIN_OSM_STATIONS);
  });

  it("retries an abort and then accepts the answer", async () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    fetchMock.mockRejectedValueOnce(aborted).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => fuelElements(MIN_OSM_STATIONS),
    });
    const stations = await fetchOsmStations();
    expect(stations).toHaveLength(MIN_OSM_STATIONS);
  });

  it("gives up after the last retry of a timeout", async () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);
    await expect(fetchOsmStations()).rejects.toThrow(/timed out/);
  });

  it("wraps a thrown string", async () => {
    fetchMock.mockRejectedValue("boom");
    await expect(fetchOsmStations()).rejects.toThrow("boom");
  });

  it("retries a 429 that was not thrown as an Error", async () => {
    fetchMock.mockRejectedValue("HTTP 429");
    await expect(fetchOsmStations()).rejects.toThrow(/HTTP 429/);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe("parseOverpassResponse names", () => {
  it("reads a way center and each name fallback", () => {
    const stations = parseOverpassResponse({
      elements: [
        {
          type: "way",
          id: 1,
          center: { lat: 54.7, lon: 25.3 },
          tags: { brand: "Circle K" },
        },
        { type: "node", id: 2, lat: 54.7, lon: 25.3, tags: { operator: "Viada" } },
        { type: "node", id: 3, lat: 54.7, lon: 25.3 },
        { type: "node", id: 4, lon: 25.3, tags: { name: "No lat" } },
        { type: "node", id: 5, lat: 54.7, tags: { name: "No lon" } },
      ],
    });
    expect(stations.map((s) => s.name)).toEqual(["Circle K", "Viada", "Degalinė"]);
  });

  it("rejects a payload that is not an object", () => {
    expect(() => parseOverpassResponse(null)).toThrow(/Invalid Overpass JSON/);
  });

  it("rejects a payload that is a number", () => {
    expect(() => parseOverpassResponse(1)).toThrow(/Invalid Overpass JSON/);
  });
});

describe("parseOverpassChargers branches", () => {
  it("keeps a public charger and skips closed or unlocated ones", () => {
    const chargers = parseOverpassChargers({
      elements: [
        {
          type: "way",
          id: 1,
          center: { lat: 54.69, lon: 25.28 },
          tags: { name: "Named", operator: "Circle K" },
        },
        { type: "node", id: 2, lat: 54.69, lon: 25.28, tags: { operator: "Viada" } },
        { type: "node", id: 3, lat: 54.69, lon: 25.28, tags: { brand: "Ignitis ON" } },
        { type: "node", id: 4, lat: 54.69, lon: 25.28 },
        { type: "node", id: 5, lat: 54.69, lon: 25.28, tags: { disused: "yes", name: "Old" } },
        {
          type: "node",
          id: 6,
          lat: 54.69,
          lon: 25.28,
          tags: { operational_status: "closed", name: "Shut" },
        },
        { type: "node", id: 7, tags: { name: "Nowhere" } },
      ],
    });
    expect(chargers.map((c) => c.id)).toEqual([
      "ev:way:1",
      "ev:node:2",
      "ev:node:3",
      "ev:node:4",
    ]);
    expect(chargers[0].name).toBe("Named");
    expect(chargers[1].name).toBe("Viada");
    expect(chargers[2].ev?.network).toBe("Ignitis ON");
    expect(chargers[3].name).toBe("Įkrovimo stotelė");
    expect(chargers[3].ev).toEqual({ sockets: [] });
  });

  it("rejects an answer with no chargers in Lithuania", () => {
    expect(() =>
      parseOverpassChargers({
        elements: [{ type: "node", id: 1, lat: 52.2, lon: 21.0, tags: { name: "Warsaw" } }],
      }),
    ).toThrow(/no chargers in Lithuania/i);
  });
});

describe("fetchOsmChargers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a healthy charger answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => chargerElements(MIN_OSM_CHARGERS),
      })),
    );
    const chargers = await fetchOsmChargers();
    expect(chargers).toHaveLength(MIN_OSM_CHARGERS);
  });
});
