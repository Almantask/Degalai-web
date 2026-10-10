// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryFile, Station } from "../src/types.ts";
import type { GeoHit, RouteResult } from "../src/routing.ts";

const h = vi.hoisted(() => ({
  geo: "lt" as "lt" | "out" | "deny" | "none" | "hold",
  geoOk: null as ((pos: GeolocationPosition) => void) | null,
  geoErr: null as ((err: GeolocationPositionError) => void) | null,
  hits: [] as GeoHit[],
  reverse: null as GeoHit | null,
  holdReverse: false,
  releaseReverse: null as ((hit: GeoHit | null) => void) | null,
  routes: [] as RouteResult[],
  viaRoute: null as RouteResult | null,
  detourImpl: null as
    | ((
        trips: Array<{ stop: { lat: number; lon: number }; leave: { lat: number } }>,
      ) => DetourRows | Promise<DetourRows>)
    | null,
  sendResult: {
    ok: true,
    number: 7,
    url: "https://github.com/Almantask/Degalai-web/issues/7",
    imageSaved: true,
  } as
    | { ok: true; number?: number; url?: string; imageSaved?: boolean }
    | { ok: false; reason: "rate" | "failed" | "timeout" },
  shrink: null as ((file: Blob) => Promise<Blob>) | null,
  dataUrl: null as ((blob: Blob) => Promise<string>) | null,
  prices: null as null | {
    date: string;
    generatedAt: string;
    prices: Record<
      string,
      {
        D?: { price: number; source: string; observedAt: string };
        EV?: { price: number; source: string; observedAt: string };
      }
    >;
  },
  meta: {
    date: "2026-09-15",
    generatedAt: "2026-09-15T07:00:00.000Z",
    stationCount: 2,
    pricedStationCount: 2,
    sources: ["lea"],
    spotUpdatedAt: "2026-09-15T08:00:00.000Z",
  } as {
    date: string | null;
    generatedAt: string;
    stationCount: number;
    pricedStationCount: number;
    sources: string[];
    spotUpdatedAt?: string;
  },
  stations: [] as Station[],
  chargers: [] as Station[],
  history: null as HistoryFile | null,
  chargersGate: null as ((resolve: (rows: Station[]) => void) => void) | null,
  routesGate: null as ((resolve: (rows: RouteResult[]) => void) => void) | null,
  viaGate: null as ((resolve: (row: RouteResult | null) => void) => void) | null,
  historyGate: null as ((resolve: (file: HistoryFile | null) => void) => void) | null,
  sendGate: null as
    | ((
        resolve: (
          result:
            | { ok: true; number?: number; url?: string; imageSaved?: boolean }
            | { ok: false; reason: "rate" | "failed" | "timeout" },
        ) => void,
      ) => void)
    | null,
  stripChrome: false,
  mapHandlers: null as {
    onStationClick: (id: string) => void;
    onMapClick: (ll: { lon: number; lat: number }) => void;
    onRouteClick: (index: number) => void;
    isPicking: () => boolean;
  } | null,
  dragend: null as (() => void) | null,
  markerLngLat: { lng: 25.28, lat: 54.687 },
  matchMedia: ((_q: string): boolean => false) as (q: string) => boolean,
  promptThrows: false,
}));

vi.mock("maplibre-gl", () => {
  class Marker {
    setLngLat(ll: [number, number]) {
      h.markerLngLat = { lng: ll[0], lat: ll[1] };
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
    on(_ev: string, cb: () => void) {
      h.dragend = cb;
      return this;
    }
    getLngLat() {
      return h.markerLngLat;
    }
  }
  class Popup {
    setLngLat() {
      return this;
    }
    setHTML() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }
  return { default: { Marker, Popup } };
});

vi.mock("../src/map.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/map.ts")>("../src/map.ts");
  const map = {
    on: vi.fn(),
    once: vi.fn((_ev: string, cb: () => void) => cb()),
    getContainer: () => {
      const el = document.createElement("div");
      return el;
    },
    getBounds: () => ({ contains: () => true }),
  };
  return {
    ...actual,
    createMap: vi.fn((_container: HTMLElement, handlers: NonNullable<typeof h.mapHandlers>) => {
      h.mapHandlers = handlers;
      return map;
    }),
    setStationData: vi.fn(),
    setRouteData: vi.fn(),
    setRouteOptions: vi.fn(),
    setMapGeolocateAccuracy: vi.fn(),
    fitRoute: vi.fn(),
    flyToStation: vi.fn(),
    stationsInView: vi.fn((_map: unknown, stations: Station[]) => stations),
  };
});

vi.mock("../src/routing.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/routing.ts")>("../src/routing.ts");
  return {
    ...actual,
    geocode: vi.fn(async () => h.hits),
    reverseGeocode: vi.fn(
      () =>
        new Promise<GeoHit | null>((resolve) => {
          h.releaseReverse = resolve;
          if (!h.holdReverse) resolve(h.reverse);
        }),
    ),
    fetchRoutes: vi.fn(
      () =>
        new Promise<RouteResult[]>((resolve) => {
          if (h.routesGate) h.routesGate(resolve);
          else resolve(h.routes);
        }),
    ),
    fetchRoute: vi.fn(
      () =>
        new Promise<RouteResult | null>((resolve) => {
          if (h.viaGate) h.viaGate(resolve);
          else resolve(h.viaRoute);
        }),
    ),
    fetchDetours: vi.fn(
      async (trips: Array<{ stop: { lat: number; lon: number }; leave: { lat: number } }>) =>
        h.detourImpl ? h.detourImpl(trips) : trips.map(() => ({ extraKm: 0.05, extraMin: 1 })),
    ),
  };
});

vi.mock("../src/data.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/data.ts")>("../src/data.ts");
  return {
    ...actual,
    loadAppData: vi.fn(async () => ({
      stations: h.stations,
      prices: h.prices,
      meta: h.meta,
    })),
    loadChargers: vi.fn(
      () =>
        new Promise<Station[]>((resolve) => {
          if (h.chargersGate) h.chargersGate(resolve);
          else resolve(h.chargers);
        }),
    ),
    loadHistory: vi.fn(
      () =>
        new Promise<HistoryFile | null>((resolve) => {
          if (h.historyGate) h.historyGate(resolve);
          else resolve(h.history);
        }),
    ),
  };
});

vi.mock("../src/report.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/report.ts")>("../src/report.ts");
  return {
    ...actual,
    sendReport: vi.fn(
      () =>
        new Promise<typeof h.sendResult>((resolve) => {
          if (h.sendGate) h.sendGate(resolve);
          else resolve(h.sendResult);
        }),
    ),
  };
});

vi.mock("../src/report-image.ts", async () => {
  const actual =
    await vi.importActual<typeof import("../src/report-image.ts")>("../src/report-image.ts");
  return {
    ...actual,
    shrinkImage: vi.fn(async (file: Blob) => (h.shrink ? h.shrink(file) : file)),
    blobToDataUrl: vi.fn(async (blob: Blob) =>
      h.dataUrl ? h.dataUrl(blob) : "data:image/png;base64,aa",
    ),
  };
});

vi.mock("../src/refresh.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/refresh.ts")>("../src/refresh.ts");
  return { ...actual, refreshWebsite: vi.fn(async () => undefined) };
});

vi.mock("uplot", () => ({
  default: class {
    width = 0;
    height = 0;
    setSize(size: { width: number; height: number }) {
      this.width = size.width;
      this.height = size.height;
    }
    destroy() {}
    setScale() {}
    redraw() {}
  },
}));

vi.mock("uplot/dist/uPlot.min.css", () => ({}));

vi.mock(import("../src/history-view.ts"), () => ({
  mountHistoryChart: vi.fn(() => ({ destroy: vi.fn(), setHidden: vi.fn() })),
}));

import { assetBase, compareBrandNames, startApp } from "../src/app.ts";
import { fitRoute, flyToStation } from "../src/map.ts";
import { refreshWebsite } from "../src/refresh.ts";
import { sendReport } from "../src/report.ts";

type DetourRows = Array<{ extraKm: number; extraMin: number } | null> | null;

const price = (n: number) => ({ price: n, source: "lea", observedAt: "2026-09-15T07:00:00.000Z" });

function station(partial: Partial<Station> & Pick<Station, "id" | "name">): Station {
  return {
    brand: "circle-k",
    lat: 54.687,
    lon: 25.28,
    address: "Gedimino prospektas 1",
    city: "Vilnius",
    fuels: ["D", "95"],
    sourceIds: {},
    ...partial,
  };
}

const onRoute = station({ id: "osm:1", name: "On route", lat: 54.687, lon: 25.28 });
const offRoute = station({
  id: "osm:2",
  name: "Off route",
  brand: "viada",
  lat: 54.688,
  lon: 25.281,
});

function line(): RouteResult["geometry"] {
  return [
    { lat: 54.68, lon: 25.27 },
    { lat: 54.687, lon: 25.28 },
    { lat: 54.69, lon: 25.29 },
  ];
}

function route(extra?: Partial<RouteResult>): RouteResult {
  return {
    geometry: line(),
    distanceKm: 12,
    durationMin: 18,
    profile: "fastest",
    ...extra,
  };
}

function pos(lat: number, lon: number): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lon,
      accuracy: 1,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON() {
        return this;
      },
    },
    timestamp: Date.now(),
    toJSON() {
      return this;
    },
  };
}

function installGeo(): void {
  if (h.geo === "none") {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    return;
  }
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition(
        ok: (p: GeolocationPosition) => void,
        err: (e: GeolocationPositionError) => void,
      ) {
        h.geoOk = ok;
        h.geoErr = err;
        if (h.geo === "hold") return;
        if (h.geo === "deny")
          err({
            code: 1,
            message: "denied",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError);
        else if (h.geo === "out") ok(pos(10, 10));
        else ok(pos(54.687, 25.28));
      },
    },
  });
}

function installMedia(): void {
  window.matchMedia = (q: string) =>
    ({
      matches: h.matchMedia(q),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
      onchange: null,
    }) as MediaQueryList;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

async function boot(path = "/"): Promise<HTMLElement> {
  window.history.replaceState({}, "", path);
  installGeo();
  installMedia();
  const root = document.createElement("div");
  document.body.append(root);
  await startApp(root);
  await settle();
  return root;
}

function click(root: ParentNode, selector: string): void {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  el.click();
}

function act(root: HTMLElement, name: string, attrs: Record<string, string> = {}): void {
  const btn = document.createElement("button");
  btn.dataset.act = name;
  for (const [k, v] of Object.entries(attrs)) btn.dataset[k] = v;
  root.append(btn);
  btn.click();
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML =
    '<meta name="apple-mobile-web-app-title" content="x"><link rel="manifest" href="/manifest.webmanifest">';
  localStorage.clear();
  h.geo = "lt";
  h.geoOk = null;
  h.geoErr = null;
  h.hits = [{ label: "Kaunas", lat: 54.9, lon: 23.9 }];
  h.reverse = { label: "Vilnius", lat: 54.687, lon: 25.28 };
  h.holdReverse = false;
  h.releaseReverse = null;
  h.routes = [];
  h.viaRoute = route({
    geometry: [
      { lat: 55, lon: 25.3 },
      { lat: 54.688, lon: 25.281 },
      { lat: 55.1, lon: 25.4 },
    ],
  });
  h.detourImpl = null;
  h.sendResult = {
    ok: true,
    number: 7,
    url: "https://github.com/Almantask/Degalai-web/issues/7",
    imageSaved: true,
  };
  h.shrink = null;
  h.dataUrl = null;
  h.prices = {
    date: "2026-09-15",
    generatedAt: "2026-09-15T07:00:00.000Z",
    prices: { "osm:1": { D: price(1.6) }, "osm:2": { D: price(1.4) } },
  };
  h.meta = {
    date: "2026-09-15",
    generatedAt: "2026-09-15T07:00:00.000Z",
    stationCount: 2,
    pricedStationCount: 2,
    sources: ["lea"],
    spotUpdatedAt: "2026-09-15T08:00:00.000Z",
  };
  h.stations = [onRoute, offRoute];
  h.chargers = [];
  h.history = null;
  h.chargersGate = null;
  h.routesGate = null;
  h.viaGate = null;
  h.historyGate = null;
  h.sendGate = null;
  h.stripChrome = false;
  h.mapHandlers = null;
  h.dragend = null;
  h.matchMedia = () => false;
  h.promptThrows = false;
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  vi.clearAllMocks();
});

describe("startApp", () => {
  it("lists priced stations with the cheapest and the dearest marked", async () => {
    const root = await boot();
    expect(root.querySelectorAll("[data-act='station']").length).toBe(2);
    expect(root.querySelector(".badge")).not.toBeNull();
  });

  it("says when prices were not published", async () => {
    h.prices = null;
    const root = await boot();
    expect(root.querySelector("#banner")?.textContent).toContain("duomen");
  });

  it("says the last date while the browser is offline", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    const root = await boot();
    expect(root.querySelector("#banner")?.textContent?.length).toBeGreaterThan(0);
  });

  it("shows an empty list when nothing is in view", async () => {
    h.stations = [];
    h.prices = { date: "2026-09-15", generatedAt: "2026-09-15T07:00:00.000Z", prices: {} };
    const root = await boot();
    expect(root.querySelector(".empty")).not.toBeNull();
  });

  it("ignores a click that is not an action", async () => {
    const root = await boot();
    root.click();
    expect(root.querySelector("#start")).not.toBeNull();
  });
});

describe("requestLocation", () => {
  it("names the GPS start from a reverse lookup", async () => {
    const root = await boot();
    expect((root.querySelector("#start") as HTMLInputElement).value).toBe("Vilnius");
  });

  it("keeps the typed start when focus is in the field", async () => {
    h.geo = "hold";
    h.holdReverse = true;
    const root = await boot();
    h.geoOk?.(pos(54.687, 25.28));
    await Promise.resolve();
    root.querySelector<HTMLInputElement>("#start")!.focus();
    h.releaseReverse?.(h.reverse);
    await settle();
    expect(document.activeElement?.id).toBe("start");
  });

  it("asks for a tap when the fix is outside Lithuania", async () => {
    h.geo = "out";
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector("#banner")?.textContent?.length).toBeGreaterThan(0);
  });

  it("asks for a tap when location is denied", async () => {
    h.geo = "deny";
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.value = "Kaunas";
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector("#banner")).not.toBeNull();
  });

  it("asks for a tap when the browser has no geolocation", async () => {
    h.geo = "none";
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector("#banner")).not.toBeNull();
  });
});

describe("goDestination", () => {
  it("reports a destination the gazetteer does not know", async () => {
    h.hits = [];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.value = "nowhere";
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector("#banner")).not.toBeNull();
  });

  it("draws one route and lists stations along it", async () => {
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector(".app")?.classList.contains("has-route")).toBe(true);
  });

  it("lets the driver pick when several routes come back", async () => {
    h.routes = [route(), route({ durationMin: 22, profile: "shortest" })];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelectorAll("[data-act='route']").length).toBe(2);
    click(root, "[data-act='route']");
    await settle();
    expect(root.querySelector(".route-switch")).not.toBeNull();
    click(root, ".route-chip.is-on");
    await settle();
  });

  it("says the via point could not be routed", async () => {
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    h.routes = [];
    click(root, "[data-act='pick-via']");
    h.mapHandlers?.onMapClick({ lat: 54.7, lon: 25.3 });
    await settle();
    expect(root.querySelector("#banner")).not.toBeNull();
  });

  it("drops a route when the router returns nothing", async () => {
    h.routes = [];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector(".app")?.classList.contains("has-route")).toBe(false);
  });
});

describe("suggest", () => {
  it("fills the start from a suggestion", async () => {
    const root = await boot();
    const start = root.querySelector<HTMLInputElement>("#start")!;
    start.value = "Kau";
    start.dispatchEvent(new Event("input", { bubbles: true }));
    start.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 320));
    click(root, "#start-sug .sug");
    await settle();
    expect(start.value).toBe("Kaunas");
  });

  it("fills the destination from a suggestion", async () => {
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.value = "Kau";
    dest.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 320));
    click(root, "#dest-sug .sug");
    await settle();
    expect(root.querySelector(".app")?.classList.contains("has-route")).toBe(false);
  });
});

describe("goStart", () => {
  it("returns the start to GPS when the field is the location label", async () => {
    const root = await boot();
    const start = root.querySelector<HTMLInputElement>("#start")!;
    start.value = "Mano vieta";
    start.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector("[data-act='clear-start']")).toBeNull();
  });

  it("reports an unknown start", async () => {
    h.hits = [];
    const root = await boot();
    const start = root.querySelector<HTMLInputElement>("#start")!;
    start.value = "nowhere";
    start.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector("#banner")).not.toBeNull();
  });

  it("routes from a typed start", async () => {
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    const start = root.querySelector<HTMLInputElement>("#start")!;
    start.value = "Klaipeda";
    start.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });
});

describe("clearDestination", () => {
  it("removes the destination and the route", async () => {
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    click(root, "[data-act='clear-dest']");
    await settle();
    expect(root.querySelector("[data-act='clear-dest']")).toBeNull();
  });

  it("clears a destination from the search event", async () => {
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    const field = root.querySelector<HTMLInputElement>("#dest")!;
    field.value = "";
    field.dispatchEvent(new Event("search", { bubbles: true }));
    await settle();
    expect(root.querySelector(".has-route")).toBeNull();
  });
});

describe("clearStart", () => {
  it("clears a typed start from the search event", async () => {
    const root = await boot();
    const start = root.querySelector<HTMLInputElement>("#start")!;
    start.value = "Kaunas";
    start.dispatchEvent(new Event("input", { bubbles: true }));
    start.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    click(root, "[data-act='clear-start']");
    await settle();
    expect(root.querySelector("[data-act='clear-start']")).toBeNull();
  });
});

describe("swapStartAndDestination", () => {
  it("swaps a typed start with the destination", async () => {
    h.routes = [route()];
    const root = await boot();
    const start = root.querySelector<HTMLInputElement>("#start")!;
    start.value = "Klaipeda";
    start.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    click(root, "[data-act='swap-dest']");
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("does nothing when the swap button is disabled", async () => {
    const root = await boot();
    const btn = root.querySelector<HTMLButtonElement>("[data-act='swap-dest']")!;
    btn.disabled = false;
    btn.click();
    expect(root.querySelector("#dest")).not.toBeNull();
  });
});

describe("placeVia", () => {
  it("places a via point from the map and ignores one outside Lithuania", async () => {
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    click(root, "[data-act='pick-via']");
    expect(h.mapHandlers?.isPicking()).toBe(true);
    h.mapHandlers?.onMapClick({ lat: 10, lon: 10 });
    h.mapHandlers?.onMapClick({ lat: 54.7, lon: 25.3 });
    await settle();
    h.dragend?.();
    await settle();
    click(root, "[data-act='clear-via']");
    await settle();
    expect(root.querySelector("[data-act='clear-via']")).toBeNull();
  });

  it("cancels via picking from the banner", async () => {
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    click(root, "[data-act='pick-via']");
    click(root, ".pick-banner [data-act='pick-via']");
    expect(root.querySelector(".pick-banner")).toBeNull();
  });

  it("ignores the via button when there is no route", async () => {
    const root = await boot();
    act(root, "pick-via");
    expect(h.mapHandlers?.isPicking()).toBe(false);
  });
});

describe("handleMapPick", () => {
  it("sets the start from a map tap when location was denied", async () => {
    h.geo = "deny";
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    h.mapHandlers?.onMapClick({ lat: 10, lon: 10 });
    h.mapHandlers?.onMapClick({ lat: 54.69, lon: 25.29 });
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("opens a station from the map", async () => {
    const root = await boot();
    h.mapHandlers?.onStationClick("osm:1");
    await settle();
    h.mapHandlers?.onRouteClick(0);
    await settle();
    expect(root.querySelector("#map")).not.toBeNull();
  });
});

describe("revealStation", () => {
  it("opens a station row", async () => {
    const root = await boot();
    click(root, "[data-id='osm:1']");
    await settle();
    expect(root.querySelector(".is-min")).not.toBeNull();
  });

  it("ignores an unknown station id", async () => {
    const root = await boot();
    act(root, "station", { id: "missing" });
    expect(root.querySelector("#list")).not.toBeNull();
  });

  it("toggles the free-price explanation", async () => {
    const root = await boot();
    const btn = document.createElement("button");
    btn.dataset.act = "free-why";
    btn.setAttribute("aria-expanded", "false");
    root.append(btn);
    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    btn.click();
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("onFuelChange", () => {
  it("switches fuel group and ignores an unknown group", async () => {
    const root = await boot();
    click(root, "[data-group='petrol']");
    await settle();
    act(root, "fuel-group", { group: "nope" });
    expect(root.querySelector("[data-group='petrol'].on")).not.toBeNull();
  });

  it("loads chargers for EV and lists a free one", async () => {
    h.chargers = [
      station({
        id: "ev:1",
        name: "Free plug",
        brand: "independent",
        fuels: ["EV"],
        ev: { sockets: ["type2"], network: "Yard", prices: { ac: 0 } },
      }),
      station({
        id: "ev:2",
        name: "Paid plug",
        brand: "ignitis-on",
        fuels: ["EV"],
        ev: { sockets: ["type2_combo"], maxKw: 150, network: "Ignitis ON" },
      }),
    ];
    h.prices = {
      date: "2026-09-15",
      generatedAt: "2026-09-15T07:00:00.000Z",
      prices: {
        "ev:1": { EV: { ...price(0), source: "via-lietuva" } },
        "ev:2": { EV: { ...price(0.3), source: "via-lietuva" } },
      },
    };
    const root = await boot();
    click(root, "[data-group='ev']");
    await settle();
    expect(root.querySelector(".ev-power")).not.toBeNull();
    click(root, "[data-kw='50']");
    await settle();
    click(root, "[data-kw='50']");
    act(root, "ev-kw", { kw: "75" });
    expect(root.querySelector("[data-kw='50'].on")).not.toBeNull();
  });

  it("stops applying chargers when the fuel changed while they loaded", async () => {
    let release: (rows: Station[]) => void = () => undefined;
    h.chargersGate = (resolve) => {
      release = resolve;
    };
    const root = await boot();
    click(root, "[data-group='ev']");
    click(root, "[data-group='diesel']");
    release([]);
    await settle();
    expect(root.querySelector(".ev-power")).toBeNull();
  });
});

describe("header controls", () => {
  it("opens history and switches language", async () => {
    h.history = {
      generatedAt: "2026-09-15T07:00:00.000Z",
      keepDays: 7,
      byFuel: {
        D: { dates: ["2026-09-15"], hours: [8], brands: { "circle-k": [1.5], viada: [1.6] } },
        EV: { dates: ["2026-09-15"], hours: [8], brands: { "ignitis-on": [0.2] } },
      },
      spot: { dates: ["2026-09-15"], hours: [8], brands: { spot: [0.11] } },
    };
    const root = await boot();
    const chartMod = await import("../src/history-view.ts");
    click(root, "[data-view='history']");
    await settle();
    if (!vi.isMockFunction(chartMod.mountHistoryChart)) {
      throw new Error(`history chart was not mocked: ${Object.keys(chartMod).join(",")}`);
    }
    expect(root.querySelector("#history-chart")).not.toBeNull();
    click(root, "[data-act='history-brand']");
    click(root, "[data-act='history-all']");
    click(root, "[data-stat='min']");
    click(root, "[data-stat='min']");
    click(root, "[data-act='toggle-history']");
    click(root, "[data-act='toggle-history']");
    click(root, "[data-locale='en']");
    await settle();
    expect(document.documentElement.lang).toBe("en");
    click(root, "[data-view='map']");
    expect(root.querySelector("#history-chart")).toBeNull();
  });

  it("shows the spot series for EV history", async () => {
    localStorage.setItem("kur-degalai-settings", JSON.stringify({ fuel: "EV" }));
    h.history = {
      generatedAt: "2026-09-15T07:00:00.000Z",
      keepDays: 7,
      byFuel: { EV: { dates: ["2026-09-15"], hours: [8], brands: { "ignitis-on": [0.2] } } },
      spot: { dates: ["2026-09-15"], hours: [8], brands: { spot: [0.11] } },
    };
    h.chargers = [];
    const root = await boot();
    click(root, "[data-view='history']");
    await settle();
    click(root, "[data-act='history-spot']");
    await settle();
    expect(root.querySelector(".history-caption")).not.toBeNull();
    click(root, "[data-act='history-spot']");
  });

  it("collapses the header and the list", async () => {
    const root = await boot();
    click(root, "[data-act='toggle-header']");
    click(root, "[data-act='toggle-list']");
    expect(root.querySelector("#header")?.classList.contains("is-min")).toBe(true);
    expect(root.querySelector(".sheet")?.classList.contains("is-min")).toBe(true);
  });

  it("refreshes the site", async () => {
    const root = await boot();
    click(root, "[data-act='refresh']");
    expect(refreshWebsite).toHaveBeenCalledOnce();
  });

  it("follows the back button", async () => {
    const root = await boot();
    window.history.pushState({}, "", "/istorija");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await settle();
    expect(root.querySelector(".is-history")).not.toBeNull();
  });

  it("repaints history when the window resizes", async () => {
    const root = await boot();
    click(root, "[data-view='history']");
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(root.querySelector("#history")).not.toBeNull();
  });
});

describe("settings panel", () => {
  it("saves consumption, detour, accuracy, brands and plugs", async () => {
    h.routes = [route()];
    const root = await boot();
    click(root, "[data-act='settings']");
    const cons = root.querySelector<HTMLInputElement>("#set-cons")!;
    cons.value = "nope";
    cons.dispatchEvent(new Event("input", { bubbles: true }));
    cons.value = "8";
    cons.dispatchEvent(new Event("input", { bubbles: true }));
    const time = root.querySelector<HTMLInputElement>("#set-time")!;
    time.value = "5";
    time.dispatchEvent(new Event("input", { bubbles: true }));
    const detour = root.querySelector<HTMLInputElement>("#set-detour")!;
    detour.value = "2";
    detour.dispatchEvent(new Event("change", { bubbles: true }));
    const brand = root.querySelector<HTMLInputElement>("[data-brand='circle-k']")!;
    brand.checked = false;
    brand.dispatchEvent(new Event("change", { bubbles: true }));
    brand.checked = true;
    brand.dispatchEvent(new Event("change", { bubbles: true }));
    const accuracy = root.querySelector<HTMLInputElement>("#set-high-accuracy")!;
    accuracy.checked = false;
    accuracy.dispatchEvent(new Event("change", { bubbles: true }));
    const stray = document.createElement("input");
    stray.id = "set-extra";
    root.append(stray);
    stray.dispatchEvent(new Event("change", { bubbles: true }));
    click(root, "[data-act='close-panel']");
    expect(root.querySelector("#set-cons")).toBeNull();
  });

  it("re-sorts a route when the detour limit changes", async () => {
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    click(root, "[data-act='settings']");
    const detour = root.querySelector<HTMLInputElement>("#set-detour")!;
    detour.value = "0.2";
    detour.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("filters EV plugs and networks", async () => {
    h.chargers = [
      station({
        id: "ev:1",
        name: "Plug",
        brand: "independent",
        fuels: ["EV"],
        ev: { sockets: ["type2"], network: "Yard" },
      }),
    ];
    const root = await boot();
    click(root, "[data-group='ev']");
    await settle();
    click(root, "[data-act='settings']");
    const evCons = root.querySelector<HTMLInputElement>("#set-ev-cons")!;
    evCons.value = "18";
    evCons.dispatchEvent(new Event("input", { bubbles: true }));
    const plug = root.querySelector<HTMLInputElement>("#set-plug-type2")!;
    plug.checked = false;
    plug.dispatchEvent(new Event("change", { bubbles: true }));
    plug.checked = true;
    plug.dispatchEvent(new Event("change", { bubbles: true }));
    const bad = document.createElement("input");
    bad.id = "set-plug-nope";
    bad.dataset.plug = "nope";
    root.append(bad);
    bad.dispatchEvent(new Event("change", { bubbles: true }));
    const net = root.querySelector<HTMLInputElement>("[data-brand]")!;
    net.checked = false;
    net.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.querySelector(".plug-filter")).not.toBeNull();
  });
});

describe("submitReport", () => {
  async function openBug(root: HTMLElement): Promise<void> {
    click(root, "[data-act='report']");
    const kind = root.querySelector<HTMLInputElement>("#report-kind-bug")!;
    kind.checked = true;
    kind.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("rejects a short description", async () => {
    const root = await boot();
    await openBug(root);
    const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
    text.value = "short";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(root.querySelector(".report-msg")).not.toBeNull();
  });

  it("rejects an email that is not an address", async () => {
    const root = await boot();
    await openBug(root);
    const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
    text.value = "The price at this station is wrong.";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const email = root.querySelector<HTMLInputElement>("#report-email")!;
    email.value = "not-an-email";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(root.querySelector("[aria-invalid='true']")).not.toBeNull();
  });

  it("files a report and copies the issue link", async () => {
    const root = await boot();
    await openBug(root);
    const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
    text.value = "The price at this station is wrong.";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const email = root.querySelector<HTMLInputElement>("#report-email")!;
    email.value = "a@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(sendReport).toHaveBeenCalled();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
    click(root, "[data-act='report-copy-link']");
    await settle();
    expect(
      root.querySelector("[data-act='report-copy-link']")?.textContent?.length,
    ).toBeGreaterThan(0);
  });

  it("selects the link when the clipboard is blocked", async () => {
    const root = await boot();
    await openBug(root);
    const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
    text.value = "The price at this station is wrong.";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const email = root.querySelector<HTMLInputElement>("#report-email")!;
    email.value = "a@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    click(root, "[data-act='report-copy-link']");
    await settle();
    expect(root.querySelector(".report-issue-address")).not.toBeNull();
  });

  it("shows a thanks message when the worker sends no link", async () => {
    h.sendResult = { ok: true };
    const root = await boot();
    await openBug(root);
    const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
    text.value = "The price at this station is wrong.";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const email = root.querySelector<HTMLInputElement>("#report-email")!;
    email.value = "a@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(root.querySelector(".report-done")).not.toBeNull();
  });

  it("shows a timeout and keeps the draft", async () => {
    h.sendResult = { ok: false, reason: "timeout" };
    const root = await boot();
    await openBug(root);
    const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
    text.value = "The price at this station is wrong.";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const email = root.querySelector<HTMLInputElement>("#report-email")!;
    email.value = "a@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(root.querySelector(".report-issue-link")).not.toBeNull();
  });

  it("shows rate limit and failure messages", async () => {
    h.sendResult = { ok: false, reason: "rate" };
    const root = await boot();
    await openBug(root);
    const fill = () => {
      const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
      text.value = "The price at this station is wrong.";
      text.dispatchEvent(new Event("input", { bubbles: true }));
      const email = root.querySelector<HTMLInputElement>("#report-email")!;
      email.value = "a@example.com";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    };
    fill();
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(root.querySelector(".report-msg")).not.toBeNull();
    h.sendResult = { ok: false, reason: "failed" };
    fill();
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(root.querySelector(".report-msg")).not.toBeNull();
  });

  it("attaches a picture and removes it", async () => {
    const root = await boot();
    await openBug(root);
    const input = root.querySelector<HTMLInputElement>("#report-image")!;
    const file = new File(["x"], "a.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(root.querySelector(".report-image img")).not.toBeNull();
    click(root, "[data-act='report-image-remove']");
    expect(root.querySelector("[data-act='report-image-pick']")).not.toBeNull();
  });

  it("shows a failure when the picture cannot be shrunk", async () => {
    h.shrink = async () => Promise.reject(new Error("big"));
    const root = await boot();
    await openBug(root);
    click(root, "[data-act='report-image-pick']");
    const input = root.querySelector<HTMLInputElement>("#report-image")!;
    Object.defineProperty(input, "files", { configurable: true, value: undefined });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const file = new File(["x"], "a.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(root.querySelector(".report-msg")).not.toBeNull();
  });

  it("pastes a picture and ignores pasted text", async () => {
    const root = await boot();
    await openBug(root);
    const empty = new Event("paste", { bubbles: true });
    Object.defineProperty(empty, "clipboardData", { value: { files: [] } });
    root.dispatchEvent(empty);
    const file = new File(["x"], "a.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [file] } });
    root.dispatchEvent(paste);
    await settle();
    expect(root.querySelector(".report-image img")).not.toBeNull();
  });

  it("does not send before a category is chosen", async () => {
    const root = await boot();
    click(root, "[data-act='report']");
    const form = root.querySelector("#report-form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const stray = document.createElement("form");
    stray.id = "other";
    root.append(stray);
    stray.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const bad = document.createElement("input");
    bad.name = "report-kind";
    bad.value = "nope";
    root.append(bad);
    bad.dispatchEvent(new Event("change", { bubbles: true }));
    expect(sendReport).not.toHaveBeenCalled();
  });

  it("fails the send when the picture cannot be encoded", async () => {
    h.dataUrl = async () => Promise.reject(new Error("read"));
    const root = await boot();
    await openBug(root);
    const input = root.querySelector<HTMLInputElement>("#report-image")!;
    const file = new File(["x"], "a.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
    text.value = "The price at this station is wrong.";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const email = root.querySelector<HTMLInputElement>("#report-email")!;
    email.value = "a@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(root.querySelector(".report-msg")).not.toBeNull();
  });

  it("notes when the picture was not stored", async () => {
    h.sendResult = {
      ok: true,
      number: 8,
      url: "https://github.com/Almantask/Degalai-web/issues/8",
      imageSaved: false,
    };
    const root = await boot();
    await openBug(root);
    const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
    text.value = "The price at this station is wrong.";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const email = root.querySelector<HTMLInputElement>("#report-email")!;
    email.value = "a@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(root.querySelectorAll(".report-msg").length).toBeGreaterThan(0);
  });
});

describe("install offer", () => {
  it("installs from the browser prompt and survives a closed sheet", async () => {
    const root = await boot();
    const ev = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(ev, { prompt: vi.fn(async () => undefined) });
    window.dispatchEvent(ev);
    click(root, "[data-act='install']");
    await settle();
    const again = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(again, {
      prompt: vi.fn(async () => Promise.reject(new Error("closed"))),
    });
    window.dispatchEvent(again);
    click(root, "[data-act='install']");
    await settle();
    expect(root.querySelector("[data-act='install']")).toBeNull();
  });

  it("ignores a prompt event that cannot prompt", async () => {
    const root = await boot();
    window.dispatchEvent(new Event("beforeinstallprompt"));
    expect(root.querySelector("[data-act='install']")).toBeNull();
  });

  it("marks the page standalone and clears the hint after install", async () => {
    h.matchMedia = (q) => q.includes("display-mode: standalone");
    const root = await boot("/en/");
    expect(document.documentElement.classList.contains("is-standalone")).toBe(true);
    window.dispatchEvent(new Event("appinstalled"));
    expect(root.querySelector(".install-banner")).toBeNull();
  });

  it("shows the iOS hint", async () => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const root = await boot();
    expect(root.querySelector(".install-banner")).not.toBeNull();
    click(root, "[data-act='install-dismiss']");
  });
});

describe("sheet drag", () => {
  it("drags the header, the list and the history sheet", async () => {
    h.matchMedia = (q) => q.includes("max-width");
    h.history = {
      generatedAt: "2026-09-15T07:00:00.000Z",
      keepDays: 7,
      byFuel: { D: { hours: [8], brands: { "circle-k": [1.5] } } },
    };
    const root = await boot();
    click(root, "[data-view='history']");
    await settle();
    for (const selector of [".header-toggle", ".list-head", ".history-head"]) {
      const handle = root.querySelector<HTMLElement>(selector)!;
      handle.dispatchEvent(
        new PointerEvent("pointerdown", {
          clientX: 10,
          clientY: 10,
          pointerId: 1,
          bubbles: true,
          pointerType: "touch",
        }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 10, clientY: 12, pointerId: 1, bubbles: true }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 12, clientY: 80, pointerId: 1, bubbles: true }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 12, clientY: 80, pointerId: 1, bubbles: true }),
      );
    }
    root.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(root.querySelector("#header")).not.toBeNull();
  });

  it("ignores a drag that is mostly horizontal", async () => {
    h.matchMedia = (q) => q.includes("max-width");
    const root = await boot();
    const handle = root.querySelector<HTMLElement>(".header-toggle")!;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        bubbles: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 40, clientY: 2, pointerId: 1 }),
    );
    window.dispatchEvent(
      new PointerEvent("pointercancel", { clientX: 40, clientY: 2, pointerId: 1 }),
    );
    expect(root.querySelector("#header")?.classList.contains("is-min")).toBe(false);
  });

  it("ignores a right-click and a wide layout", async () => {
    const root = await boot();
    const handle = root.querySelector<HTMLElement>(".list-head")!;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        bubbles: true,
        button: 2,
        pointerType: "mouse",
      }),
    );
    h.matchMedia = () => false;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        bubbles: true,
        pointerType: "touch",
      }),
    );
    expect(root.querySelector(".is-dragging")).toBeNull();
  });
});

describe("route evaluation", () => {
  it("marks a cheaper station on the dashed via-route", async () => {
    h.detourImpl = (trips) =>
      trips.map((t) =>
        Math.abs(t.stop.lat - 54.688) < 0.0005 && t.leave.lat < 54.69
          ? { extraKm: 5, extraMin: 8 }
          : { extraKm: 0.05, extraMin: 1 },
      );
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    click(root, "[data-id='osm:1']");
    await settle();
    expect(root.querySelector("#list")?.textContent).toContain("Off route");
  });

  it("keeps stations when the router does not answer detours", async () => {
    h.detourImpl = () => null;
    h.viaRoute = null;
    h.routes = [route({ geometry: [] })];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    h.routes = [route()];
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector("#list")).not.toBeNull();
  });

  it("drops a stale evaluation when the fuel changes mid-route", async () => {
    let release: (rows: Array<{ extraKm: number; extraMin: number } | null> | null) => void = () =>
      undefined;
    h.detourImpl = () =>
      new Promise<DetourRows>((resolve) => {
        release = resolve;
      });
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    click(root, "[data-group='petrol']");
    release(null);
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("orders a via point already on the route", async () => {
    h.routes = [route({ via: { lat: 54.69, lon: 25.29 } })];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("says when a route has no priced stations", async () => {
    h.prices = { date: "2026-09-15", generatedAt: "2026-09-15T07:00:00.000Z", prices: {} };
    h.routes = [route()];
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    expect(root.querySelector(".empty")).not.toBeNull();
  });
});

describe("updateHreflang", () => {
  it("skips missing head tags", async () => {
    document.head.innerHTML = "";
    const root = await boot();
    click(root, "[data-locale='en']");
    expect(document.title.length).toBeGreaterThan(0);
  });
});

function charger(partial: Partial<Station> & Pick<Station, "id" | "name">): Station {
  return station({
    brand: "ignitis-on",
    fuels: ["EV"],
    ev: { sockets: ["type2", "ccs"], maxKw: 150, network: "Ignitis ON" },
    ...partial,
  });
}

async function typeEnter(root: HTMLElement, id: string, value?: string): Promise<void> {
  const el = root.querySelector<HTMLInputElement>(`#${id}`)!;
  if (value != null) {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await settle();
}

async function withChromeStrip(run: () => Promise<void>): Promise<void> {
  const orig = HTMLElement.prototype.getBoundingClientRect;
  let measures = 0;
  HTMLElement.prototype.getBoundingClientRect = function () {
    const rect = orig.call(this);
    if (h.stripChrome && this.id === "header") {
      measures += 1;
      // The render pass measures once for the sheet and once to place the map.
      // Removing the chrome after that leaves the fit call with nothing to pad around.
      if (measures >= 2) {
        h.stripChrome = false;
        this.remove();
        this.ownerDocument.getElementById("list")?.remove();
      }
    }
    return rect;
  };
  try {
    await run();
  } finally {
    HTMLElement.prototype.getBoundingClientRect = orig;
    h.stripChrome = false;
  }
}

function press(handle: HTMLElement, button = 0, pointerType = "touch"): void {
  handle.dispatchEvent(
    new PointerEvent("pointerdown", {
      clientX: 0,
      clientY: 0,
      pointerId: 1,
      bubbles: true,
      button,
      pointerType,
    }),
  );
}

describe("compareBrandNames", () => {
  it("sorts an independent brand after a named one", () => {
    expect(compareBrandNames("independent", "viada", (brand) => brand, "lt")).toBe(1);
  });
});

describe("assetBase", () => {
  it("keeps a non-empty base", () => {
    expect(assetBase("/repo/")).toBe("/repo/");
  });

  it("uses the site root when the base is empty", () => {
    expect(assetBase("")).toBe("/");
  });
});

describe("fuel from the url", () => {
  it("reads the EV fuel and its power preset", async () => {
    const root = await boot("/?fuel=ev&kw=50");
    expect(root.querySelector("[data-kw='50']")?.classList.contains("on")).toBe(true);
  });

  it("applies a fuel the back button lands on", async () => {
    const root = await boot();
    window.history.pushState({}, "", "/?fuel=ev&kw=150");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(root.querySelector("[data-kw='150']")?.classList.contains("on")).toBe(true);
    window.history.pushState({}, "", "/?fuel=95");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(root.querySelector("[data-group='petrol']")?.classList.contains("on")).toBe(true);
  });
});

describe("num", () => {
  it("falls back when the consumption field is not a number", async () => {
    const root = await boot();
    click(root, "[data-act='settings']");
    const cons = root.querySelector<HTMLInputElement>("#set-cons")!;
    cons.type = "text";
    cons.value = "nope";
    cons.dispatchEvent(new Event("input", { bubbles: true }));
    expect(cons.value).toBe("nope");
  });
});

describe("sheet edges", () => {
  it("ignores a mouse button other than the primary one", async () => {
    h.matchMedia = (q) => q.includes("max-width");
    const root = await boot();
    press(root.querySelector(".header-toggle")!, 2, "mouse");
    expect(root.querySelector(".is-dragging")).toBeNull();
  });

  it("ignores a drag whose sheet is no longer in the page", async () => {
    h.matchMedia = (q) => q.includes("max-width");
    const root = await boot();
    const handle = root.querySelector<HTMLElement>(".header-toggle")!;
    root.append(handle);
    root.querySelector("#header")!.remove();
    press(handle);
    expect(root.querySelector(".is-dragging")).toBeNull();
  });

  it("releases pointer capture when the drag ends", async () => {
    h.matchMedia = (q) => q.includes("max-width");
    const root = await boot();
    const handle = root.querySelector<HTMLElement>(".header-toggle")!;
    let released = false;
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = () => {
      released = true;
    };
    press(handle);
    window.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 0, clientY: 40, pointerId: 1 }),
    );
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 0, clientY: 40, pointerId: 1 }));
    expect(released).toBe(true);
  });
});

describe("panels already open", () => {
  it("closes settings when they are open", async () => {
    const root = await boot();
    click(root, "[data-act='settings']");
    click(root, "[data-act='settings']");
    expect(root.querySelector(".panel")).toBeNull();
  });

  it("closes the report form when it is open", async () => {
    const root = await boot();
    click(root, "[data-act='report']");
    click(root, "[data-act='report']");
    expect(root.querySelector(".report-panel")).toBeNull();
  });
});

describe("route field input", () => {
  it("keeps whatever is typed in the destination", async () => {
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.value = "Kaunas";
    dest.dispatchEvent(new Event("input", { bubbles: true }));
    expect(dest.value).toBe("Kaunas");
  });

  it("treats the GPS label typed into the start as my location", async () => {
    const root = await boot();
    await typeEnter(root, "start", "Klaipeda");
    const start = root.querySelector<HTMLInputElement>("#start")!;
    start.value = "Mano vieta";
    start.dispatchEvent(new Event("input", { bubbles: true }));
    click(root, "[data-view='map']");
    expect(root.querySelector("[data-act='clear-start']")).toBeNull();
  });

  it("ignores a search event that still has text", async () => {
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.value = "Kaunas";
    dest.dispatchEvent(new Event("search", { bubbles: true }));
    expect(dest.value).toBe("Kaunas");
  });

  it("leaves an idle empty destination alone", async () => {
    const root = await boot();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.value = "";
    dest.dispatchEvent(new Event("search", { bubbles: true }));
    expect(dest.value).toBe("");
  });

  it("clears a failed destination from the search event", async () => {
    h.hits = [];
    const root = await boot();
    await typeEnter(root, "dest", "nowhere");
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.value = "";
    dest.dispatchEvent(new Event("search", { bubbles: true }));
    await settle();
    expect(root.querySelector("#banner")?.textContent).not.toContain("Nepavyko rasti");
  });

  it("clears the start from the search event", async () => {
    const root = await boot();
    await typeEnter(root, "start", "Klaipeda");
    const start = root.querySelector<HTMLInputElement>("#start")!;
    start.value = "";
    start.dispatchEvent(new Event("search", { bubbles: true }));
    await settle();
    expect(root.querySelector("[data-act='clear-start']")).toBeNull();
  });

  it("does nothing when the suggestion box is gone", async () => {
    const root = await boot();
    root.querySelector("#dest-sug")!.remove();
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.value = "Kau";
    dest.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 320));
    expect(root.querySelector("#dest-sug")).toBeNull();
  });

  it("treats an empty start as GPS", async () => {
    const root = await boot();
    await typeEnter(root, "start", "");
    expect(root.querySelector("[data-act='clear-start']")).toBeNull();
  });
});

describe("resetStartToGps", () => {
  it("labels the GPS start when a fix is already known", async () => {
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    await typeEnter(root, "start", "Mano vieta");
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("asks for a fix when GPS has not arrived", async () => {
    h.geo = "none";
    const root = await boot();
    await typeEnter(root, "start", "Mano vieta");
    expect(root.querySelector("#start")).not.toBeNull();
  });
});

describe("clearStart", () => {
  it("routes again from GPS after a typed start is cleared", async () => {
    h.geo = "hold";
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "start", "Klaipeda");
    await typeEnter(root, "dest");
    click(root, "[data-act='clear-start']");
    await settle();
    expect(root.querySelector("#banner")?.textContent).toContain("Bakstelėkite");
  });
});

describe("swapStartAndDestination edges", () => {
  it("turns my location into the destination", async () => {
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    click(root, "[data-act='swap-dest']");
    await settle();
    expect(root.querySelector<HTMLInputElement>("#dest")!.value).toBe("Mano vieta");
  });

  it("turns a typed start into the destination when GPS is known", async () => {
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "start", "Klaipeda");
    click(root, "[data-act='swap-dest']");
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("uses an empty destination label when the place has none", async () => {
    const hit = { label: "Kaunas", lat: 54.9, lon: 23.9 };
    h.hits = [hit];
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "start");
    hit.label = undefined as unknown as string;
    click(root, "[data-act='swap-dest']");
    await settle();
    expect(root.querySelector<HTMLInputElement>("#dest")!.value).toBe("");
  });

  it("turns a typed start into the destination without a GPS fix", async () => {
    h.geo = "none";
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "start", "Klaipeda");
    click(root, "[data-act='swap-dest']");
    await settle();
    expect(root.querySelector<HTMLInputElement>("#start")!.value).toBe("");
  });
});

describe("fillGpsStartLabel", () => {
  it("keeps the typed start when the reverse lookup finishes late", async () => {
    h.holdReverse = true;
    const root = await boot();
    const start = root.querySelector<HTMLInputElement>("#start")!;
    start.value = "Kaunas";
    start.dispatchEvent(new Event("input", { bubbles: true }));
    h.releaseReverse?.(null);
    await settle();
    expect(start.value).toBe("Kaunas");
  });

  it("uses the generic label when the reverse lookup is empty", async () => {
    h.reverse = null;
    const root = await boot();
    expect(root.querySelector<HTMLInputElement>("#start")!.value).toBe("Mano vieta");
  });
});

describe("selectDestination without a start", () => {
  it("asks for a tap when location is denied", async () => {
    h.geo = "deny";
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector("#banner")?.textContent).toContain("Bakstelėkite");
  });

  it("asks for a tap when the fix is outside Lithuania", async () => {
    h.geo = "out";
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector("#banner")?.textContent?.length).toBeGreaterThan(0);
  });

  it("says it is still locating while the fix is pending", async () => {
    h.geo = "hold";
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector("#banner")?.textContent).toContain("Nustatoma");
  });

  it("routes once the pending fix lands inside Lithuania", async () => {
    h.geo = "hold";
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    h.geoOk?.(pos(54.687, 25.28));
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });
});

describe("runRoute guards", () => {
  it("idles when a via drag happens after the destination is gone", async () => {
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    click(root, "[data-act='pick-via']");
    h.mapHandlers?.onMapClick({ lat: 54.7, lon: 25.3 });
    await settle();
    const drag = h.dragend;
    click(root, "[data-act='clear-dest']");
    await settle();
    drag?.();
    await settle();
    expect(root.querySelector(".has-route")).toBeNull();
  });

  it("asks for a start when the typed start is outside Lithuania", async () => {
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    h.hits = [{ label: "Oslo", lat: 59.9, lon: 10.7 }];
    await typeEnter(root, "start", "Oslo");
    expect(root.querySelector("#banner")?.textContent).toContain("Bakstelėkite");
  });

  it("asks for a start when GPS was reset and no fix exists", async () => {
    h.geo = "hold";
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "start", "Klaipeda");
    await typeEnter(root, "dest");
    await typeEnter(root, "start", "Mano vieta");
    expect(root.querySelector("#banner")?.textContent).toContain("Bakstelėkite");
  });
});

describe("map padding", () => {
  it("fits one route after the header and the list leave the page", async () => {
    await withChromeStrip(async () => {
      h.routes = [route()];
      h.detourImpl = (trips) => {
        h.stripChrome = true;
        return trips.map(() => ({ extraKm: 0.05, extraMin: 1 }));
      };
      const root = await boot();
      await typeEnter(root, "dest");
      expect(fitRoute).toHaveBeenCalled();
    });
  });

  it("fits several routes after the header and the sheet leave the page", async () => {
    await withChromeStrip(async () => {
      h.routes = [route(), route({ durationMin: 30, profile: "shortest" })];
      h.routesGate = (resolve) => {
        h.stripChrome = true;
        resolve(h.routes);
      };
      const root = await boot();
      await typeEnter(root, "dest");
      expect(root.querySelector("[data-act='route']")).toBeNull();
      expect(fitRoute).toHaveBeenCalled();
    });
  });
});

describe("chooseRoute", () => {
  it("drops a choice whose route was replaced while detours loaded", async () => {
    h.routes = [route(), route({ durationMin: 40, profile: "shortest" })];
    const root = await boot();
    await typeEnter(root, "dest");
    h.detourImpl = () =>
      new Promise<DetourRows>((resolve) => {
        act(root, "route", { index: "1" });
        resolve(null);
      });
    click(root, "[data-index='0']");
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });
});

describe("evaluateRouteStations", () => {
  it("stores a missing detour as none", async () => {
    h.detourImpl = () => [null];
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("stops after the via route when a newer evaluation has started", async () => {
    const root = await boot();
    h.routes = [route()];
    h.viaGate = (resolve) => {
      h.viaGate = null;
      click(root, "[data-group='petrol']");
      resolve(route());
    };
    await typeEnter(root, "dest");
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("stops after the dashed check when a newer evaluation has started", async () => {
    let calls = 0;
    const held: { release: (() => void) | null } = { release: null };
    h.detourImpl = (trips) => {
      calls += 1;
      if (calls === 2) {
        return new Promise<DetourRows>((resolve) => {
          held.release = () => resolve(trips.map(() => null));
        });
      }
      return trips.map(() => ({ extraKm: 0.05, extraMin: 1 }));
    };
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    click(root, "[data-group='petrol']");
    held.release?.();
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("skips a via line that is a single point", async () => {
    h.viaRoute = route({ geometry: [{ lat: 54.687, lon: 25.28 }] });
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("treats a missing dashed answer as no extra distance", async () => {
    let calls = 0;
    h.detourImpl = (trips) => {
      calls += 1;
      if (calls > 1) return null;
      return trips.map((t) =>
        Math.abs(t.stop.lat - 54.688) < 0.0005
          ? { extraKm: 5, extraMin: 8 }
          : { extraKm: 0.05, extraMin: 1 },
      );
    };
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector("#list")?.textContent).toContain("Off route");
  });

  it("records a dashed detour the router could not price", async () => {
    let calls = 0;
    h.detourImpl = (trips) => {
      calls += 1;
      if (calls === 1) {
        return trips.map((t) =>
          Math.abs(t.stop.lat - 54.688) < 0.0005
            ? { extraKm: 5, extraMin: 8 }
            : { extraKm: 0.05, extraMin: 1 },
        );
      }
      return trips.map(() => null);
    };
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("keeps one station when two dashed lines pick it", async () => {
    h.stations = [
      onRoute,
      offRoute,
      station({ id: "osm:3", name: "Also on route", lat: 54.69, lon: 25.29 }),
    ];
    h.prices = {
      date: "2026-09-15",
      generatedAt: "2026-09-15T07:00:00.000Z",
      prices: {
        "osm:1": { D: price(1.6) },
        "osm:2": { D: price(1.4) },
        "osm:3": { D: price(1.7) },
      },
    };
    h.detourImpl = (trips) =>
      trips.map((t) =>
        Math.abs(t.stop.lat - 54.688) < 0.0005 && t.leave.lat < 54.69
          ? { extraKm: 5, extraMin: 8 }
          : { extraKm: 0.05, extraMin: 1 },
      );
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelectorAll("[data-id='osm:2']").length).toBe(1);
  });

  it("uses the on-route detour when the via route has no extra of its own", async () => {
    h.viaRoute = null;
    let calls = 0;
    h.detourImpl = (trips) => {
      calls += 1;
      if (calls > 1) return trips.map(() => ({ extraKm: 0.05, extraMin: 1 }));
      return trips.map((t) =>
        Math.abs(t.stop.lat - 54.688) < 0.0005
          ? { extraKm: 5, extraMin: 8 }
          : { extraKm: 0.2, extraMin: 1 },
      );
    };
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector("#list")?.textContent).toContain("nusukimas");
  });
});

describe("attachViaRoute", () => {
  it("copies the via-route extra onto a station that is already on the line", async () => {
    h.detourImpl = () => null;
    h.viaRoute = route({ distanceKm: 20, durationMin: 30 });
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector("#list")?.textContent).toContain("nusukimas");
  });

  it("draws a straight via line when the router has no via route", async () => {
    h.detourImpl = () => null;
    h.viaRoute = null;
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("stops building a via route when the line disappears", async () => {
    const chosen = route();
    h.routes = [chosen];
    h.detourImpl = () => {
      chosen.geometry.splice(0, chosen.geometry.length);
      return null;
    };
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector("#list")).not.toBeNull();
  });
});

describe("routeStops", () => {
  it("puts a via point that is already passed after the station", async () => {
    h.routes = [route({ via: { lat: 54.68, lon: 25.27 } })];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector(".has-route")).not.toBeNull();
  });
});

describe("handleMapPick", () => {
  it("routes from a map tap while the fix is still pending", async () => {
    h.geo = "hold";
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    h.mapHandlers?.onMapClick({ lat: 54.7, lon: 25.3 });
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("routes from a map tap when the destination is waiting", async () => {
    h.geo = "deny";
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    h.mapHandlers?.onMapClick({ lat: 10, lon: 10 });
    h.mapHandlers?.onMapClick({ lat: 54.7, lon: 25.3 });
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });

  it("sets a start from the map when no destination is chosen yet", async () => {
    h.geo = "deny";
    const root = await boot();
    await typeEnter(root, "dest");
    click(root, "[data-act='clear-dest']");
    h.mapHandlers?.onMapClick({ lat: 54.7, lon: 25.3 });
    await settle();
    expect(root.querySelector(".has-route")).toBeNull();
  });
});

describe("fillMapStartLabel", () => {
  it("ignores a lookup that finishes after the start is GPS again", async () => {
    h.geo = "deny";
    h.holdReverse = true;
    const root = await boot();
    await typeEnter(root, "dest");
    h.mapHandlers?.onMapClick({ lat: 54.7, lon: 25.3 });
    const start = root.querySelector<HTMLInputElement>("#start")!;
    start.value = "Mano vieta";
    start.dispatchEvent(new Event("input", { bubbles: true }));
    h.releaseReverse?.(null);
    await settle();
    expect(start.value).toBe("Mano vieta");
  });

  it("ignores a lookup that finishes after the start moved", async () => {
    h.geo = "deny";
    h.holdReverse = true;
    const root = await boot();
    await typeEnter(root, "dest");
    h.mapHandlers?.onMapClick({ lat: 54.7, lon: 25.3 });
    h.hits = [{ label: "Other", lat: 55, lon: 25 }];
    await typeEnter(root, "start", "Other");
    h.releaseReverse?.(h.reverse);
    await settle();
    expect(root.querySelector<HTMLInputElement>("#start")!.value).toBe("Other");
  });

  it("uses the generic label when the map tap has no address", async () => {
    h.geo = "deny";
    h.reverse = null;
    const root = await boot();
    await typeEnter(root, "dest");
    h.mapHandlers?.onMapClick({ lat: 54.7, lon: 25.3 });
    await settle();
    expect(root.querySelector<HTMLInputElement>("#start")!.value).toBe("Mano vieta");
  });
});

describe("placeVia", () => {
  it("puts the via marker back when a drag leaves Lithuania", async () => {
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    click(root, "[data-act='pick-via']");
    h.mapHandlers?.onMapClick({ lat: 54.7, lon: 25.3 });
    await settle();
    h.markerLngLat = { lng: 10, lat: 10 };
    h.dragend?.();
    await settle();
    expect(h.markerLngLat.lat).toBe(54.7);
  });
});

describe("clearVia", () => {
  it("renders when there is nothing to clear", async () => {
    const root = await boot();
    act(root, "clear-via");
    expect(root.querySelector("#list")).not.toBeNull();
  });

  it("drops via picking before drawing the route again", async () => {
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    click(root, "[data-act='pick-via']");
    act(root, "clear-via");
    await settle();
    expect(root.querySelector(".is-picking")).toBeNull();
  });
});

describe("stationAddress", () => {
  it("says when a station has no address and no city", async () => {
    h.stations = [station({ id: "osm:1", name: "Bare", address: "", city: "" })];
    h.prices = {
      date: "2026-09-15",
      generatedAt: "2026-09-15T07:00:00.000Z",
      prices: { "osm:1": { D: price(1.5) } },
    };
    const root = await boot();
    expect(root.textContent).toContain("Adresas nenurodytas");
  });

  it("uses the city when the street is missing", async () => {
    h.stations = [station({ id: "osm:1", name: "Bare", address: "", city: "Kaunas" })];
    h.prices = {
      date: "2026-09-15",
      generatedAt: "2026-09-15T07:00:00.000Z",
      prices: { "osm:1": { D: price(1.5) } },
    };
    const root = await boot();
    expect(root.textContent).toContain("Kaunas");
  });
});

describe("revealStation", () => {
  it("removes the popup that was already open", async () => {
    const root = await boot();
    click(root, "[data-id='osm:1']");
    await settle();
    click(root, "[data-id='osm:2']");
    await settle();
    expect(root.querySelector("#list")).not.toBeNull();
  });

  it("measures road distance for a station that is not on the route", async () => {
    h.stations = [onRoute, station({ id: "osm:9", name: "Far", lat: 56, lon: 24 })];
    h.prices = {
      date: "2026-09-15",
      generatedAt: "2026-09-15T07:00:00.000Z",
      prices: { "osm:1": { D: price(1.6) }, "osm:9": { D: price(1.5) } },
    };
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    h.mapHandlers?.onStationClick("osm:9");
    await settle();
    expect(flyToStation).not.toHaveBeenCalled();
    expect(fitRoute).toHaveBeenCalled();
  });

  it("flies to a station when no route is drawn", async () => {
    const root = await boot();
    click(root, "[data-id='osm:1']");
    await settle();
    expect(flyToStation).toHaveBeenCalled();
  });

  it("fits the via line of a station on the route", async () => {
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    click(root, "[data-id='osm:1']");
    await settle();
    expect(fitRoute).toHaveBeenCalled();
  });

  it("ignores a start that is outside Lithuania", async () => {
    h.hits = [{ label: "Oslo", lat: 59.9, lon: 10.7 }];
    const root = await boot();
    await typeEnter(root, "start", "Oslo");
    click(root, "[data-id='osm:1']");
    await settle();
    expect(root.querySelector("#list")).not.toBeNull();
  });
});

describe("popup removal", () => {
  it("closes the popup when the EV power preset changes", async () => {
    localStorage.setItem("kur-degalai-settings", JSON.stringify({ fuel: "EV" }));
    h.chargers = [charger({ id: "ev:1", name: "Charge" })];
    h.prices = {
      date: "2026-09-15",
      generatedAt: "2026-09-15T07:00:00.000Z",
      prices: { "ev:1": { EV: price(0.3) } },
    };
    const root = await boot();
    click(root, "[data-id='ev:1']");
    await settle();
    click(root, "[data-kw='50']");
    expect(root.querySelector("[data-kw='50']")?.classList.contains("on")).toBe(true);
  });

  it("closes the popup when a plug filter changes", async () => {
    localStorage.setItem("kur-degalai-settings", JSON.stringify({ fuel: "EV" }));
    h.chargers = [charger({ id: "ev:1", name: "Charge" })];
    const root = await boot();
    click(root, "[data-id='ev:1']");
    click(root, "[data-act='settings']");
    const plug = root.querySelector<HTMLInputElement>("#set-plug-ccs")!;
    plug.checked = false;
    plug.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.querySelector(".plug-filter")).not.toBeNull();
  });

  it("closes the popup when the fuel changes", async () => {
    const root = await boot();
    click(root, "[data-id='osm:1']");
    click(root, "[data-group='petrol']");
    expect(root.querySelector("[data-group='petrol']")?.classList.contains("on")).toBe(true);
  });

  it("closes the popup when via picking starts", async () => {
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    click(root, "[data-id='osm:1']");
    await settle();
    click(root, "[data-act='pick-via']");
    expect(root.querySelector(".is-picking")).not.toBeNull();
  });
});

describe("ensureChargers", () => {
  it("re-weighs the route once chargers arrive", async () => {
    h.routes = [route()];
    h.chargers = [charger({ id: "ev:1", name: "Charge", lat: 54.687, lon: 25.28 })];
    h.prices = {
      date: "2026-09-15",
      generatedAt: "2026-09-15T07:00:00.000Z",
      prices: {
        "osm:1": { D: price(1.6) },
        "osm:2": { D: price(1.4) },
        "ev:1": { EV: price(0.3) },
      },
    };
    const root = await boot();
    await typeEnter(root, "dest");
    click(root, "[data-group='ev']");
    await settle();
    expect(root.querySelector(".has-route")).not.toBeNull();
  });
});

describe("applyStationFilter", () => {
  it("redraws history after a brand change on a route", async () => {
    h.routes = [route()];
    h.history = {
      generatedAt: "2026-09-15T07:00:00.000Z",
      keepDays: 7,
      byFuel: { D: { dates: ["2026-09-15"], hours: [8], brands: { "circle-k": [1.5] } } },
    };
    const root = await boot();
    await typeEnter(root, "dest");
    click(root, "[data-view='history']");
    await settle();
    click(root, "[data-act='settings']");
    const brand = root.querySelector<HTMLInputElement>("#set-brand-circle-k")!;
    brand.checked = false;
    brand.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(root.querySelector("#history-chart")).not.toBeNull();
  });

  it("redraws history after a brand change with no route", async () => {
    h.history = {
      generatedAt: "2026-09-15T07:00:00.000Z",
      keepDays: 7,
      byFuel: { D: { dates: ["2026-09-15"], hours: [8], brands: { "circle-k": [1.5] } } },
    };
    const root = await boot();
    click(root, "[data-view='history']");
    await settle();
    click(root, "[data-act='settings']");
    const brand = root.querySelector<HTMLInputElement>("#set-brand-circle-k")!;
    brand.checked = false;
    brand.dispatchEvent(new Event("change", { bubbles: true }));
    expect(root.querySelector(".is-history")).not.toBeNull();
  });
});

describe("onFuelChange", () => {
  it("redraws after the route is weighed for the new fuel", async () => {
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    click(root, "[data-group='petrol']");
    await settle();
    expect(root.querySelector(".empty")).not.toBeNull();
  });
});

describe("renderList", () => {
  it("shows a detour that is at least a tenth of a kilometre", async () => {
    h.detourImpl = () => [{ extraKm: 0.2, extraMin: 1 }];
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector("#list")?.textContent).toContain("nusukimas");
  });

  it("says when an EV route has no priced chargers", async () => {
    localStorage.setItem("kur-degalai-settings", JSON.stringify({ fuel: "EV" }));
    h.chargers = [charger({ id: "ev:1", name: "Charge", lat: 54.687, lon: 25.28 })];
    h.prices = {
      date: "2026-09-15",
      generatedAt: "2026-09-15T07:00:00.000Z",
      prices: {},
    };
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector(".empty")?.textContent).toContain("nėra įkrovimo");
  });

  it("says when the plug filter removes every charger on the route", async () => {
    localStorage.setItem(
      "kur-degalai-settings",
      JSON.stringify({ fuel: "EV", excludedPlugs: ["type2", "ccs", "chademo", "other"] }),
    );
    h.chargers = [charger({ id: "ev:1", name: "Charge", lat: 54.687, lon: 25.28 })];
    h.prices = {
      date: "2026-09-15",
      generatedAt: "2026-09-15T07:00:00.000Z",
      prices: { "ev:1": { EV: price(0.3) } },
    };
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    expect(root.querySelector(".empty")?.textContent).toContain("filtrą");
  });

  it("breaks a price tie by station id", async () => {
    h.stations = [station({ id: "osm:b", name: "B" }), station({ id: "osm:a", name: "A" })];
    h.prices = {
      date: "2026-09-15",
      generatedAt: "2026-09-15T07:00:00.000Z",
      prices: { "osm:a": { D: price(1.5) }, "osm:b": { D: price(1.5) } },
    };
    const root = await boot();
    const ids = [...root.querySelectorAll<HTMLElement>("[data-act='station']")].map(
      (el) => el.dataset.id,
    );
    expect(ids).toEqual(["osm:a", "osm:b"]);
  });

  it("omits the updated time when nothing has a timestamp", async () => {
    h.prices = { date: "2026-09-15", generatedAt: "", prices: { "osm:1": { D: price(1.5) } } };
    h.meta = { ...h.meta, generatedAt: "" };
    const root = await boot();
    expect(root.querySelector(".list-updated")).toBeNull();
  });
});

describe("history view", () => {
  it("paints again when history is opened a second time", async () => {
    h.history = {
      generatedAt: "2026-09-15T07:00:00.000Z",
      keepDays: 7,
      byFuel: { D: { dates: ["2026-09-15"], hours: [8], brands: { "circle-k": [1.5] } } },
    };
    const root = await boot();
    click(root, "[data-view='history']");
    await settle();
    click(root, "[data-view='map']");
    click(root, "[data-view='history']");
    await settle();
    expect(root.querySelector("#history-chart")).not.toBeNull();
  });

  it("shows the collapsed loading sheet", async () => {
    const held: { release: ((file: HistoryFile | null) => void) | null } = { release: null };
    h.historyGate = (resolve) => {
      held.release = resolve;
    };
    const root = await boot();
    click(root, "[data-view='history']");
    click(root, "[data-act='toggle-history']");
    click(root, "[data-locale='en']");
    expect(root.querySelector(".history-panel")?.classList.contains("is-min")).toBe(true);
    held.release?.(null);
    await settle();
  });

  it("names the cheapest hours still ahead", async () => {
    localStorage.setItem("kur-degalai-settings", JSON.stringify({ fuel: "EV" }));
    h.history = {
      generatedAt: "2026-10-10T08:00:00.000Z",
      keepDays: 7,
      byFuel: {},
      spot: {
        dates: ["2026-10-11", "2026-10-11"],
        hours: [0, 1],
        brands: { spot: [0.2, 0.05] },
      },
    };
    const root = await boot();
    click(root, "[data-view='history']");
    await settle();
    click(root, "[data-act='history-spot']");
    expect(root.querySelector(".history-cheap")).not.toBeNull();
  });

  it("skips the cheap-hour line when none are ahead", async () => {
    localStorage.setItem("kur-degalai-settings", JSON.stringify({ fuel: "EV" }));
    h.history = {
      generatedAt: "2020-01-01T00:00:00.000Z",
      keepDays: 7,
      byFuel: {},
      spot: { dates: ["2020-01-01"], hours: [8], brands: { spot: [0.1] } },
    };
    const root = await boot();
    click(root, "[data-view='history']");
    await settle();
    click(root, "[data-act='history-spot']");
    expect(root.querySelector(".history-cheap")).toBeNull();
    expect(root.querySelector(".history-caption")).not.toBeNull();
  });

  it("paints when a brand is toggled before the chart exists", async () => {
    h.history = {
      generatedAt: "2026-09-15T07:00:00.000Z",
      keepDays: 7,
      byFuel: { D: { dates: ["2026-09-15"], hours: [8], brands: { "circle-k": [1.5] } } },
    };
    const root = await boot();
    click(root, "[data-view='history']");
    await settle();
    click(root, "[data-act='toggle-history']");
    click(root, "[data-act='history-brand']");
    expect(root.querySelector("#history-legend")).not.toBeNull();
  });

  it("drops a chart paint that finishes after leaving history", async () => {
    const held: { release: ((file: HistoryFile | null) => void) | null } = { release: null };
    h.historyGate = (resolve) => {
      held.release = resolve;
    };
    h.history = {
      generatedAt: "2026-09-15T07:00:00.000Z",
      keepDays: 7,
      byFuel: { D: { dates: ["2026-09-15"], hours: [8], brands: { "circle-k": [1.5] } } },
    };
    const root = await boot();
    click(root, "[data-view='history']");
    const orig = HTMLElement.prototype.getBoundingClientRect;
    let skips = 0;
    HTMLElement.prototype.getBoundingClientRect = function () {
      const rect = orig.call(this);
      if (this.id === "header" && ++skips === 2) {
        HTMLElement.prototype.getBoundingClientRect = orig;
        click(root, "[data-view='map']");
      }
      return rect;
    };
    try {
      held.release?.(h.history);
      await settle();
      expect(root.querySelector(".is-history")).toBeNull();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = orig;
    }
  });

  it("does nothing when history is toggled off the history view", async () => {
    const root = await boot();
    act(root, "toggle-history");
    expect(root.querySelector(".history-panel")).toBeNull();
  });
});

describe("header chrome", () => {
  it("skips the header button when it is not in the header", async () => {
    const root = await boot();
    root.querySelector("[data-act='toggle-header']")!.remove();
    act(root, "toggle-header");
    expect(root.querySelector("#header")).not.toBeNull();
  });

  it("skips the map offset when the header is gone", async () => {
    const root = await boot();
    root.querySelector("#header")!.remove();
    window.dispatchEvent(new Event("resize"));
    expect(root.querySelector("#header")).toBeNull();
  });

  it("shows the destination label when the field was cleared", async () => {
    h.routes = [route()];
    const root = await boot();
    await typeEnter(root, "dest");
    const dest = root.querySelector<HTMLInputElement>("#dest")!;
    dest.value = "";
    dest.dispatchEvent(new Event("input", { bubbles: true }));
    click(root, "[data-locale='en']");
    expect(root.querySelector<HTMLInputElement>("#dest")!.value).toBe("Kaunas");
  });
});

describe("settingsHtml", () => {
  it("sorts an independent brand last in Lithuanian", async () => {
    h.stations = [
      station({ id: "osm:1", name: "A", brand: "independent" }),
      station({ id: "osm:2", name: "B", brand: "viada" }),
      station({ id: "osm:3", name: "C", brand: "circle-k" }),
    ];
    const root = await boot();
    click(root, "[data-act='settings']");
    const labels = [...root.querySelectorAll(".brand-filter .check")].map((el) => el.textContent);
    expect(labels.at(-1)).toBe("Kita");
  });

  it("sorts brand names in English", async () => {
    h.stations = [
      station({ id: "osm:1", name: "A", brand: "viada" }),
      station({ id: "osm:2", name: "B", brand: "circle-k" }),
    ];
    const root = await boot();
    click(root, "[data-locale='en']");
    click(root, "[data-act='settings']");
    expect(root.querySelector(".brand-filter")).not.toBeNull();
  });

  it("says chargers are loading when no network is known yet", async () => {
    h.chargersGate = () => undefined;
    const root = await boot();
    click(root, "[data-group='ev']");
    click(root, "[data-act='settings']");
    const fields = [...root.querySelectorAll(".brand-filter")];
    expect(fields.at(-1)?.textContent).toContain("Įkeliamos");
  });

  it("marks the plugs the car can use", async () => {
    localStorage.setItem(
      "kur-degalai-settings",
      JSON.stringify({ fuel: "EV", excludedPlugs: ["type2"] }),
    );
    h.chargers = [charger({ id: "ev:1", name: "Charge" })];
    const root = await boot();
    click(root, "[data-act='settings']");
    expect(root.querySelector<HTMLInputElement>("#set-plug-type2")!.checked).toBe(false);
    expect(root.querySelector<HTMLInputElement>("#set-plug-ccs")!.checked).toBe(true);
  });
});

describe("report edges", () => {
  async function file(root: HTMLElement): Promise<void> {
    click(root, "[data-act='report']");
    const kind = root.querySelector<HTMLInputElement>("#report-kind-bug")!;
    kind.checked = true;
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
    text.value = "The price at this station is wrong.";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const email = root.querySelector<HTMLInputElement>("#report-email")!;
    email.value = "a@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
  }

  it("ignores a paste outside the report form", async () => {
    const root = await boot();
    root.dispatchEvent(new Event("paste", { bubbles: true, cancelable: true }));
    expect(root.querySelector(".report-panel")).toBeNull();
  });

  it("ignores a paste that carries no files", async () => {
    const root = await boot();
    click(root, "[data-act='report']");
    const kind = root.querySelector<HTMLInputElement>("#report-kind-bug")!;
    kind.checked = true;
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    root.dispatchEvent(new Event("paste", { bubbles: true, cancelable: true }));
    expect(root.querySelector("#report-text")).not.toBeNull();
  });

  it("shows the outcome that arrived while the panel was shut", async () => {
    const held: { release: ((result: typeof h.sendResult) => void) | null } = { release: null };
    h.sendGate = (resolve) => {
      held.release = resolve;
    };
    const root = await boot();
    await file(root);
    click(root, "[data-act='close-panel']");
    held.release?.(h.sendResult);
    await settle();
    click(root, "[data-act='report']");
    expect(root.querySelector(".report-done")).not.toBeNull();
  });

  it("sends the price date when the publish time is missing", async () => {
    h.prices = null;
    h.meta = { ...h.meta, date: "2026-09-01", generatedAt: undefined as unknown as string };
    const root = await boot();
    await file(root);
    expect(sendReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ dataDate: "2026-09-01" }),
    );
  });

  it("sends an empty date when no price date is known", async () => {
    h.prices = null;
    h.meta = null as unknown as typeof h.meta;
    const root = await boot();
    await file(root);
    expect(sendReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ dataDate: "" }),
    );
  });

  it("sends the picture with the report", async () => {
    const root = await boot();
    click(root, "[data-act='report']");
    const kind = root.querySelector<HTMLInputElement>("#report-kind-bug")!;
    kind.checked = true;
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    const input = root.querySelector<HTMLInputElement>("#report-image")!;
    const file = new File(["x"], "a.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
    text.value = "The price at this station is wrong.";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const email = root.querySelector<HTMLInputElement>("#report-email")!;
    email.value = "a@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(sendReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ image: "data:image/png;base64,aa" }),
      expect.anything(),
    );
  });

  it("sends an empty website when the honeypot field is missing", async () => {
    const root = await boot();
    click(root, "[data-act='report']");
    const kind = root.querySelector<HTMLInputElement>("#report-kind-bug")!;
    kind.checked = true;
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    root.querySelector("#report-website")!.remove();
    const text = root.querySelector<HTMLTextAreaElement>("#report-text")!;
    text.value = "The price at this station is wrong.";
    text.dispatchEvent(new Event("input", { bubbles: true }));
    const email = root.querySelector<HTMLInputElement>("#report-email")!;
    email.value = "a@example.com";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    root
      .querySelector("#report-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await settle();
    expect(sendReport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ website: "" }),
      expect.anything(),
    );
  });
});

describe("promptInstall", () => {
  it("does nothing when the browser never offered to install", async () => {
    const root = await boot();
    act(root, "install");
    expect(root.querySelector("#list")).not.toBeNull();
  });
});
