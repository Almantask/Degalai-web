import { afterEach, describe, expect, it, vi } from "vitest";
import { inLithuania } from "../../src/geo.ts";
import { MAP_STYLE_URL } from "../../src/map.ts";
import { REPORT_ENDPOINT, sendReport } from "../../src/report.ts";
import { detourWindow } from "../../src/route-list.ts";
import {
  fetchDetours,
  fetchRoute,
  fetchRoutes,
  geocode,
  reverseGeocode,
} from "../../src/routing.ts";
import { reportOrigins } from "./repo.ts";

// Live: each service the browser app calls still answers the way the app reads it.

const vilnius = { lat: 54.6872, lon: 25.2797 };
const kaunas = { lat: 54.8985, lon: 23.9036 };
/** By the A1 between them. */
const elektrenai = { lat: 54.7856, lon: 24.6676 };
const trakai = { lat: 54.6378, lon: 24.9343 };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OpenFreeMap", () => {
  it("serves the map style and vector tiles over Lithuania", async () => {
    const res = await fetch(MAP_STYLE_URL);
    expect(res.ok).toBe(true);
    const style = (await res.json()) as {
      layers: unknown[];
      glyphs?: string;
      sources: Record<string, { type: string; url?: string }>;
    };
    expect(style.layers.length).toBeGreaterThan(0);
    expect(style.glyphs).toMatch(/^https:\/\//);
    const vector = Object.values(style.sources).filter((s) => s.type === "vector" && s.url);
    expect(vector).not.toEqual([]);
    for (const source of vector) {
      const tileJson = (await (await fetch(source.url!)).json()) as { tiles: string[] };
      // Zoom 7 tile with central Lithuania in it.
      const tile = await fetch(
        tileJson.tiles[0].replace("{z}", "7").replace("{x}", "72").replace("{y}", "40"),
      );
      expect(tile.ok, source.url).toBe(true);
      expect((await tile.arrayBuffer()).byteLength).toBeGreaterThan(0);
    }
  });
});

describe("Photon (search)", () => {
  it("finds a destination in Lithuania", async () => {
    const hits = await geocode("Kaunas", "lt");
    expect(hits).not.toEqual([]);
    expect(hits.every(inLithuania)).toBe(true);
  });

  it("names a point tapped on the map", async () => {
    expect(await reverseGeocode(vilnius, "en")).not.toBeNull();
  });
});

describe("OSRM (routing)", () => {
  it("offers the route to pick from", async () => {
    vi.stubEnv("VITE_ORS_KEY", "");
    const routes = await fetchRoutes(vilnius, kaunas, "fastest");
    expect(routes).not.toEqual([]);
    expect(routes[0].profile).toBe("fastest");
    expect(routes[0].distanceKm).toBeGreaterThan(80);
  });

  it("routes through a stop reached on the driver's side", async () => {
    vi.stubEnv("VITE_ORS_KEY", "");
    const route = await fetchRoute(vilnius, kaunas, "fastest", [{ ...elektrenai, curb: true }]);
    expect(route).not.toBeNull();
    expect(route!.distanceKm).toBeGreaterThan(80);
    expect(route!.geometry.length).toBeGreaterThan(10);
  });

  it("routes through a point placed on the map", async () => {
    vi.stubEnv("VITE_ORS_KEY", "");
    const routes = await fetchRoutes(vilnius, kaunas, "fastest", trakai);
    expect(routes).toHaveLength(1);
    expect(routes[0].via).toEqual(trakai);
    expect(routes[0].distanceKm).toBeGreaterThan(80);
  });

  it("measures detours off the route with the table service", async () => {
    vi.stubEnv("VITE_ORS_KEY", "");
    const [route] = await fetchRoutes(vilnius, kaunas, "fastest");
    expect(route).toBeDefined();
    // As the app does: leave the route before the stop and rejoin it after.
    const trips = [elektrenai, trakai].map((stop) => {
      const { leave, rejoin } = detourWindow(route.geometry, stop);
      return { leave, stop, rejoin };
    });
    const detours = await fetchDetours(trips);
    expect(detours).not.toBeNull();
    expect(detours!.every((d) => d !== null)).toBe(true);
  });
});

describe("cron worker feedback endpoint (REPORT_ENDPOINT)", () => {
  const origin = reportOrigins()[0];

  it("answers the browser's preflight from the site's origin", async () => {
    const res = await fetch(REPORT_ENDPOINT, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("takes a report sent by the site", async () => {
    // A browser adds the page's Origin; Node's fetch does not.
    const fromSite: typeof fetch = (input, init) =>
      fetch(input, { ...init, headers: { ...(init?.headers as object), Origin: origin } });
    // The hidden honeypot field is filled in, so the worker answers as if it filed the report
    // and files nothing.
    const result = await sendReport(
      REPORT_ENDPOINT,
      {
        category: "bug",
        description: "Dependency test, dropped by the worker.",
        email: "dependency-test@example.com",
        website: "test",
      },
      {
        page: "/",
        locale: "en",
        fuel: "D",
        dataDate: "",
        userAgent: "kur-degalai-deps",
        viewport: "",
      },
      fromSite,
    );
    expect(result).toEqual({ ok: true });
  });
});
