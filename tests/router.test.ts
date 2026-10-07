import { describe, expect, it } from "vitest";
import { hrefFor, pathFor, viewFromPath } from "../src/router.ts";
import type { FuelType } from "../src/types.ts";

describe("hrefFor", () => {
  it("emits only allow-listed fuel query values", () => {
    expect(hrefFor("map", "lt", "D")).toMatch(/[?&]fuel=diesel$/);
    expect(hrefFor("map", "en", "LPG")).toMatch(/[?&]fuel=gas$/);
    expect(hrefFor("map", "lt", "95")).toMatch(/[?&]fuel=95$/);
    expect(hrefFor("history", "en", "EV")).toMatch(/\/en\/history\?fuel=ev$/);
  });

  it("adds the EV power preset, and only for EV", () => {
    expect(hrefFor("map", "lt", "EV", 50)).toMatch(/\?fuel=ev&kw=50$/);
    expect(hrefFor("map", "en", "EV", 150)).toMatch(/\/en\/\?fuel=ev&kw=150$/);
    expect(hrefFor("map", "lt", "EV", 0)).toMatch(/\?fuel=ev$/);
    expect(hrefFor("map", "lt", "D", 50)).toMatch(/\?fuel=diesel$/);
    expect(hrefFor("map", "lt", "EV", 75)).toMatch(/\?fuel=ev$/);
  });

  it("ignores unknown fuel values instead of interpolating them", () => {
    const href = hrefFor("map", "lt", `" onclick="alert(1)` as unknown as FuelType);
    expect(href).not.toMatch(/onclick/i);
    expect(href).not.toContain("fuel=");
  });
});

describe("viewFromPath", () => {
  it("maps Lithuanian and English history URLs", () => {
    expect(viewFromPath("/istorija")).toEqual({ view: "history", locale: "lt" });
    expect(viewFromPath("/en/history")).toEqual({ view: "history", locale: "en" });
    expect(viewFromPath("/en/history/")).toEqual({ view: "history", locale: "en" });
  });

  it("defaults other paths to the map", () => {
    expect(viewFromPath("/")).toEqual({ view: "map", locale: "lt" });
    expect(viewFromPath("/en")).toEqual({ view: "map", locale: "en" });
    expect(viewFromPath("/en/")).toEqual({ view: "map", locale: "en" });
  });
});

describe("pathFor", () => {
  it("emits locale-specific history paths", () => {
    expect(pathFor("history", "lt")).toMatch(/\/istorija$/);
    expect(pathFor("history", "en")).toMatch(/\/en\/history$/);
  });
});
