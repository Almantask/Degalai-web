import { describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n/index.ts";
import {
  overlayPadding,
  stationPopupHtml,
  stationsForRouteMap,
  stationsInView,
  routeStationEmphasis,
  ROUTE_MARKER,
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
});
