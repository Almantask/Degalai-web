import { describe, expect, it } from "vitest";
import {
  discoverLeaLiveConfig,
  fetchLeaLive,
  parseLeaLivePayload,
} from "../scripts/adapters/lea-live.ts";
import { mapLeaFuel, parsePrice } from "../scripts/adapters/types.ts";

describe("mapLeaFuel", () => {
  it("maps Excel labels and the live API fuel keys", () => {
    expect(mapLeaFuel("95 benzinas")).toBe("95");
    expect(mapLeaFuel("benzinas_95")).toBe("95");
    expect(mapLeaFuel("Dyzelinas")).toBe("D");
    expect(mapLeaFuel("snd")).toBe("LPG");
  });

  it("maps the remaining spellings and rejects an unknown label", () => {
    expect(mapLeaFuel("95")).toBe("95");
    expect(mapLeaFuel("98 benzinas")).toBe("98");
    expect(mapLeaFuel("benzinas-98")).toBe("98");
    expect(mapLeaFuel("98")).toBe("98");
    expect(mapLeaFuel("diesel")).toBe("D");
    expect(mapLeaFuel("lpg")).toBe("LPG");
    expect(mapLeaFuel("AdBlue")).toBeNull();
    expect(mapLeaFuel("  ")).toBeNull();
  });
});

describe("parseLeaLivePayload", () => {
  it("skips null prices and stamps lea-live with Vilnius submitted_at", () => {
    const rows = parseLeaLivePayload({
      last_updated: "2026-09-17 11:03:09",
      data: [
        {
          company_name: "UAB Circle K Lietuva",
          gas_station_name: "Circle K",
          municipality: "Kauno m. sav.",
          address: "Kaunas, Karaliaus Mindaugo pr. 34A, 44306",
          latitude: "54.89406610",
          longitude: "23.91409710",
          fuel_type: "dyzelinas",
          price: "2.254",
          submitted_at: "2026-09-17 09:45:16",
        },
        {
          company_name: "AB Orlen Baltics Retail",
          gas_station_name: "Orlen",
          municipality: "Alytaus m. sav.",
          address: "Alytus, Kauno g. 73, 62107",
          fuel_type: "benzinas_95",
          price: null,
          submitted_at: "2026-09-17 10:30:02",
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      brand: "circle-k",
      fuel: "D",
      price: 2.254,
      source: "lea-live",
      observedAt: "2026-09-17T09:45:16+03:00",
      lat: 54.8940661,
      lon: 23.9140971,
    });
    expect(rows[0].sourceStationId).toContain("mindaugo");
  });

  it("uses last_updated when a row has no stamp and skips rows that are not a price", () => {
    const rows = parseLeaLivePayload({
      last_updated: "2026-09-17 11:00:00",
      data: [
        {
          company_name: "UAB Viada",
          address: "Gedimino pr. 1",
          fuel_type: "diesel",
          price: 1.5,
          latitude: 54.68,
          longitude: Number.POSITIVE_INFINITY,
          submitted_at: "nope",
        },
        {
          address: "Gedimino pr. 2",
          fuel_type: "95",
          price: 1.4,
          submitted_at: "2026-09-17 10:00:00",
        },
        {
          company_name: "Viada",
          fuel_type: "98",
          price: 1.6,
          submitted_at: "2026-09-17 10:00:00",
        },
        {
          company_name: "Viada",
          address: "A",
          price: 1,
          submitted_at: "2026-09-17 10:00:00",
        },
        {
          company_name: "Viada",
          address: "B",
          municipality: "Vilnius",
          fuel_type: "adblue",
          price: 1,
          submitted_at: "2026-09-17 10:00:00",
        },
        {
          company_name: "Viada",
          address: "C",
          fuel_type: "lpg",
          price: "0,80",
          latitude: " 55.1 ",
          longitude: "abc",
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "UAB Viada",
      observedAt: "2026-09-17T11:00:00+03:00",
      lat: 54.68,
      price: 1.5,
    });
    expect(rows[0].lon).toBeUndefined();
    expect(rows[1]).toMatchObject({ price: 0.8, lat: 55.1, fuel: "LPG" });
    expect(rows[1].lon).toBeUndefined();
  });

  it("reads a payload with no fallback time", () => {
    expect(parseLeaLivePayload({})).toEqual([]);
    const rows = parseLeaLivePayload({
      data: [
        {
          company_name: "Viada",
          address: "A",
          fuel_type: "95",
          price: 1.2,
          submitted_at: "nope",
          latitude: "   ",
          longitude: null,
        },
        {
          company_name: "Viada",
          gas_station_name: "",
          address: "B",
          fuel_type: "95",
          price: "1.200",
          submitted_at: "2026-09-17 08:00:00",
          latitude: "",
          longitude: Number.NaN,
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Viada",
      price: 1.2,
      observedAt: "2026-09-17T08:00:00+03:00",
    });
    expect(rows[0].lat).toBeUndefined();
    expect(rows[0].lon).toBeUndefined();
  });
});

describe("discoverLeaLiveConfig", () => {
  it("reads apiBase and token from the public map bundle", async () => {
    const files: Record<string, string> = {
      "https://degalukainos.ena.lt/": `<script type="module" src="./assets/FuelPriceSiteApp-test.js"></script>`,
      "https://degalukainos.ena.lt/assets/FuelPriceSiteApp-test.js": `ii={apiBase:"https://api-degalukainos.ena.lt/api/v1",token:"1|public-read-token"}`,
    };
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      const body = files[url];
      if (!body) return new Response("missing", { status: 404 });
      return new Response(body, { status: 200 });
    };
    await expect(discoverLeaLiveConfig(fetchImpl)).resolves.toEqual({
      apiBase: "https://api-degalukainos.ena.lt/api/v1",
      token: "1|public-read-token",
    });
  });

  it("follows the index bundle to the FuelPriceSiteApp chunk", async () => {
    const files: Record<string, string> = {
      "https://degalukainos.ena.lt/": `<script type="module" crossorigin src="./assets/index-DJ-BlfNT.js"></script>`,
      "https://degalukainos.ena.lt/assets/index-DJ-BlfNT.js": `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./FuelPriceSiteApp-D7c-syZH.js"])))=>i.map(i=>d[i]);`,
      "https://degalukainos.ena.lt/assets/FuelPriceSiteApp-D7c-syZH.js": `ii={apiBase:"https://api-degalukainos.ena.lt/api/v1",token:"1|public-read-token"}`,
    };
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      const body = files[url];
      if (!body) return new Response("missing", { status: 404 });
      return new Response(body, { status: 200 });
    };
    await expect(discoverLeaLiveConfig(fetchImpl)).resolves.toEqual({
      apiBase: "https://api-degalukainos.ena.lt/api/v1",
      token: "1|public-read-token",
    });
  });

  it("fails when the map page has no bundle", async () => {
    const fetchImpl: typeof fetch = async () => new Response("<html></html>");
    await expect(discoverLeaLiveConfig(fetchImpl)).rejects.toThrow(/bundle not found/);
  });

  it("skips a bundle it already fetched and fails when no config is published", async () => {
    const js = "https://degalukainos.ena.lt/assets/FuelPriceSiteApp-a.js";
    const files: Record<string, string> = {
      "https://degalukainos.ena.lt/": `<script src="./assets/FuelPriceSiteApp-a.js"></script><script src="./assets/FuelPriceSiteApp-a.js"></script>`,
      [js]: "var x = 1;",
    };
    const fetched: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      fetched.push(url);
      const body = files[url];
      if (!body) return new Response("missing", { status: 404 });
      return new Response(body, { status: 200 });
    };
    await expect(discoverLeaLiveConfig(fetchImpl)).rejects.toThrow(/config not found/);
    expect(fetched.filter((url) => url === js)).toHaveLength(1);
  });

  it("keeps looking until both apiBase and token are present", async () => {
    const files: Record<string, string> = {
      "https://degalukainos.ena.lt/": `<script src="./assets/index-a.js"></script>`,
      "https://degalukainos.ena.lt/assets/index-a.js": `x={apiBase:"https://api.example/v1/"} FuelPriceSiteApp-b.js`,
      "https://degalukainos.ena.lt/assets/FuelPriceSiteApp-b.js": `x={token:"only"} FuelPriceSiteApp-c.js`,
      "https://degalukainos.ena.lt/assets/FuelPriceSiteApp-c.js": `x={apiBase:"https://api.example/v1/",token:"tok"}`,
    };
    const fetchImpl: typeof fetch = async (input) => {
      const body = files[String(input)];
      if (!body) return new Response("missing", { status: 404 });
      return new Response(body, { status: 200 });
    };
    await expect(discoverLeaLiveConfig(fetchImpl)).resolves.toEqual({
      apiBase: "https://api.example/v1",
      token: "tok",
    });
  });

  it("stops after six bundles without a config", async () => {
    const files: Record<string, string> = {
      "https://degalukainos.ena.lt/": `<script src="./assets/FuelPriceSiteApp-0.js"></script>`,
    };
    for (let i = 0; i < 8; i++) {
      files[`https://degalukainos.ena.lt/assets/FuelPriceSiteApp-${i}.js`] =
        `FuelPriceSiteApp-${i + 1}.js`;
    }
    const fetched: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      fetched.push(url);
      return new Response(files[url] ?? "missing", { status: files[url] ? 200 : 404 });
    };
    await expect(discoverLeaLiveConfig(fetchImpl)).rejects.toThrow(/config not found/);
    expect(fetched.filter((url) => url.includes("FuelPriceSiteApp-"))).toHaveLength(6);
  });
});

describe("fetchLeaLive", () => {
  it("calls latest prices with the discovered bearer token", async () => {
    const files: Record<string, string> = {
      "https://degalukainos.ena.lt/": `<script type="module" src="./assets/FuelPriceSiteApp-test.js"></script>`,
      "https://degalukainos.ena.lt/assets/FuelPriceSiteApp-test.js": `ii={apiBase:"https://api-degalukainos.ena.lt/api/v1",token:"1|public-read-token"}`,
      "https://api-degalukainos.ena.lt/api/v1/read/prices/latest": JSON.stringify({
        last_updated: "2026-09-17 11:03:09",
        data: [
          {
            company_name: "UAB Circle K Lietuva",
            gas_station_name: "Circle K",
            municipality: "Kauno m. sav.",
            address: "Kaunas, Karaliaus Mindaugo pr. 34A, 44306",
            fuel_type: "dyzelinas",
            price: "2.254",
            submitted_at: "2026-09-17 09:45:16",
          },
        ],
      }),
    };
    const headers: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = files[url];
      if (!body) return new Response("missing", { status: 404 });
      if (url.includes("/read/prices/latest")) {
        headers.push(new Headers(init?.headers).get("authorization") ?? "");
      }
      return new Response(body, { status: 200 });
    };
    const rows = await fetchLeaLive(fetchImpl);
    expect(headers).toEqual(["Bearer 1|public-read-token"]);
    expect(rows[0]).toMatchObject({ price: 2.254, source: "lea-live" });
  });

  it("throws when the latest-price request fails", async () => {
    const files: Record<string, string> = {
      "https://degalukainos.ena.lt/": `<script src="./assets/FuelPriceSiteApp-test.js"></script>`,
      "https://degalukainos.ena.lt/assets/FuelPriceSiteApp-test.js": `ii={apiBase:"https://api.example/v1",token:"tok"}`,
    };
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/read/prices/latest")) return new Response("down", { status: 503 });
      const body = files[url];
      if (!body) return new Response("missing", { status: 404 });
      return new Response(body, { status: 200 });
    };
    await expect(fetchLeaLive(fetchImpl)).rejects.toThrow(/HTTP 503/);
  });
});

describe("parsePrice", () => {
  it("accepts live API string prices", () => {
    expect(parsePrice("2.254")).toBe(2.254);
    expect(parsePrice(null)).toBeNull();
  });

  it("rounds numbers and rejects dashes, blanks and non-numeric text", () => {
    expect(parsePrice(1.2346)).toBe(1.235);
    expect(parsePrice(Number.NaN)).toBeNull();
    expect(parsePrice(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parsePrice("")).toBeNull();
    expect(parsePrice("-")).toBeNull();
    expect(parsePrice("—")).toBeNull();
    expect(parsePrice("–")).toBeNull();
    expect(parsePrice("1,239")).toBe(1.239);
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });
});
