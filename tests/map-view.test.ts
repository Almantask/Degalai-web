import { describe, expect, it } from "vitest";
import { stationsInView } from "../src/map.ts";

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
