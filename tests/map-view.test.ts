import { describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n/index.ts";
import {
  MAP_STYLE_URL,
  ROUTE_MARKER,
  ROUTE_OPTION_COLORS,
  createMap,
  fitRoute,
  flyToStation,
  freeReasonText,
  openListPadding,
  overlayPadding,
  percentile,
  routeStationEmphasis,
  setMapGeolocateAccuracy,
  setRouteData,
  setRouteOptions,
  setStationData,
  socketLabels,
  stationPopupHtml,
  stationsForRouteMap,
  stationsInView,
  type MapHandlers,
} from "../src/map.ts";
import maplibregl from "maplibre-gl";
import { DEFAULT_SETTINGS, LT_CENTER, type DailyPrices, type Station } from "../src/types.ts";
import type { LngLat } from "../src/geo.ts";

interface MockSource {
  data: unknown;
  setData: ReturnType<typeof vi.fn>;
  getClusterExpansionZoom: ReturnType<typeof vi.fn>;
}

interface MockListener {
  event: string;
  layer?: string;
  fn: (ev: {
    features?: Array<{
      properties?: Record<string, unknown>;
      geometry?: { type: string; coordinates?: number[] };
    }>;
    point?: { x: number; y: number };
    lngLat?: { lng: number; lat: number };
  }) => void;
}

interface MockMap {
  options: { container?: HTMLElement; style?: string; center?: [number, number]; zoom?: number };
  listeners: MockListener[];
  sources: Map<string, MockSource>;
  layers: Array<{ id: string }>;
  controls: Array<{ control: { options?: unknown }; position?: string }>;
  removed: unknown[];
  canvas: { style: { cursor: string } };
  container: { dataset: Record<string, string | undefined> };
  easeTo: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
  queryRenderedFeatures: ReturnType<typeof vi.fn>;
  removeControl: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  getSource: (id: string) => MockSource | undefined;
  getCanvas: () => { style: { cursor: string } };
  addSource: (id: string, spec: { data?: unknown }) => void;
}

const maplibre = vi.hoisted(() => ({ maps: [] as MockMap[] }));

vi.mock("maplibre-gl", () => {
  class NavigationControl {
    constructor(public options: unknown) {}
  }
  class GeolocateControl {
    constructor(public options: unknown) {}
  }
  class LngLatBounds {
    extended: [number, number][] = [];
    constructor(sw?: [number, number], ne?: [number, number]) {
      if (sw) this.extended.push(sw);
      if (ne) this.extended.push(ne);
    }
    extend(coord: [number, number]) {
      this.extended.push(coord);
      return this;
    }
  }
  class Map {
    options: MockMap["options"];
    listeners: MockListener[] = [];
    sources = new globalThis.Map<string, MockSource>();
    layers: Array<{ id: string }> = [];
    controls: MockMap["controls"] = [];
    removed: unknown[] = [];
    canvas = { style: { cursor: "" } };
    container = { dataset: {} as Record<string, string | undefined> };
    easeTo = vi.fn();
    fitBounds = vi.fn();
    queryRenderedFeatures = vi.fn(() => [] as unknown[]);
    once = vi.fn((event: string, fn: MockListener["fn"]) => {
      this.listeners.push({ event, fn });
    });
    removeControl = vi.fn((control: unknown) => {
      this.removed.push(control);
      this.controls = this.controls.filter((entry) => entry.control !== control);
    });
    constructor(options: MockMap["options"]) {
      this.options = options;
      maplibre.maps.push(this);
    }
    on(event: string, layerOrFn: string | MockListener["fn"], fn?: MockListener["fn"]) {
      if (typeof layerOrFn === "string") this.listeners.push({ event, layer: layerOrFn, fn: fn! });
      else this.listeners.push({ event, fn: layerOrFn });
    }
    addSource(id: string, spec: { data?: unknown }) {
      const src: MockSource = {
        data: spec.data,
        setData: vi.fn((data: unknown) => {
          src.data = data;
        }),
        getClusterExpansionZoom: vi.fn(async () => 12),
      };
      this.sources.set(id, src);
    }
    addLayer(layer: { id: string }) {
      this.layers.push(layer);
    }
    addControl(control: { options?: unknown }, position?: string) {
      this.controls.push({ control, position });
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    getCanvas() {
      return this.canvas;
    }
    getContainer() {
      return this.container;
    }
  }
  return { default: { Map, NavigationControl, GeolocateControl, LngLatBounds } };
});

function handlers(picking?: () => boolean): MapHandlers & {
  onStationClick: ReturnType<typeof vi.fn>;
  onMapClick: ReturnType<typeof vi.fn>;
  onRouteClick: ReturnType<typeof vi.fn>;
} {
  return {
    onStationClick: vi.fn(),
    onMapClick: vi.fn(),
    onRouteClick: vi.fn(),
    ...(picking ? { isPicking: picking } : {}),
  };
}

function loadedMap(h: MapHandlers, highAccuracy = true): MockMap {
  createMap({} as HTMLElement, h, highAccuracy);
  const map = maplibre.maps.at(-1)!;
  map.listeners.find((l) => l.event === "load" && !l.layer)!.fn({});
  return map;
}

function listen(map: MockMap, event: string, layer?: string): MockListener["fn"] {
  const found = map.listeners.find((l) => l.event === event && l.layer === layer);
  if (!found) throw new Error(`missing ${event} ${layer ?? "(map)"}`);
  return found.fn;
}

function fuelStation(over: Partial<Station> & { id: string }): Station {
  return {
    name: over.id,
    brand: "circle-k",
    lat: 54.7,
    lon: 25.2,
    fuels: ["D", "95"],
    sourceIds: {},
    ...over,
  };
}

function featuresOf(map: MockMap) {
  const data = map.getSource("stations")?.data as {
    features: Array<{ properties: Record<string, unknown> }>;
  };
  return data.features;
}

const line: LngLat[] = [
  { lon: 23.9, lat: 54.9 },
  { lon: 24.1, lat: 55.1 },
];

const sampleStation: Station = {
  id: "osm:1",
  name: "Test station",
  brand: "circle-k",
  lat: 54.687,
  lon: 25.28,
  fuels: ["D"],
  sourceIds: {},
};

describe("overlayPadding", () => {
  it("clears the collapsed header and list grabbers", () => {
    expect(overlayPadding(40, 56)).toEqual({ top: 52, bottom: 68, left: 24, right: 24 });
  });

  it("keeps a minimum edge when chrome is missing", () => {
    expect(overlayPadding(0, 0)).toEqual({ top: 24, bottom: 24, left: 24, right: 24 });
  });
});

describe("openListPadding", () => {
  const box = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  const map = box(0, 0, 1280, 720);

  it("keeps a fit beside a list panel on the right", () => {
    expect(openListPadding(map, box(16, 10, 240, 44), box(904, 16, 360, 688))).toEqual({
      top: 66,
      bottom: 24,
      left: 24,
      right: 388,
    });
  });

  it("keeps a fit above a bottom sheet", () => {
    const phone = box(0, 0, 390, 844);
    expect(openListPadding(phone, box(12, 10, 228, 68), box(12, 642, 366, 192))).toEqual({
      top: 90,
      bottom: 214,
      left: 24,
      right: 24,
    });
  });
});

describe("stationsInView", () => {
  it("keeps stations whose coordinates are inside the map bounds", () => {
    const map = {
      getBounds: () => ({
        contains: (lngLat: [number, number]) => lngLat[0] === 25.28 && lngLat[1] === 54.687,
      }),
    };
    const inside = { id: "in", lat: 54.687, lon: 25.28 };
    const outside = { id: "out", lat: 56, lon: 21 };
    expect(stationsInView(map as never, [inside, outside])).toEqual([inside]);
  });

  it("returns every station when bounds are unavailable", () => {
    const map = {
      getBounds: () => {
        throw new Error("not ready");
      },
    };
    const stations = [{ lat: 54.6, lon: 25.2 }];
    expect(stationsInView(map as never, stations)).toEqual(stations);
  });
});

describe("stationsForRouteMap", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };

  it("shows every station when no route is active", () => {
    expect(stationsForRouteMap([a, b, c], null)).toEqual([a, b, c]);
  });

  it("keeps only selected route stations", () => {
    expect(stationsForRouteMap([a, b, c], new Set(["a", "c"]))).toEqual([a, c]);
  });

  it("hides every station when the route has none", () => {
    expect(stationsForRouteMap([a, b, c], new Set())).toEqual([]);
  });
});

describe("routeStationEmphasis", () => {
  it("marks the cheapest on-route station as pick", () => {
    expect(routeStationEmphasis("on", true)).toBe("pick");
  });

  it("marks other on-route stations as high", () => {
    expect(routeStationEmphasis("on", false)).toBe("high");
  });

  it("marks detours as low even if they are cheapest overall", () => {
    expect(routeStationEmphasis("detour", true)).toBe("low");
    expect(routeStationEmphasis("detour", false)).toBe("low");
  });
});

describe("ROUTE_MARKER", () => {
  it("uses distinct colors for on-route, cheapest, and detour stations", () => {
    const colors = [ROUTE_MARKER.pick, ROUTE_MARKER.on, ROUTE_MARKER.detour];
    expect(new Set(colors).size).toBe(3);
    expect(ROUTE_MARKER.on).not.toBe("#15803d");
    expect(ROUTE_MARKER.on).not.toBe("#1b6b3a");
  });
});

describe("stationPopupHtml", () => {
  it("omits navigate and last-updated, which already live in the station list", () => {
    setLocale("en");
    const html = stationPopupHtml(sampleStation, {
      date: "2026-09-11",
      generatedAt: "2026-09-12T19:09:22.245Z",
      prices: {},
    });
    expect(html).toContain("Test station");
    expect(html).not.toContain("Updated");
    expect(html).not.toContain("Last checked");
    expect(html).not.toContain("Last updated");
    expect(html).not.toContain("Navigate");
    expect(html).not.toContain("openstreetmap.org/directions");
  });

  it("does not show 98 prices", () => {
    setLocale("en");
    const html = stationPopupHtml(sampleStation, {
      date: "2026-09-11",
      generatedAt: "2026-09-12T19:09:22.245Z",
      prices: {
        "osm:1": {
          "95": { price: 1.111, source: "t", observedAt: "2026-09-11T12:00:00Z" },
          "98": { price: 1.999, source: "t", observedAt: "2026-09-11T12:00:00Z" },
          D: { price: 1.222, source: "t", observedAt: "2026-09-11T12:00:00Z" },
        },
      },
    });
    expect(html).toContain("95");
    expect(html).toContain("1.111");
    expect(html).toContain("1.222");
    expect(html).not.toContain("98");
    expect(html).not.toContain("1.999");
  });

  it("shows distance without a max-speed ETA", () => {
    setLocale("en");
    const html = stationPopupHtml(
      sampleStation,
      {
        date: "2026-09-11",
        generatedAt: "2026-09-12T19:09:22.245Z",
        prices: {},
      },
      { distLabel: "12 km" },
    );
    expect(html).toContain("12 km");
    expect(html).not.toContain("max speed");
    expect(html).not.toContain("min");
  });

  it("does not repeat an address that is already the title", () => {
    const html = stationPopupHtml(
      { ...sampleStation, name: "Kauno g. 10", address: "Kauno g. 10" },
      null,
    );
    expect(html.match(/Kauno g\. 10/g)).toHaveLength(1);
    expect(stationPopupHtml({ ...sampleStation, address: "Oslo g. 12" }, null)).toContain(
      "Oslo g. 12",
    );
  });
});

describe("charger popup", () => {
  const charger: Station = {
    ...sampleStation,
    id: "ev:node:1",
    name: "Akropolis",
    brand: "independent",
    fuels: ["EV"],
    ev: { sockets: ["type2", "type2_combo"], maxKw: 150, network: "Local Grid" },
  };

  it("shows the €/kWh price, sockets, power and price origin", () => {
    setLocale("en");
    const html = stationPopupHtml(charger, {
      date: "2026-10-06",
      generatedAt: "2026-10-06T12:00:00Z",
      prices: {
        "ev:node:1": {
          EV: { price: 0.39, source: "ev-tariff", observedAt: "2026-10-01T00:00:00Z" },
        },
      },
    });
    expect(html).toContain("€0.390/kWh");
    expect(html).toContain("Type 2, CCS");
    expect(html).toContain("up to 150 kW");
    expect(html).toContain("Network tariff");
    expect(html).toContain("Not in the national charger register");
    expect(html).toContain("Local Grid");
    expect(html).not.toContain("LPG");
  });

  it("names the register as the source and shows AC/DC prices and the session fee", () => {
    setLocale("en");
    const html = stationPopupHtml(
      { ...charger, ev: { ...charger.ev!, prices: { ac: 0.28, dc: 0.39 }, sessionFee: 0.3 } },
      {
        date: "2026-10-06",
        generatedAt: "2026-10-06T12:00:00Z",
        prices: {
          "ev:node:1": {
            EV: { price: 0.28, source: "via-lietuva", observedAt: "2026-10-06T12:00:00Z" },
          },
        },
      },
    );
    expect(html).toContain("AC €0.280/kWh · DC €0.390/kWh");
    expect(html).toContain("+ €0.30 per session");
    expect(html).toContain("national charger register");
    const registered = stationPopupHtml({ ...charger, id: "vl:IBG-1" }, null);
    expect(registered).not.toContain("Not in the national charger register");
  });

  it("puts the reason a charger is free behind a ? next to the price", () => {
    setLocale("lt");
    const free: Station = {
      ...charger,
      id: "vl:STR-1",
      ev: { ...charger.ev!, registerPrice: 0, free: { reason: "fleet", owner: "Rar transportas" } },
    };
    const html = stationPopupHtml(free, {
      date: "2026-10-06",
      generatedAt: "2026-10-06T12:00:00Z",
      prices: { "vl:STR-1": { EV: { price: 0, source: "via-lietuva", observedAt: "x" } } },
    });
    expect(html).toContain("Nemokamai");
    expect(html).toContain('data-act="free-why"');
    expect(html).toContain('aria-label="Kodėl nemokama?"');
    expect(html).toContain("Priklauso transporto įmonei „Rar transportas“");
    expect(freeReasonText({ ...free, ev: { ...free.ev!, free: undefined } })).toContain(
      "priežastis nenurodyta",
    );
    const paid = stationPopupHtml(charger, {
      date: "2026-10-06",
      generatedAt: "2026-10-06T12:00:00Z",
      prices: { "ev:node:1": { EV: { price: 0.3, source: "ev-tariff", observedAt: "x" } } },
    });
    expect(paid).not.toContain("free-why");
  });

  it("dedupes socket names", () => {
    expect(socketLabels(["type2", "type2_cable", "chademo"])).toEqual(["Type 2", "CHAdeMO"]);
  });

  it("gives each socket its own power when known, and drops a repeated top power", () => {
    expect(
      socketLabels(["type2", "type2_cable", "type2_combo"], { type2: 11, type2_cable: 22 }),
    ).toEqual(["Type 2 22 kW", "CCS"]);
    setLocale("en");
    const html = stationPopupHtml(
      { ...charger, ev: { ...charger.ev!, kwBySocket: { type2: 22, type2_combo: 150 } } },
      null,
    );
    expect(html).toContain("Type 2 22 kW, CCS 150 kW");
    expect(html).not.toContain("up to");
  });
});

describe("percentile", () => {
  it("matches a linear scan for the first entry at or above the value", () => {
    const linear = (sorted: number[], value: number): number => {
      if (sorted.length === 1) return 0.5;
      let i = 0;
      while (i < sorted.length && sorted[i] < value) i++;
      return i / (sorted.length - 1);
    };
    const sorted = [1.699, 1.749, 1.749, 1.749, 1.799, 1.899, 1.899];
    for (const v of [1.5, 1.699, 1.72, 1.749, 1.799, 1.85, 1.899, 2]) {
      expect(percentile(sorted, v)).toBe(linear(sorted, v));
    }
    expect(percentile([1.8], 1.8)).toBe(0.5);
    expect(percentile([1.7, 1.9], 1.7)).toBe(0);
    expect(percentile([1.7, 1.9], 1.9)).toBe(1);
  });
});

describe("openListPadding edges", () => {
  const box = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  const map = box(0, 0, 1280, 720);

  it("keeps the edge when the header and list are missing", () => {
    expect(openListPadding(map, null, null)).toEqual({ top: 24, bottom: 24, left: 24, right: 24 });
  });

  it("ignores a header or list with no height", () => {
    expect(openListPadding(map, box(0, 0, 100, 0), box(0, 700, 100, 0))).toEqual({
      top: 24,
      bottom: 24,
      left: 24,
      right: 24,
    });
  });
});

describe("createMap", () => {
  it("builds the station map when the style loads", () => {
    const map = loadedMap(handlers());
    expect(map.options).toMatchObject({ style: MAP_STYLE_URL, center: LT_CENTER, zoom: 7 });
    expect(map.controls).toHaveLength(2);
    expect(map.controls[0]?.position).toBe("top-right");
    expect(
      (map.controls[1]?.control.options as { positionOptions: { enableHighAccuracy: boolean } })
        .positionOptions.enableHighAccuracy,
    ).toBe(true);
    expect([...map.sources.keys()]).toEqual(["stations", "route", "detours", "route-options"]);
    expect(map.getSource("stations")?.data).toEqual({ type: "FeatureCollection", features: [] });
    expect(map.layers.map((layer) => layer.id)).toEqual([
      "route-options-line",
      "route-options-hit",
      "route-line",
      "detours-line",
      "stations-clusters",
      "stations-cluster-count",
      "stations-halo",
      "stations-points",
      "stations-labels",
      "stations-route-labels",
    ]);
  });

  it("treats a tap as a map tap while a point is being picked", () => {
    const h = handlers(() => true);
    const map = loadedMap(h);
    listen(
      map,
      "click",
      "stations-points",
    )({
      features: [{ properties: { id: "s1" } }],
    });
    listen(
      map,
      "click",
      "stations-clusters",
    )({
      features: [
        { properties: { cluster_id: 1 }, geometry: { type: "Point", coordinates: [25, 55] } },
      ],
    });
    listen(
      map,
      "click",
      "route-options-hit",
    )({
      point: { x: 1, y: 1 },
      features: [{ properties: { index: 0 } }],
    });
    expect(h.onStationClick).not.toHaveBeenCalled();
    expect(h.onRouteClick).not.toHaveBeenCalled();
    expect(map.getSource("stations")?.getClusterExpansionZoom).not.toHaveBeenCalled();
  });

  it("opens a station only when the point has an id", () => {
    const h = handlers();
    const map = loadedMap(h);
    const click = listen(map, "click", "stations-points");
    click({});
    click({ features: [{}] });
    click({ features: [{ properties: {} }] });
    click({ features: [{ properties: { id: "" } }] });
    expect(h.onStationClick).not.toHaveBeenCalled();
    click({ features: [{ properties: { id: "s1" } }] });
    expect(h.onStationClick).toHaveBeenCalledOnce();
    expect(h.onStationClick).toHaveBeenCalledWith("s1");
  });

  it("zooms a cluster of points and ignores anything else", async () => {
    const map = loadedMap(handlers(() => false));
    const click = listen(map, "click", "stations-clusters");
    click({});
    click({ features: [] });
    click({
      features: [
        { geometry: { type: "LineString", coordinates: [] }, properties: { cluster_id: 2 } },
      ],
    });
    expect(map.getSource("stations")?.getClusterExpansionZoom).not.toHaveBeenCalled();
    click({
      features: [
        { geometry: { type: "Point", coordinates: [25.2, 54.7] }, properties: { cluster_id: 4 } },
      ],
    });
    click({ features: [{ geometry: { type: "Point", coordinates: [24, 55] } }] });
    await Promise.resolve();
    expect(map.easeTo).toHaveBeenCalledWith({ center: [25.2, 54.7], zoom: 12 });
    expect(map.easeTo).toHaveBeenCalledWith({ center: [24, 55], zoom: 12 });
  });

  it("picks a route choice unless a station is under the point", () => {
    const h = handlers(() => false);
    const map = loadedMap(h);
    const click = listen(map, "click", "route-options-hit");
    map.queryRenderedFeatures.mockReturnValueOnce([{ layer: "stations-points" }]);
    click({ point: { x: 2, y: 3 }, features: [{ properties: { index: 1 } }] });
    expect(h.onRouteClick).not.toHaveBeenCalled();
    map.queryRenderedFeatures.mockReturnValue([]);
    click({ point: { x: 2, y: 3 }, features: [{ properties: { index: "1" } }] });
    click({ point: { x: 2, y: 3 }, features: [] });
    expect(h.onRouteClick).not.toHaveBeenCalled();
    click({ point: { x: 2, y: 3 }, features: [{ properties: { index: 2 } }] });
    expect(h.onRouteClick).toHaveBeenCalledOnce();
    expect(h.onRouteClick).toHaveBeenCalledWith(2);
  });

  it("reports a map tap when the hit is empty or a point is being picked", () => {
    const picking = vi.fn(() => false);
    const h = handlers(picking);
    const map = loadedMap(h);
    const click = listen(map, "click");
    map.queryRenderedFeatures.mockReturnValue([{}]);
    click({ point: { x: 0, y: 0 }, lngLat: { lng: 23, lat: 54 } });
    expect(h.onMapClick).not.toHaveBeenCalled();
    picking.mockReturnValue(true);
    click({ point: { x: 0, y: 0 }, lngLat: { lng: 23.5, lat: 54.5 } });
    map.queryRenderedFeatures.mockReturnValue([]);
    picking.mockReturnValue(false);
    click({ point: { x: 1, y: 1 }, lngLat: { lng: 24, lat: 55 } });
    expect(h.onMapClick).toHaveBeenCalledTimes(2);
    expect(h.onMapClick).toHaveBeenNthCalledWith(1, { lon: 23.5, lat: 54.5 });
    expect(h.onMapClick).toHaveBeenNthCalledWith(2, { lon: 24, lat: 55 });
  });

  it("uses a pointer cursor on stations and route choices", () => {
    const map = loadedMap(handlers());
    listen(map, "mouseenter", "stations-points")({});
    expect(map.getCanvas().style.cursor).toBe("pointer");
    listen(map, "mouseleave", "stations-points")({});
    expect(map.getCanvas().style.cursor).toBe("");
    listen(map, "mouseenter", "route-options-hit")({});
    expect(map.getCanvas().style.cursor).toBe("pointer");
    listen(map, "mouseleave", "route-options-hit")({});
    expect(map.getCanvas().style.cursor).toBe("");
  });
});

describe("setMapGeolocateAccuracy", () => {
  it("leaves the control in place when the accuracy is unchanged", () => {
    const map = loadedMap(handlers(), true);
    setMapGeolocateAccuracy(map as unknown as maplibregl.Map, true);
    expect(map.removeControl).not.toHaveBeenCalled();
    expect(map.controls).toHaveLength(2);
  });

  it("replaces the control when the accuracy changes", () => {
    const map = loadedMap(handlers(), true);
    const previous = map.controls[1]?.control;
    setMapGeolocateAccuracy(map as unknown as maplibregl.Map, false);
    expect(map.removeControl).toHaveBeenCalledWith(previous);
    expect(map.controls).toHaveLength(2);
    expect(
      (map.controls[1]?.control.options as { positionOptions: { enableHighAccuracy: boolean } })
        .positionOptions.enableHighAccuracy,
    ).toBe(false);
    new maplibregl.Map({ container: {} as HTMLElement });
    const bare = maplibre.maps.at(-1)!;
    setMapGeolocateAccuracy(bare as unknown as maplibregl.Map, true);
    expect(bare.removeControl).not.toHaveBeenCalled();
    expect(bare.controls).toHaveLength(1);
  });
});

describe("setStationData", () => {
  function withStations(): MockMap {
    new maplibregl.Map({ container: {} as HTMLElement });
    const map = maplibre.maps.at(-1)!;
    map.addSource("stations", {});
    return map;
  }

  it("does nothing when the station source is missing", () => {
    new maplibregl.Map({ container: {} as HTMLElement });
    const map = maplibre.maps.at(-1)!;
    setStationData(
      map as unknown as maplibregl.Map,
      [fuelStation({ id: "a" })],
      null,
      "D",
      DEFAULT_SETTINGS,
    );
    expect(map.container.dataset.stationCount).toBeUndefined();
  });

  it("drops excluded brands for the fuel on screen", () => {
    const map = withStations();
    const diesel: DailyPrices = {
      date: "2026-10-06",
      generatedAt: "2026-10-06T00:00:00Z",
      prices: {
        a: { D: { price: 1.5, source: "t", observedAt: "2026-10-06T00:00:00Z" } },
        b: { D: { price: 1.6, source: "t", observedAt: "2026-10-06T00:00:00Z" } },
      },
    };
    setStationData(
      map as unknown as maplibregl.Map,
      [fuelStation({ id: "a", brand: "viada" }), fuelStation({ id: "b", brand: "orlen" })],
      diesel,
      "D",
      { ...DEFAULT_SETTINGS, excludedBrands: ["viada"], excludedEvBrands: ["orlen"] },
    );
    expect(featuresOf(map).map((f) => f.properties.id)).toEqual(["b"]);
    setStationData(
      map as unknown as maplibregl.Map,
      [
        fuelStation({ id: "c", brand: "ionity", fuels: ["EV"] }),
        fuelStation({ id: "d", brand: "viada", fuels: ["EV"] }),
      ],
      null,
      "EV",
      { ...DEFAULT_SETTINGS, excludedBrands: ["viada"], excludedEvBrands: ["ionity"] },
    );
    expect(featuresOf(map).map((f) => f.properties.id)).toEqual(["d"]);
  });

  it("hides unpriced fuel and keeps an unpriced charger", () => {
    const map = withStations();
    setStationData(
      map as unknown as maplibregl.Map,
      [
        fuelStation({ id: "priced" }),
        fuelStation({ id: "blank" }),
        fuelStation({ id: "charger", brand: "ionity", fuels: ["EV"] }),
      ],
      {
        date: "2026-10-06",
        generatedAt: "2026-10-06T00:00:00Z",
        prices: { priced: { D: { price: 1.4, source: "t", observedAt: "2026-10-06T00:00:00Z" } } },
      },
      "D",
      { ...DEFAULT_SETTINGS, hideUnpriced: true },
    );
    expect(featuresOf(map).map((f) => f.properties.id)).toEqual(["priced"]);
    setStationData(
      map as unknown as maplibregl.Map,
      [fuelStation({ id: "charger", brand: "ionity", fuels: ["EV"] })],
      null,
      "EV",
      { ...DEFAULT_SETTINGS, hideUnpriced: true },
    );
    const [feature] = featuresOf(map);
    expect(feature?.properties.hasPrice).toBe(0);
    expect(feature?.properties.priceLabel).toBe("");
    expect(feature?.properties.pct).toBe(0.5);
  });

  it("drops a station that does not sell the fuel when it has no price", () => {
    const map = withStations();
    setStationData(
      map as unknown as maplibregl.Map,
      [fuelStation({ id: "diesel", fuels: ["D"] }), fuelStation({ id: "petrol", fuels: ["95"] })],
      null,
      "95",
      { ...DEFAULT_SETTINGS, hideUnpriced: false },
    );
    expect(featuresOf(map).map((f) => f.properties.id)).toEqual(["petrol"]);
  });

  it("labels a free charger and a priced station", () => {
    setLocale("en");
    const map = withStations();
    setStationData(
      map as unknown as maplibregl.Map,
      [
        fuelStation({ id: "free", brand: "ionity", fuels: ["EV"] }),
        fuelStation({ id: "paid", brand: "eleport", fuels: ["EV"] }),
      ],
      {
        date: "2026-10-06",
        generatedAt: "2026-10-06T00:00:00Z",
        prices: {
          free: { EV: { price: 0, source: "via-lietuva", observedAt: "2026-10-06T00:00:00Z" } },
          paid: { EV: { price: 0.39, source: "ev-tariff", observedAt: "2026-10-06T00:00:00Z" } },
        },
      },
      "EV",
      DEFAULT_SETTINGS,
    );
    const byId = Object.fromEntries(featuresOf(map).map((f) => [f.properties.id, f.properties]));
    expect(byId.free?.priceLabel).toBe("Free");
    expect(byId.free?.price).toBe(0);
    expect(byId.free?.hasPrice).toBe(1);
    expect(byId.paid?.priceLabel).toBe("0.390");
    expect(map.container.dataset.stationCount).toBe("2");
  });

  it("applies an emphasis override", () => {
    const map = withStations();
    setStationData(
      map as unknown as maplibregl.Map,
      [fuelStation({ id: "a" }), fuelStation({ id: "b" })],
      {
        date: "2026-10-06",
        generatedAt: "2026-10-06T00:00:00Z",
        prices: {
          a: { D: { price: 1.5, source: "t", observedAt: "2026-10-06T00:00:00Z" } },
          b: { D: { price: 1.7, source: "t", observedAt: "2026-10-06T00:00:00Z" } },
        },
      },
      "D",
      DEFAULT_SETTINGS,
      { a: "pick" },
    );
    const byId = Object.fromEntries(
      featuresOf(map).map((f) => [f.properties.id, f.properties.emphasis]),
    );
    expect(byId).toEqual({ a: "pick", b: "normal" });
  });
});

describe("setRouteData", () => {
  it("does nothing when the route layers are missing", () => {
    new maplibregl.Map({ container: {} as HTMLElement });
    const map = maplibre.maps.at(-1)!;
    setRouteData(map as unknown as maplibregl.Map, line, [line]);
    expect(map.sources.size).toBe(0);
  });

  it("draws the route line and detours of at least two points", () => {
    const map = loadedMap(handlers());
    setRouteData(map as unknown as maplibregl.Map, null);
    setRouteData(map as unknown as maplibregl.Map, []);
    expect(map.getSource("route")?.data).toEqual({ type: "FeatureCollection", features: [] });
    setRouteData(map as unknown as maplibregl.Map, line, [
      [{ lon: 23, lat: 54 }],
      [
        { lon: 23, lat: 54 },
        { lon: 23.2, lat: 54.2 },
      ],
    ]);
    const route = map.getSource("route")?.data as {
      features: Array<{ geometry: { coordinates: number[][] } }>;
    };
    expect(route.features[0]?.geometry.coordinates).toEqual([
      [23.9, 54.9],
      [24.1, 55.1],
    ]);
    const detours = map.getSource("detours")?.data as { features: unknown[] };
    expect(detours.features).toHaveLength(1);
  });
});

describe("setRouteOptions", () => {
  const long = (n: number): LngLat[] => [
    { lon: 23 + n, lat: 54 },
    { lon: 23.1 + n, lat: 54.1 },
  ];

  it("does nothing when the options source is missing", () => {
    new maplibregl.Map({ container: {} as HTMLElement });
    const map = maplibre.maps.at(-1)!;
    setRouteOptions(map as unknown as maplibregl.Map, [long(0)], null);
    expect(map.sources.size).toBe(0);
  });

  it("paints each choice while the driver is still picking", () => {
    const map = loadedMap(handlers());
    setRouteOptions(
      map as unknown as maplibregl.Map,
      [long(0), long(1), [{ lon: 1, lat: 1 }], long(3)],
      null,
    );
    const features = (
      map.getSource("route-options")?.data as {
        features: Array<{ properties: { index: number; color: string; picking: boolean } }>;
      }
    ).features;
    expect(features.map((f) => f.properties.index)).toEqual([3, 1, 0]);
    expect(features.map((f) => f.properties.color)).toEqual([
      ROUTE_OPTION_COLORS[0],
      ROUTE_OPTION_COLORS[1],
      ROUTE_OPTION_COLORS[0],
    ]);
    expect(features.every((f) => f.properties.picking)).toBe(true);
  });

  it("mutes the routes that were not chosen", () => {
    const map = loadedMap(handlers());
    setRouteOptions(map as unknown as maplibregl.Map, [long(0), [{ lon: 1, lat: 1 }], long(2)], 0);
    const features = (
      map.getSource("route-options")?.data as {
        features: Array<{ properties: { index: number; color: string; picking: boolean } }>;
      }
    ).features;
    expect(features.map((f) => f.properties.index)).toEqual([2]);
    expect(features[0]?.properties.color).toBe("#6b7280");
    expect(features[0]?.properties.picking).toBe(false);
  });
});

describe("fitRoute", () => {
  it("does nothing when the route has no points", () => {
    const map = loadedMap(handlers());
    fitRoute(map as unknown as maplibregl.Map, null);
    fitRoute(map as unknown as maplibregl.Map, []);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it("fits the line and any detour point", () => {
    const map = loadedMap(handlers());
    const padding = { top: 10, bottom: 20, left: 30, right: 40 };
    fitRoute(map as unknown as maplibregl.Map, line, [[{ lon: 22, lat: 55 }]], padding);
    const bounds = map.fitBounds.mock.calls[0]?.[0] as { extended: [number, number][] };
    expect(bounds.extended).toEqual([
      [23.9, 54.9],
      [24.1, 55.1],
      [22, 55],
    ]);
    expect(map.fitBounds).toHaveBeenCalledWith(bounds, { padding, maxZoom: 12 });
    fitRoute(map as unknown as maplibregl.Map, null, [[{ lon: 21, lat: 54 }]]);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
  });
});

describe("flyToStation", () => {
  it("fits a point on the station", () => {
    const map = loadedMap(handlers());
    const s = fuelStation({ id: "a", lon: 25.28, lat: 54.687 });
    flyToStation(map as unknown as maplibregl.Map, s);
    const bounds = map.fitBounds.mock.calls[0]?.[0] as { extended: [number, number][] };
    expect(bounds.extended).toEqual([
      [25.28, 54.687],
      [25.28, 54.687],
    ]);
    expect(map.fitBounds.mock.calls[0]?.[1]).toMatchObject({ maxZoom: 14 });
  });
});

describe("station popup flags", () => {
  it("shows a stale price and a suspicious jump", () => {
    setLocale("en");
    const html = stationPopupHtml(sampleStation, {
      date: "2026-10-06",
      generatedAt: "2026-10-06T00:00:00Z",
      prices: {
        "osm:1": {
          D: {
            price: 1.2,
            source: "t",
            observedAt: "2026-10-01T00:00:00Z",
            stale: true,
            suspicious: true,
          },
          "95": { price: 1.3, source: "t", observedAt: "2026-10-06T00:00:00Z" },
        },
      },
    });
    expect(html).toContain("Stale price");
    expect(html).toContain("Suspicious jump");
    expect(html).toContain("Stale price · Suspicious jump");
  });

  it("uses the city when the street is missing", () => {
    setLocale("en");
    const city = stationPopupHtml({ ...sampleStation, city: "Kaunas" }, null);
    expect(city).toContain("Kaunas");
    const missing = stationPopupHtml({ ...sampleStation, address: "", city: "" }, null);
    expect(missing).toContain("Address unavailable");
  });
});

describe("charger details", () => {
  const charger: Station = {
    ...sampleStation,
    id: "ev:node:9",
    name: "Mall",
    brand: "independent",
    fuels: ["EV"],
    ev: { sockets: ["type2"], network: "Local" },
  };

  it("names an OpenStreetMap price and leaves other sources blank", () => {
    setLocale("en");
    const osm = stationPopupHtml(charger, {
      date: "2026-10-06",
      generatedAt: "2026-10-06T00:00:00Z",
      prices: {
        "ev:node:9": {
          EV: { price: 0.2, source: "osm-charge", observedAt: "2026-10-06T00:00:00Z" },
        },
      },
    });
    expect(osm).toContain("Price from OpenStreetMap");
    expect(osm).not.toContain("per session");
    const other = stationPopupHtml(
      {
        ...charger,
        id: "vl:other",
        ev: { ...charger.ev!, sessionFee: 1, prices: { ac: 0.2, dc: 0.4 } },
      },
      {
        date: "2026-10-06",
        generatedAt: "2026-10-06T00:00:00Z",
        prices: {
          "vl:other": { EV: { price: 0.2, source: "report", observedAt: "2026-10-06T00:00:00Z" } },
        },
      },
    );
    expect(other).not.toContain("OpenStreetMap");
    expect(other).not.toContain("Network tariff");
    expect(other).not.toContain("Price from the national");
    expect(other).not.toContain("AC ");
    expect(other).not.toContain("per session");
  });

  it("skips a split price and a session fee unless both are published", () => {
    setLocale("en");
    const html = stationPopupHtml(
      { ...charger, ev: { ...charger.ev!, prices: { ac: 0.28 }, maxKw: 50 } },
      {
        date: "2026-10-06",
        generatedAt: "2026-10-06T00:00:00Z",
        prices: {
          "ev:node:9": {
            EV: { price: 0.28, source: "via-lietuva", observedAt: "2026-10-06T00:00:00Z" },
          },
        },
      },
    );
    expect(html).toContain("national charger register");
    expect(html).not.toContain("AC ");
    expect(html).not.toContain("per session");
    expect(html).toContain("up to 50 kW");
    const bare = stationPopupHtml({ ...charger, ev: { sockets: [] } }, null);
    expect(bare).not.toContain("Sockets");
  });
});

describe("freeReasonText", () => {
  const base: Station = { ...sampleStation, ev: { sockets: ["type2"] } };

  it("explains a municipal or network charger and an unnamed fleet", () => {
    setLocale("en");
    expect(
      freeReasonText({ ...base, ev: { sockets: ["type2"], free: { reason: "municipal" } } }),
    ).toContain("municipal");
    expect(
      freeReasonText({ ...base, ev: { sockets: ["type2"], free: { reason: "networkPaid" } } }),
    ).toContain("register error");
    expect(
      freeReasonText({ ...base, ev: { sockets: ["type2"], free: { reason: "fleet" } } }),
    ).toContain("no reason");
  });
});

describe("socketLabels", () => {
  it("names an unknown socket and keeps the higher power", () => {
    expect(socketLabels(["gb_t"])).toEqual(["gb t"]);
    expect(socketLabels(["type2", "type2_cable"], { type2: 7, type2_cable: 22 })).toEqual([
      "Type 2 22 kW",
    ]);
    expect(socketLabels(["type2", "type2_cable"], { type2: 22, type2_cable: 7 })).toEqual([
      "Type 2 22 kW",
    ]);
    expect(socketLabels(["type2", "type2_cable"], { type2: 22 })).toEqual(["Type 2 22 kW"]);
    expect(socketLabels(["type2", "type2_cable"], { type2_cable: 11 })).toEqual(["Type 2 11 kW"]);
  });
});
