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
});

describe("parsePrice", () => {
  it("accepts live API string prices", () => {
    expect(parsePrice("2.254")).toBe(2.254);
    expect(parsePrice(null)).toBeNull();
  });
});
