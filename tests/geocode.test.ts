import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  geocodePhoton,
  loadGeocodeCache,
  saveGeocodeCache,
  sleep,
  type GeocodeHit,
} from "../scripts/geocode.ts";

function hit(features: unknown): Response {
  return new Response(JSON.stringify({ features }), { status: 200 });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("loadGeocodeCache", () => {
  it("returns an empty map when the file is missing and reads stored hits", async () => {
    const dir = mkdtempSync(join(tmpdir(), "geocode-"));
    try {
      const path = join(dir, "cache.json");
      await expect(loadGeocodeCache(path)).resolves.toEqual(new Map());
      writeFileSync(path, JSON.stringify({ a: { lat: 54.6, lon: 25.2, label: "A" }, b: null }));
      const cache = await loadGeocodeCache(path);
      expect(cache.get("a")).toEqual({ lat: 54.6, lon: 25.2, label: "A" });
      expect(cache.get("b")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("saveGeocodeCache", () => {
  it("writes the map as pretty json, creating parent directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "geocode-"));
    try {
      const path = join(dir, "nested", "cache.json");
      const cache = new Map<string, GeocodeHit | null>([
        ["a", { lat: 54.6, lon: 25.2, label: "A" }],
        ["b", null],
      ]);
      saveGeocodeCache(path, cache);
      expect(readFileSync(path, "utf8")).toBe(
        `${JSON.stringify({ a: { lat: 54.6, lon: 25.2, label: "A" }, b: null }, null, 2)}\n`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("geocodePhoton", () => {
  it("asks Photon in Lithuanian and keeps the parts of the label that exist", async () => {
    let url = "";
    vi.stubGlobal("fetch", async (input: RequestInfo) => {
      url = String(input);
      return hit([
        {
          geometry: { coordinates: [25.28, 54.68] },
          properties: { name: "", street: "Gedimino pr.", city: "Vilnius" },
        },
      ]);
    });
    await expect(geocodePhoton("Gedimino")).resolves.toEqual({
      lat: 54.68,
      lon: 25.28,
      label: "Gedimino pr., Vilnius",
    });
    expect(new URL(url).searchParams.get("lang")).toBe("default");
  });

  it("asks Photon in English when lang is en", async () => {
    let url = "";
    vi.stubGlobal("fetch", async (input: RequestInfo) => {
      url = String(input);
      return hit([
        {
          geometry: { coordinates: [25.28, 54.68] },
          properties: { name: "Circle K", street: "Gedimino pr.", city: "Vilnius" },
        },
      ]);
    });
    await expect(geocodePhoton("Gedimino", "en")).resolves.toEqual({
      lat: 54.68,
      lon: 25.28,
      label: "Circle K, Gedimino pr., Vilnius",
    });
    expect(new URL(url).searchParams.get("lang")).toBe("en");
  });

  it("returns null when Photon has no feature", async () => {
    vi.stubGlobal("fetch", async () => hit([]));
    await expect(geocodePhoton("nowhere")).resolves.toBeNull();
    vi.stubGlobal("fetch", async () => hit(undefined));
    await expect(geocodePhoton("nowhere")).resolves.toBeNull();
  });

  it("returns null when Photon answers with an error", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 500 }));
    await expect(geocodePhoton("Kaunas")).resolves.toBeNull();
  });

  it("waits and retries after HTTP 429", async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      if (calls === 1) return new Response("", { status: 429 });
      return hit([
        {
          geometry: { coordinates: [23.9, 54.9] },
          properties: { name: "Orlen", city: "Kaunas" },
        },
      ]);
    });
    const pending = geocodePhoton("Kaunas", "lt", 1);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ lat: 54.9, lon: 23.9, label: "Orlen, Kaunas" });
    expect(calls).toBe(2);
  });

  it("returns null when the retry budget is already spent", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 429 }));
    await expect(geocodePhoton("Kaunas", "lt", 0)).resolves.toBeNull();
  });

  it("returns null when every retry is answered with 429", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async () => new Response("", { status: 429 }));
    const pending = geocodePhoton("Kaunas", "en", 2);
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBeNull();
  });
});

describe("sleep", () => {
  it("resolves after the delay", async () => {
    vi.useFakeTimers();
    let done = false;
    const pending = sleep(5000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(done).toBe(true);
  });
});
