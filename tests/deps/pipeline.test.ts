import { describe, expect, it } from "vitest";
import { fetchCircleK } from "../../scripts/adapters/circle-k.ts";
import { fetchLeaWorkbook, findLeaExcelUrl } from "../../scripts/adapters/lea.ts";
import { discoverLeaLiveConfig, fetchLeaLive } from "../../scripts/adapters/lea-live.ts";
import { fetchSpot } from "../../scripts/adapters/nordpool.ts";
import { fetchRegister, MIN_REGISTER_SITES } from "../../scripts/adapters/via-lietuva.ts";
import { geocodePhoton } from "../../scripts/geocode.ts";
import {
  fetchOsmChargers,
  fetchOsmStations,
  MIN_OSM_CHARGERS,
  MIN_OSM_STATIONS,
} from "../../scripts/osm.ts";
import { SOURCE_META } from "../../scripts/source-health.ts";
import { PROVIDER_TIMEOUT_MS } from "../../scripts/sources.ts";
import { inLithuania } from "../../src/geo.ts";

// Live: each service the hourly pipeline calls still answers its adapter with what it needs.

const minRows = (source: string): number => SOURCE_META.find((m) => m.name === source)!.minRows;
/** Overpass tries three mirrors, twice each, 30 s a request. */
const OVERPASS_TIMEOUT_MS = 300_000;
/** Home page, then the report: 120 s each. */
const REGISTER_TIMEOUT_MS = 240_000;

describe("LEA live map (lea-live)", () => {
  it("has the API address and read token in the map's JS bundle", async () => {
    const { apiBase, token } = await discoverLeaLiveConfig();
    expect(apiBase).toMatch(/^https:\/\//);
    expect(token).not.toBe("");
  });

  it("answers the API with prices", async () => {
    expect((await fetchLeaLive()).length).toBeGreaterThanOrEqual(minRows("lea-live"));
  });
});

describe("LEA workbook (lea)", () => {
  it("links the SharePoint workbook from ena.lt", async () => {
    expect(await findLeaExcelUrl()).toMatch(/^https:\/\/ltenergagen\.sharepoint\.com\//);
  });

  it(
    "downloads a workbook with a working day from the last week",
    async () => {
      const byDate = await fetchLeaWorkbook();
      const latest = [...byDate.keys()].sort().at(-1)!;
      expect(byDate.get(latest)!.length).toBeGreaterThanOrEqual(minRows("lea"));
      const ageDays = (Date.now() - Date.parse(latest)) / 86_400_000;
      expect(ageDays, `newest day ${latest}`).toBeLessThan(7);
    },
    PROVIDER_TIMEOUT_MS,
  );
});

describe("Circle K price page (circle-k)", () => {
  it("lists the network-lowest 95, 98, diesel and LPG prices", async () => {
    const fuels = new Set((await fetchCircleK()).map((o) => o.fuel));
    expect(fuels).toEqual(new Set(["95", "98", "D", "LPG"]));
  });
});

describe("Via Lietuva charge point register", () => {
  it(
    "links a register report with priced sites",
    async () => {
      const { chargers } = await fetchRegister();
      expect(chargers.length).toBeGreaterThanOrEqual(MIN_REGISTER_SITES);
      expect(chargers.some((c) => (c.ev?.registerPrice ?? 0) > 0)).toBe(true);
    },
    REGISTER_TIMEOUT_MS,
  );
});

describe("Elering (Nord Pool spot price)", () => {
  it("has the LT price for the current hour", async () => {
    const points = await fetchSpot(new Date(), 1);
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
    expect(points.map((p) => p.at)).toContain(hour);
  });
});

describe("Overpass (OpenStreetMap)", () => {
  it(
    "returns Lithuania's fuel stations",
    async () => {
      expect((await fetchOsmStations()).length).toBeGreaterThanOrEqual(MIN_OSM_STATIONS);
    },
    OVERPASS_TIMEOUT_MS,
  );

  it(
    "returns Lithuania's public chargers",
    async () => {
      expect((await fetchOsmChargers()).length).toBeGreaterThanOrEqual(MIN_OSM_CHARGERS);
    },
    OVERPASS_TIMEOUT_MS,
  );
});

describe("Photon (geocoding LEA addresses)", () => {
  it("finds a street address in Lithuania", async () => {
    const hit = await geocodePhoton("Savanorių pr. 1, Vilnius, Lietuva");
    expect(hit).not.toBeNull();
    expect(inLithuania(hit!)).toBe(true);
  });
});
