import { describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n/index.ts";
import {
  freeReasonText,
  openListPadding,
  overlayPadding,
  percentile,
  stationPopupHtml,
  stationsForRouteMap,
  stationsInView,
  routeStationEmphasis,
  ROUTE_MARKER,
  socketLabels,
} from "../src/map.ts";
import type { Station } from "../src/types.ts";

const station: Station = {
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
    const html = stationPopupHtml(station, {
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
    const html = stationPopupHtml(station, {
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
      station,
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
      { ...station, name: "Kauno g. 10", address: "Kauno g. 10" },
      null,
    );
    expect(html.match(/Kauno g\. 10/g)).toHaveLength(1);
    expect(stationPopupHtml({ ...station, address: "Oslo g. 12" }, null)).toContain("Oslo g. 12");
  });
});

describe("charger popup", () => {
  const charger: Station = {
    ...station,
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
