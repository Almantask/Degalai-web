// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { getLocale } from "../src/i18n/index.ts";
import {
  appendQuery,
  basePath,
  detectInitialLocale,
  hrefFor,
  navigate,
  parsePath,
  pathFor,
  stripBase,
  viewFromPath,
} from "../src/router.ts";
import { loadSettings } from "../src/settings.ts";
import type { FuelType } from "../src/types.ts";

describe("hrefFor", () => {
  it("emits only allow-listed fuel query values", () => {
    expect(hrefFor("map", "en")).toMatch(/\/en\/$/);
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
    expect(pathFor("map")).toBe("/");
  });
});

describe("basePath", () => {
  it("drops a trailing slash and treats an empty base as the root", () => {
    expect(basePath()).toBe("");
    expect(basePath("")).toBe("");
    expect(basePath("/")).toBe("");
    expect(basePath("/Degalai-web")).toBe("/Degalai-web");
    expect(basePath("/Degalai-web/")).toBe("/Degalai-web");
  });
});

describe("stripBase", () => {
  it("removes a known base and leaves other paths alone", () => {
    expect(stripBase("/en/history")).toBe("/en/history");
    expect(stripBase("/Degalai-web/en/history", "/Degalai-web")).toBe("/en/history");
    expect(stripBase("/Degalai-web", "/Degalai-web")).toBe("/");
    expect(stripBase("/other", "/Degalai-web")).toBe("/other");
  });
});

describe("appendQuery", () => {
  it("uses & when the path already has a query", () => {
    expect(appendQuery("/en/", "")).toBe("/en/");
    expect(appendQuery("/en/?x=1", "fuel=ev")).toBe("/en/?x=1&fuel=ev");
    expect(appendQuery("/en/", "fuel=ev")).toBe("/en/?fuel=ev");
  });
});

describe("parsePath", () => {
  it("reads the view, locale and fuel from the address bar", () => {
    window.history.pushState({}, "", "/en/history?fuel=ev");
    expect(parsePath()).toEqual({ view: "history", locale: "en", fuelQuery: "ev" });
    window.history.pushState({}, "", "/istorija");
    expect(parsePath()).toEqual({ view: "history", locale: "lt", fuelQuery: null });
  });
});

describe("navigate", () => {
  it("pushes or replaces the history entry and stores the locale", () => {
    const push = vi.spyOn(window.history, "pushState");
    const replace = vi.spyOn(window.history, "replaceState");
    navigate("history", "en", "EV", false, 50);
    expect(push).toHaveBeenCalled();
    expect(window.location.pathname).toMatch(/\/en\/history$/);
    expect(window.location.search).toBe("?fuel=ev&kw=50");
    expect(getLocale()).toBe("en");
    expect(loadSettings().locale).toBe("en");

    navigate("map", "lt", "D", true);
    expect(replace).toHaveBeenCalled();
    expect(window.location.search).toBe("?fuel=diesel");
    expect(loadSettings().locale).toBe("lt");
    push.mockRestore();
    replace.mockRestore();
  });
});

describe("detectInitialLocale", () => {
  it("uses the saved locale or the browser language on the home path", () => {
    window.history.pushState({}, "", "/en/history");
    expect(detectInitialLocale("lt")).toBe("en");

    window.history.pushState({}, "", "/");
    expect(detectInitialLocale("en")).toBe("en");

    Object.defineProperty(navigator, "language", { value: "lt-LT", configurable: true });
    expect(detectInitialLocale()).toBe("lt");
    Object.defineProperty(navigator, "language", { value: "en-GB", configurable: true });
    expect(detectInitialLocale()).toBe("en");

    window.history.pushState({}, "", "/istorija");
    expect(detectInitialLocale()).toBe("lt");
  });
});
