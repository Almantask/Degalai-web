import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  parseRegisterPrice,
  parseRegisterRows,
  parseRegisterXlsx,
  reportUrlFromHome,
  socketKey,
  usableCache,
} from "../scripts/adapters/via-lietuva.ts";
import { mergeChargers } from "../scripts/chargers.ts";
import type { Station } from "../src/types.ts";

// Header text as the live report (ev.vialietuva.lt/report/904) prints it, trimmed.
const HEADER = [
  "Nr",
  "Įkrovimo stotelės identifikacinis kodas",
  "Įkrovimo stotelėje esančios įkrovimo prieigos identifikacini",
  "Įkrovimo stotelės/prieigos darbo laikas",
  "Įkrovimo stotelė/prieiga yra skirta lengvajam ir / ar sunkia",
  "Įkrovimo stotelės/prieigos savininkas",
  "Įkrovimo stotelės/prieigos operatorius",
  "Įkrovimo stotelės/prieigos įrengimo data",
  "Ar įkrovimo stotelė/prieiga teikia dinaminius",
  "Įkrovimo stotelės/prieigos vieta",
  "Kitos vietovės savybės",
  "Įkrovimo stotelės/prieigos GWS X koordinatės",
  "Įkrovimo stotelės/prieigos GWS Y koordinatės",
  "Įkrovimo prieigoje esančių jungčių skaičius",
  "Įkrovimo prieigoje esančių jungčių tipas",
  "Prieigoje esančių jungčių individuali atiduodama galia (kW)",
  "Įkrovimo prieigos elektros srovės rūšis",
  "Ar įkrovimo prieigoje yra įrengtas stacionarus įkrovimo kabe",
  "Prieigos maksimali atiduodamoji galia (kW)",
  "Atsiskaitymo už paslaugas būdai",
  "Vidutinė įkrovimo kaina",
];

function row(
  station: string,
  opts: {
    lat?: string;
    lon?: string;
    type?: string;
    current?: string;
    kw?: string;
    price?: string;
    vehicle?: string;
  } = {},
): string[] {
  const r = Array<string>(HEADER.length).fill("");
  r[1] = station;
  r[4] = opts.vehicle ?? "Lengvajam";
  r[5] = "In Balance grid, UAB";
  r[6] = "Inbalance grid";
  r[9] = "IKI Mindaugo | Inbalance grid, Mindaugo str. 25";
  r[11] = opts.lat ?? "54.673479";
  r[12] = opts.lon ?? "25.274997";
  r[14] = opts.type ?? "Type 2";
  r[16] = opts.current ?? "Kintama";
  r[18] = opts.kw ?? "22";
  r[20] = opts.price ?? "0.28 €/kWh";
  return r;
}

describe("parseRegisterPrice", () => {
  it("reads €/kWh, free chargers and session fees", () => {
    expect(parseRegisterPrice("0.28 €/kWh")).toEqual({ kwh: 0.28 });
    expect(parseRegisterPrice("0,35 EUR/kWh")).toEqual({ kwh: 0.35 });
    expect(parseRegisterPrice("Nemokama")).toEqual({ kwh: 0 });
    expect(parseRegisterPrice("0.48 €/kWh ir 0.3 €")).toEqual({ kwh: 0.48, sessionFee: 0.3 });
    expect(parseRegisterPrice("0.85510416666667 €/kWh")).toEqual({ kwh: 0.855 });
    expect(parseRegisterPrice("")).toEqual({});
  });
});

describe("reportUrlFromHome", () => {
  it("picks the newest report link", () => {
    expect(reportUrlFromHome('<a href="/report/887">x</a><a href="/report/904">y</a>')).toBe(
      "https://ev.vialietuva.lt/report/904",
    );
    expect(reportUrlFromHome("<p>none</p>")).toBeNull();
  });
});

describe("socketKey", () => {
  it("maps register connector names to OSM socket keys", () => {
    expect(socketKey("Type 2")).toBe("type2");
    expect(socketKey("CCS2")).toBe("type2_combo");
    expect(socketKey("CHAdeMO")).toBe("chademo");
  });
});

describe("parseRegisterRows", () => {
  it("groups charge points into one site with AC/DC prices and the cheapest as headline", () => {
    const sites = parseRegisterRows([
      HEADER,
      row("IBG-P-G7H7"),
      row("IBG-P-T3T9", {
        type: "CCS2",
        current: "Nuolatinė",
        kw: "150",
        price: "0.39 €/kWh ir 0.3 €",
      }),
      row("IBG-P-1GDI", { lat: "54.933029", lon: "23.817051" }),
      row("TRUCK-1", { lat: "55.1", lon: "24.1", vehicle: "Sunkiajam" }),
      row("OUT-1", { lat: "59.4", lon: "24.7" }),
    ]);
    expect(sites).toHaveLength(2);
    const iki = sites.find((s) => s.id === "vl:IBG-P-G7H7")!;
    expect(iki).toMatchObject({
      name: "IKI Mindaugo",
      address: "Mindaugo str. 25",
      lat: 54.673479,
      lon: 25.274997,
      fuels: ["EV"],
      ev: {
        sockets: ["type2", "type2_combo"],
        maxKw: 150,
        network: "Inbalance grid",
        registerPrice: 0.28,
        prices: { ac: 0.28, dc: 0.39 },
        sessionFee: 0.3,
      },
    });
    expect(iki.sourceIds["via-lietuva"]).toBe("IBG-P-G7H7,IBG-P-T3T9");
  });

  it("fails loudly when a needed column disappears", () => {
    expect(() => parseRegisterRows([HEADER.slice(0, 15), row("A")])).toThrow(/column/);
  });
});

describe("parseRegisterXlsx", () => {
  it("reads the workbook the register serves", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Worksheet");
    ws.addRow(HEADER);
    ws.addRow(row("IBG-P-G7H7"));
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const sites = await parseRegisterXlsx(buf);
    expect(sites.map((s) => [s.id, s.ev?.registerPrice])).toEqual([["vl:IBG-P-G7H7", 0.28]]);
  });
});

describe("usableCache", () => {
  it("only stands in for a failed download for a week", () => {
    const cache = { fetchedAt: "2026-10-01T00:00:00Z", reportUrl: "x", chargers: [] };
    expect(usableCache(cache, new Date("2026-10-06T00:00:00Z"))).toBe(cache);
    expect(usableCache(cache, new Date("2026-10-09T00:00:00Z"))).toBeNull();
    expect(usableCache(null, new Date())).toBeNull();
  });
});

describe("mergeChargers", () => {
  const site: Station = {
    id: "vl:A",
    name: "Site",
    brand: "independent",
    lat: 54.6735,
    lon: 25.275,
    fuels: ["EV"],
    sourceIds: { "via-lietuva": "A" },
    ev: { sockets: ["type2"], registerPrice: 0.28 },
  };
  const near: Station = {
    id: "ev:node:1",
    name: "OSM near",
    brand: "independent",
    lat: 54.6738,
    lon: 25.2752,
    address: "Mindaugo g. 25, Vilnius",
    fuels: ["EV"],
    sourceIds: { osm: "node/1" },
    ev: { sockets: ["chademo"], chargeTag: 0.4 },
  };
  const far: Station = {
    ...near,
    id: "ev:node:2",
    lat: 55.7,
    lon: 21.1,
    sourceIds: { osm: "node/2" },
  };

  it("keeps register sites, drops OSM duplicates but keeps their tag price, and adds OSM-only places", () => {
    const { chargers, osmOnly } = mergeChargers([site], [near, far]);
    expect(osmOnly).toBe(1);
    expect(chargers.map((c) => c.id)).toEqual(["vl:A", "ev:node:2"]);
    expect(chargers[0].ev).toMatchObject({
      sockets: ["type2"],
      registerPrice: 0.28,
      chargeTag: 0.4,
    });
    expect(chargers[0].sourceIds).toEqual({ "via-lietuva": "A", osm: "node/1" });
    expect(site.ev?.chargeTag).toBeUndefined();
  });
});
