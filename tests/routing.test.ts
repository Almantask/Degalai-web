import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detoursFromTable,
  fetchDetours,
  fetchRoute,
  fetchRoutes,
  geocode,
  reverseGeocode,
} from "../src/routing.ts";

const start = { lat: 54.8987, lon: 23.9118 };
const end = { lat: 54.9045, lon: 23.9764 };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("detoursFromTable", () => {
  it("compares leave → stop → rejoin with leave → rejoin", () => {
    // Sources: leave 0, leave 1, stop 0, stop 1. Destinations: stop 0, stop 1, rejoin 0, rejoin 1.
    const detours = detoursFromTable(
      {
        code: "Ok",
        distances: [
          [1000, 0, 2000, 0],
          [0, 2600, 0, 2000],
          [0, 0, 1050, 0],
          [0, 0, 0, 2800],
        ],
        durations: [
          [80, 0, 150, 0],
          [0, 200, 0, 150],
          [0, 0, 100, 0],
          [0, 0, 0, 250],
        ],
      },
      2,
    );
    expect(detours?.[0]?.extraKm).toBeCloseTo(0.05);
    expect(detours?.[0]?.extraMin).toBeCloseTo(0.5);
    expect(detours?.[1]?.extraKm).toBeCloseTo(3.4);
    expect(detours?.[1]?.extraMin).toBeCloseTo(5);
  });

  it("marks an unreachable stop and never reports a negative detour", () => {
    const detours = detoursFromTable(
      {
        code: "Ok",
        distances: [
          [null, 0, 2000, 0],
          [0, 900, 0, 2000],
          [0, 0, 0, 0],
          [0, 0, 0, 1000],
        ],
        durations: [
          [null, 0, 150, 0],
          [0, 70, 0, 150],
          [0, 0, 0, 0],
          [0, 0, 0, 75],
        ],
      },
      2,
    );
    expect(detours?.[0]).toBeNull();
    expect(detours?.[1]).toEqual({ extraKm: 0, extraMin: 0 });
  });

  it("rejects an error or a table without distances", () => {
    expect(detoursFromTable({ code: "TooBig" }, 1)).toBeNull();
    expect(detoursFromTable({ code: "Ok", durations: [[1, 2]] }, 1)).toBeNull();
    expect(detoursFromTable({ code: "Ok", distances: [[1, 2]] }, 1)).toBeNull();
  });

  it("returns null when a stop's direct leg is missing", () => {
    const table = (
      durations: Array<Array<number | null>>,
      distances: Array<Array<number | null>>,
    ) => detoursFromTable({ code: "Ok", durations, distances }, 1);
    expect(
      table(
        [
          [60, 10],
          [0, 80],
        ],
        [
          [null, 10],
          [0, 1500],
        ],
      ),
    ).toEqual([null]);
    expect(
      table(
        [
          [60, 10],
          [0, null],
        ],
        [
          [1000, 10],
          [0, 1500],
        ],
      ),
    ).toEqual([null]);
    expect(
      table(
        [
          [60, 10],
          [0, 80],
        ],
        [
          [1000, 10],
          [0, null],
        ],
      ),
    ).toEqual([null]);
    expect(
      table(
        [
          [60, null],
          [0, 80],
        ],
        [
          [1000, 2000],
          [0, 1500],
        ],
      ),
    ).toEqual([null]);
    expect(
      table(
        [
          [60, 100],
          [0, 80],
        ],
        [
          [1000, null],
          [0, 1500],
        ],
      ),
    ).toEqual([null]);
    expect(detoursFromTable({ code: "Ok", durations: [], distances: [] }, 1)).toEqual([null]);
  });
});

describe("fetchDetours", () => {
  /** Every stop: 1 km to it, 1.5 km back, 2 km straight through. */
  function tableFor(url: string): object {
    const n = new URL(url).searchParams.get("sources")!.split(";").length / 2;
    const matrix = (to: number, back: number, direct: number) =>
      Array.from({ length: 2 * n }, (_, i) =>
        Array.from({ length: 2 * n }, (_, j) =>
          i < n && j === i ? to : i >= n && j === i ? back : i < n && j === n + i ? direct : 0,
        ),
      );
    return { code: "Ok", distances: matrix(1000, 1500, 2000), durations: matrix(60, 90, 120) };
  }

  const trip = (i: number) => ({
    leave: { lat: 54.9, lon: 23.9 + i / 1000, bearing: 89.6 },
    stop: { lat: 54.901, lon: 23.905 + i / 1000 },
    rejoin: { lat: 54.9, lon: 23.91 + i / 1000, bearing: 90.4 },
  });

  it("leaves along the route, reaches each stop on the driver's side, 30 stops per request", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify(tableFor(url)));
      }),
    );
    const detours = await fetchDetours(Array.from({ length: 31 }, (_, i) => trip(i)));
    expect(detours).toHaveLength(31);
    expect(detours?.[30]?.extraKm).toBeCloseTo(0.5);
    expect(detours?.[30]?.extraMin).toBeCloseTo(0.5);
    expect(urls).toHaveLength(2);
    const first = new URL(urls[0]);
    const coords = first.pathname.split("/driving/")[1].split(";");
    expect(coords).toHaveLength(90);
    expect(coords[0]).toBe("23.9,54.9");
    expect(coords[30]).toBe("23.905,54.901");
    expect(first.searchParams.get("sources")?.split(";")).toHaveLength(60);
    expect(first.searchParams.get("destinations")?.split(";")[0]).toBe("30");
    expect(first.searchParams.get("annotations")).toBe("duration,distance");
    const bearings = first.searchParams.get("bearings")?.split(";");
    expect(bearings?.[0]).toBe("90,60");
    expect(bearings?.[30]).toBe("");
    expect(bearings?.[60]).toBe("90,60");
    const approaches = first.searchParams.get("approaches")?.split(";");
    expect([approaches?.[0], approaches?.[30], approaches?.[60]]).toEqual([
      "unrestricted",
      "curb",
      "unrestricted",
    ]);
    expect(new URL(urls[1]).searchParams.get("sources")).toBe("0;1");
  });

  it("returns null when the router fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429 })),
    );
    expect(await fetchDetours([trip(0)])).toBeNull();
  });

  it("skips the request without stops", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchDetours([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the table request throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect(
      await fetchDetours([
        {
          leave: { lat: 54.9, lon: 23.9, bearing: 90 },
          stop: { lat: 54.91, lon: 23.91 },
          rejoin: { lat: 54.9, lon: 23.92, bearing: 90 },
        },
      ]),
    ).toBeNull();
  });
});

describe("fetchRoutes", () => {
  const route = (km: number) => ({
    distance: km * 1000,
    duration: km * 120,
    geometry: {
      coordinates: [
        [start.lon, start.lat],
        [end.lon, end.lat],
      ],
    },
  });

  it("offers the route and up to two alternatives", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const routes = [route(5.5), route(6.6), route(7), route(9)];
        return new Response(JSON.stringify({ code: "Ok", routes }));
      }),
    );
    const routes = await fetchRoutes(start, end, "fastest");
    expect(routes.map((r) => r.distanceKm)).toEqual([5.5, 6.6, 7]);
    expect(routes[1].durationMin).toBeCloseTo(13.2);
    expect(new URL(urls[0]).searchParams.get("alternatives")).toBe("2");
  });

  it("asks a plain route when alternatives are refused", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes("alternatives")) return new Response("", { status: 400 });
        return new Response(JSON.stringify({ code: "Ok", routes: [route(5.5)] }));
      }),
    );
    expect((await fetchRoutes(start, end, "fastest")).map((r) => r.distanceKm)).toEqual([5.5]);
    expect(urls).toHaveLength(2);
  });

  it("is empty when routing fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    expect(await fetchRoutes(start, end, "fastest")).toEqual([]);
  });

  it("asks one route through a station, reached on the driver's side", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ code: "Ok", routes: [route(6)] }));
      }),
    );
    const via = { lat: 54.8948, lon: 23.9442, curb: true };
    expect((await fetchRoute(start, end, "fastest", [via]))?.distanceKm).toBe(6);
    const url = new URL(urls[0]);
    expect(url.searchParams.get("approaches")).toBe("unrestricted;curb;unrestricted");
    expect(url.searchParams.has("alternatives")).toBe(false);
  });

  it("asks one route through a placed point, from any side of the road", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ code: "Ok", routes: [route(7), route(8)] }));
      }),
    );
    const via = { lat: 54.91, lon: 23.94 };
    const routes = await fetchRoutes(start, end, "fastest", via);
    expect(routes.map((r) => r.distanceKm)).toEqual([7]);
    expect(routes[0].via).toEqual(via);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0]);
    expect(url.pathname.split("/driving/")[1]).toBe("23.9118,54.8987;23.94,54.91;23.9764,54.9045");
    expect(url.searchParams.has("approaches")).toBe(false);
    expect(url.searchParams.has("alternatives")).toBe(false);
  });

  it("is empty when no route passes the placed point", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "NoRoute", routes: [] }))),
    );
    expect(await fetchRoutes(start, end, "fastest", { lat: 55.5, lon: 21 })).toEqual([]);
  });

  it("passes a station and a placed point in the order given", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ code: "Ok", routes: [route(9)] }));
      }),
    );
    const station = { lat: 54.8948, lon: 23.9442, curb: true };
    const placed = { lat: 54.91, lon: 23.96 };
    await fetchRoute(start, end, "fastest", [station, placed]);
    const url = new URL(urls[0]);
    expect(url.pathname.split("/driving/")[1].split(";")).toHaveLength(4);
    expect(url.searchParams.get("approaches")).toBe("unrestricted;curb;unrestricted;unrestricted");
  });

  it("asks a plain route when the alternative list is empty", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes("alternatives")) {
          return new Response(JSON.stringify({ code: "Ok", routes: [] }));
        }
        return new Response(JSON.stringify({ code: "Ok", routes: [route(4.2)] }));
      }),
    );
    expect((await fetchRoutes(start, end, "fastest")).map((r) => r.distanceKm)).toEqual([4.2]);
    expect(urls).toHaveLength(2);
    expect(urls[1]).not.toContain("alternatives");
  });
});

const orsFeature = {
  geometry: {
    coordinates: [
      [start.lon, start.lat],
      [end.lon, end.lat],
    ] as [number, number][],
  },
  properties: { summary: { distance: 4500, duration: 480 } },
};

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => impl(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("geocode", () => {
  it("skips a query shorter than two characters", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await geocode(" a ", "en")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns nothing when the search fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    expect(await geocode("vilnius", "en")).toEqual([]);
  });

  it("labels a hit from its name, street and city, or from its coordinates", async () => {
    const fetchMock = stubFetch(async (url) => {
      expect(new URL(url).searchParams.get("lang")).toBe("en");
      return new Response(
        JSON.stringify({
          features: [
            {
              geometry: { coordinates: [25.28, 54.687] },
              properties: {
                name: "Akropolis",
                street: "Ozo g.",
                housenumber: "25",
                city: "Vilnius",
              },
            },
            { geometry: { coordinates: [25.1, 54.1] }, properties: {} },
            { geometry: { coordinates: [25.2, 54.2] }, properties: { street: "Gedimino pr." } },
            {
              geometry: { coordinates: [25.3, 54.3] },
              properties: { housenumber: "5", city: "Kaunas" },
            },
            { geometry: { coordinates: [25.4, 54.4] }, properties: { name: "Stotis" } },
          ],
        }),
      );
    });
    expect(await geocode("akropolis", "en")).toEqual([
      { label: "Akropolis, Ozo g. 25, Vilnius", lat: 54.687, lon: 25.28 },
      { label: "54.10000, 25.10000", lat: 54.1, lon: 25.1 },
      { label: "Gedimino pr.", lat: 54.2, lon: 25.2 },
      { label: "5, Kaunas", lat: 54.3, lon: 25.3 },
      { label: "Stotis", lat: 54.4, lon: 25.4 },
    ]);
    fetchMock.mockImplementation(async (url: string) => {
      expect(new URL(url).searchParams.get("lang")).toBe("default");
      return new Response(JSON.stringify({}));
    });
    expect(await geocode("kaunas", "lt")).toEqual([]);
  });
});

describe("reverseGeocode", () => {
  const ll = { lat: 54.687, lon: 25.28 };

  it("returns nothing when the lookup fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    expect(await reverseGeocode(ll, "en")).toBeNull();
  });

  it("returns nothing when the lookup throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    expect(await reverseGeocode(ll, "lt")).toBeNull();
  });

  it("returns nothing when there are no features", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ features: [] }))),
    );
    expect(await reverseGeocode(ll, "en")).toBeNull();
  });

  it("returns the first hit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(new URL(url).searchParams.get("lang")).toBe("default");
        return new Response(
          JSON.stringify({
            features: [
              {
                geometry: { coordinates: [25.28, 54.687] },
                properties: { name: "Stotis", city: "Vilnius" },
              },
            ],
          }),
        );
      }),
    );
    expect(await reverseGeocode(ll, "lt")).toEqual({
      label: "Stotis, Vilnius",
      lat: 54.687,
      lon: 25.28,
    });
  });
});

describe("fetchRoute", () => {
  it("returns nothing when the router throws or sends no routes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    expect(await fetchRoute(start, end, "fastest")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "Ok" }))),
    );
    expect(await fetchRoute(start, end, "fastest")).toBeNull();
  });

  it("uses OpenRouteService for the shortest and fastest routes", async () => {
    vi.stubEnv("VITE_ORS_KEY", "secret");
    const bodies: string[] = [];
    stubFetch(async (url, init) => {
      expect(String(url)).toContain("openrouteservice");
      expect((init?.headers as Record<string, string>).Authorization).toBe("secret");
      bodies.push(String(init?.body));
      return new Response(JSON.stringify({ features: [orsFeature] }));
    });
    const shortest = await fetchRoute(start, end, "shortest");
    const fastest = await fetchRoute(start, end, "fastest");
    expect(shortest).toMatchObject({ distanceKm: 4.5, durationMin: 8, profile: "shortest" });
    expect(fastest?.profile).toBe("fastest");
    expect(JSON.parse(bodies[0]!).preference).toBe("shortest");
    expect(JSON.parse(bodies[1]!).preference).toBe("fastest");
  });

  it("falls back to OSRM when OpenRouteService fails", async () => {
    vi.stubEnv("VITE_ORS_KEY", "secret");
    const osrm = () =>
      new Response(
        JSON.stringify({
          code: "Ok",
          routes: [
            {
              distance: 3000,
              duration: 240,
              geometry: {
                coordinates: [
                  [start.lon, start.lat],
                  [end.lon, end.lat],
                ],
              },
            },
          ],
        }),
      );
    const cases: Array<(url: string) => Promise<Response>> = [
      async (url) =>
        url.includes("openrouteservice") ? new Response("", { status: 403 }) : osrm(),
      async (url) =>
        url.includes("openrouteservice") ? new Response(JSON.stringify({ features: [] })) : osrm(),
      async (url) => (url.includes("openrouteservice") ? new Response(JSON.stringify({})) : osrm()),
      async (url) => {
        if (url.includes("openrouteservice")) throw new Error("ors down");
        return osrm();
      },
    ];
    for (const impl of cases) {
      stubFetch(impl);
      expect((await fetchRoute(start, end, "fastest"))?.distanceKm).toBe(3);
    }
  });
});

describe("fetchRoutes with OpenRouteService", () => {
  it("returns the OpenRouteService route and skips alternatives", async () => {
    vi.stubEnv("VITE_ORS_KEY", "secret");
    const fetchMock = stubFetch(
      async () => new Response(JSON.stringify({ features: [orsFeature] })),
    );
    const routes = await fetchRoutes(start, end, "shortest");
    expect(routes.map((r) => r.profile)).toEqual(["shortest"]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("openrouteservice");
  });

  it("keeps a placed point on the OpenRouteService route", async () => {
    vi.stubEnv("VITE_ORS_KEY", "secret");
    const via = { lat: 54.91, lon: 23.94 };
    const fetchMock = stubFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { coordinates: number[][] };
      expect(body.coordinates).toHaveLength(3);
      return new Response(JSON.stringify({ features: [orsFeature] }));
    });
    const routes = await fetchRoutes(start, end, "fastest", via);
    expect(routes[0]?.via).toEqual(via);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
