import { describe, expect, it } from "vitest";
import { setLocale } from "../src/i18n/index.ts";
import { stationPopupHtml, stationsInView } from "../src/map.ts";
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

describe("stationPopupHtml", () => {
  it("shows last updated date and time", () => {
    setLocale("en");
    const html = stationPopupHtml(station, {
      date: "2026-09-11",
      generatedAt: "2026-09-12T19:09:22.245Z",
      prices: {},
    });
    expect(html).toContain("Updated:");
    expect(html).toContain("22:09");
    expect(html).not.toContain("Updated: 2026-09-11");
  });
});
