import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/types.ts";
import { fuelFromUrl, sanitizeSettings } from "../src/settings.ts";

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
        timeValue: 10,
        roadFactor: 1.5,
        aroundRadiusKm: 30,
        aroundReturn: false,
        routeDetourKm: 8,
        hideUnpriced: false,
        locale: "en",
      }),
    ).toEqual({
      fuel: "95",
      routePreference: "shortest",
      consumption: 8.5,
      litres: 30,
      timeValue: 10,
      roadFactor: 1.5,
      aroundRadiusKm: 30,
      aroundReturn: false,
      routeDetourKm: 8,
      hideUnpriced: false,
      locale: "en",
    });
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

  it("clamps numbers to the settings form range", () => {
    expect(sanitizeSettings({ consumption: 100, litres: 1, timeValue: -4 }).consumption).toBe(20);
    expect(sanitizeSettings({ litres: 1 }).litres).toBe(5);
    expect(sanitizeSettings({ timeValue: -4 }).timeValue).toBe(0);
  });
});

describe("fuelFromUrl", () => {
  it("maps known aliases and rejects other query values", () => {
    expect(fuelFromUrl("?fuel=diesel")).toBe("D");
    expect(fuelFromUrl("?fuel=gas")).toBe("LPG");
    expect(fuelFromUrl(`?fuel=" onclick="alert(1)`)).toBeNull();
  });
});
