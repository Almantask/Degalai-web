import { describe, expect, it } from "vitest";
import { swapEndpoints } from "../src/endpoints.ts";

const kaunas = { label: "Kaunas", lat: 54.9, lon: 23.9 };
const vilnius = { label: "Vilnius", lat: 54.687, lon: 25.28 };
const here = { lat: 54.68, lon: 25.27 };

describe("swapEndpoints", () => {
  it("swaps two places", () => {
    expect(
      swapEndpoints({ start: vilnius, end: kaunas, endIsHere: false }, here, "Mano vieta"),
    ).toEqual({
      start: kaunas,
      end: vilnius,
      endIsHere: false,
    });
  });

  it("turns my location into a fixed destination and back into the GPS start", () => {
    const swapped = swapEndpoints(
      { start: null, end: kaunas, endIsHere: false },
      here,
      "Mano vieta",
    );
    expect(swapped).toEqual({
      start: kaunas,
      end: { label: "Mano vieta", lat: 54.68, lon: 25.27 },
      endIsHere: true,
    });
    expect(swapEndpoints(swapped!, here, "Mano vieta")).toEqual({
      start: null,
      end: kaunas,
      endIsHere: false,
    });
  });

  it("moves a start typed into the wrong field to the destination", () => {
    expect(swapEndpoints({ start: kaunas, end: null, endIsHere: false }, null, "x")).toEqual({
      start: null,
      end: kaunas,
      endIsHere: false,
    });
  });

  it("is disabled when there is nothing to swap or my location is unknown", () => {
    expect(swapEndpoints({ start: null, end: null, endIsHere: false }, here, "x")).toBeNull();
    expect(swapEndpoints({ start: null, end: kaunas, endIsHere: false }, null, "x")).toBeNull();
    const bothHere = { start: null, end: { label: "x", ...here }, endIsHere: true };
    expect(swapEndpoints(bothHere, here, "x")).toBeNull();
  });
});
