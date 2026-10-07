import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import {
  excludedFor,
  fuelFromUrl,
  fuelToUrl,
  isBrandIncluded,
  locationPositionOptions,
  minKwFromUrl,
  sanitizeSettings,
  uniqueBrands,
} from "../src/settings.ts";

describe("sanitizeSettings", () => {
  it("returns defaults for missing or invalid input", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid values", () => {
    expect(
      sanitizeSettings({
        fuel: "95",
        routePreference: "shortest",
        consumption: 8.5,
        litres: 30,
        evConsumption: 19,
        evKwh: 45,
        timeValue: 10,
        roadFactor: 1.5,
        aroundRadiusKm: 30,
        aroundReturn: false,
        maxDetourKm: 2.5,
        hideUnpriced: false,
        highAccuracyLocation: false,
        excludedBrands: ["viada"],
        excludedEvBrands: ["in-balance-grid"],
        excludedPlugs: ["chademo"],
        evMinKw: 50,
        locale: "en",
      }),
    ).toEqual({
      fuel: "95",
      routePreference: "shortest",
      consumption: 8.5,
      litres: 30,
      evConsumption: 19,
      evKwh: 45,
      timeValue: 10,
      roadFactor: 1.5,
      aroundRadiusKm: 30,
      aroundReturn: false,
      maxDetourKm: 2.5,
      hideUnpriced: false,
      highAccuracyLocation: false,
      excludedBrands: ["viada"],
      excludedEvBrands: ["in-balance-grid"],
      excludedPlugs: ["chademo"],
      evMinKw: 50,
      historyStat: "avg",
      locale: "en",
    });
  });

  it("keeps the fuel and EV provider filters apart", () => {
    const s = sanitizeSettings({ excludedBrands: ["independent"], excludedEvBrands: ["bad id!"] });
    expect(s.excludedBrands).toEqual(["independent"]);
    expect(s.excludedEvBrands).toEqual([]);
    expect(excludedFor({ ...s, fuel: "EV" })).toBe(s.excludedEvBrands);
    expect(excludedFor({ ...s, fuel: "D" })).toBe(s.excludedBrands);
  });

  it("keeps EV fuel and clamps EV consumption and charge size", () => {
    const s = sanitizeSettings({ fuel: "EV", evConsumption: 200, evKwh: -3 });
    expect(s.fuel).toBe("EV");
    expect(s.evConsumption).toBe(40);
    expect(s.evKwh).toBe(5);
    expect(sanitizeSettings({}).evConsumption).toBe(17);
  });

  it("keeps known plugs once in a fixed order and only the offered power presets", () => {
    expect(sanitizeSettings({}).excludedPlugs).toEqual([]);
    expect(
      sanitizeSettings({ excludedPlugs: ["other", "type2", "type2", "<b>", 3] }).excludedPlugs,
    ).toEqual(["type2", "other"]);
    expect(sanitizeSettings({ excludedPlugs: "ccs" }).excludedPlugs).toEqual([]);
    expect(sanitizeSettings({}).evMinKw).toBe(0);
    expect(sanitizeSettings({ evMinKw: 150 }).evMinKw).toBe(150);
    expect(sanitizeSettings({ evMinKw: "50" }).evMinKw).toBe(50);
    expect(sanitizeSettings({ evMinKw: 75 }).evMinKw).toBe(0);
  });

  it("defaults the on-the-way detour to 1 km and keeps it between 0.1 and 4 km", () => {
    expect(sanitizeSettings({}).maxDetourKm).toBe(1);
    expect(sanitizeSettings({ maxDetourKm: "0.5" }).maxDetourKm).toBe(0.5);
    expect(sanitizeSettings({ maxDetourKm: 0 }).maxDetourKm).toBe(0.1);
    expect(sanitizeSettings({ maxDetourKm: 40 }).maxDetourKm).toBe(4);
    // The old, never used corridor setting does not carry over.
    expect(sanitizeSettings({ routeDetourKm: 5 })).not.toHaveProperty("routeDetourKm");
  });

  it("defaults high-accuracy location to on", () => {
    expect(sanitizeSettings({}).highAccuracyLocation).toBe(true);
    expect(sanitizeSettings({ highAccuracyLocation: true }).highAccuracyLocation).toBe(true);
    expect(sanitizeSettings({ highAccuracyLocation: false }).highAccuracyLocation).toBe(false);
    expect(sanitizeSettings({ highAccuracyLocation: "yes" }).highAccuracyLocation).toBe(true);
  });

  it("drops HTML and unknown fields from localStorage payloads", () => {
    const sanitized = sanitizeSettings({
      fuel: `D" onclick="alert(1)`,
      consumption: `<img src=x onerror=alert(1)>`,
      litres: "40",
      aroundRadiusKm: 99,
      extra: "<script>alert(1)</script>",
      locale: "fr",
    });
    expect(sanitized.fuel).toBe(DEFAULT_SETTINGS.fuel);
    expect(sanitized.consumption).toBe(DEFAULT_SETTINGS.consumption);
    expect(sanitized.litres).toBe(40);
    expect(sanitized.aroundRadiusKm).toBe(DEFAULT_SETTINGS.aroundRadiusKm);
    expect(sanitized.locale).toBeUndefined();
    expect(sanitized).not.toHaveProperty("extra");
  });

  it("treats missing providers as all included", () => {
    expect(sanitizeSettings({}).excludedBrands).toEqual([]);
    expect(
      sanitizeSettings({ excludedBrands: ["neste", "neste", "<b>", ""] }).excludedBrands,
    ).toEqual(["neste"]);
  });

  it("keeps a valid history statistic and defaults the rest", () => {
    expect(sanitizeSettings({}).historyStat).toBe("avg");
    expect(sanitizeSettings({ historyStat: "median" }).historyStat).toBe("median");
    expect(sanitizeSettings({ historyStat: "nope" }).historyStat).toBe("avg");
  });

  it("clamps numbers to the settings form range", () => {
    expect(sanitizeSettings({ consumption: 100, litres: 1, timeValue: -4 }).consumption).toBe(20);
    expect(sanitizeSettings({ litres: 1 }).litres).toBe(5);
    expect(sanitizeSettings({ timeValue: -4 }).timeValue).toBe(0);
  });
});

describe("isBrandIncluded", () => {
  it("includes every brand when nothing is excluded", () => {
    expect(isBrandIncluded("neste", [])).toBe(true);
    expect(isBrandIncluded("independent", [])).toBe(true);
  });

  it("hides only the excluded providers", () => {
    expect(isBrandIncluded("viada", ["viada"])).toBe(false);
    expect(isBrandIncluded("neste", ["viada"])).toBe(true);
  });
});

describe("uniqueBrands", () => {
  it("lists each provider once", () => {
    expect(
      uniqueBrands([
        { id: "a", name: "A", brand: "neste", lat: 1, lon: 1, fuels: ["D"], sourceIds: {} },
        { id: "b", name: "B", brand: "neste", lat: 1, lon: 1, fuels: ["D"], sourceIds: {} },
        { id: "c", name: "C", brand: "viada", lat: 1, lon: 1, fuels: ["D"], sourceIds: {} },
      ]),
    ).toEqual(["neste", "viada"]);
  });
});

describe("locationPositionOptions", () => {
  it("passes enableHighAccuracy through to the browser geolocation API", () => {
    expect(locationPositionOptions(true).enableHighAccuracy).toBe(true);
    expect(locationPositionOptions(false).enableHighAccuracy).toBe(false);
    expect(locationPositionOptions(false).timeout).toBe(8000);
    expect(locationPositionOptions(true).maximumAge).toBe(60_000);
  });
});

describe("fuelFromUrl", () => {
  it("maps known aliases and rejects other query values", () => {
    expect(fuelFromUrl("?fuel=diesel")).toBe("D");
    expect(fuelFromUrl("?fuel=gas")).toBe("LPG");
    expect(fuelFromUrl("?fuel=ev")).toBe("EV");
    expect(fuelToUrl("EV")).toBe("ev");
    expect(fuelFromUrl(`?fuel=" onclick="alert(1)`)).toBeNull();
  });
});

describe("minKwFromUrl", () => {
  it("reads the 50 and 150 kW presets and treats anything else as any power", () => {
    expect(minKwFromUrl("?fuel=ev&kw=50")).toBe(50);
    expect(minKwFromUrl("?fuel=ev&kw=150")).toBe(150);
    expect(minKwFromUrl("?fuel=ev")).toBe(0);
    expect(minKwFromUrl("?fuel=ev&kw=75")).toBe(0);
    expect(minKwFromUrl(`?kw=" onclick="alert(1)`)).toBe(0);
  });
});
