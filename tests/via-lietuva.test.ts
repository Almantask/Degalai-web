import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  companyName,
  freeReason,
  parseRegisterPrice,
  parseRegisterRows,
  parseRegisterXlsx,
  reportUrlFromHome,
  socketKey,
  usableCache,
} from "../scripts/adapters/via-lietuva.ts";
import { assignNetworkBrands, mergeChargers } from "../scripts/chargers.ts";
import { networkSlug } from "../src/brands.ts";
import { chargerBrandLabel, networkLabels } from "../src/i18n/index.ts";
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
    owner?: string;
    operator?: string;
    location?: string;
    town?: string;
  } = {},
): string[] {
  const r = Array<string>(HEADER.length).fill("");
  r[1] = station;
  r[4] = opts.vehicle ?? "Lengvajam";
  r[5] = opts.owner ?? "In Balance grid, UAB";
  r[6] = opts.operator ?? "Inbalance grid";
  r[9] = opts.location ?? "IKI Mindaugo | Inbalance grid, Mindaugo str. 25";
  r[10] = `Šalia TEN-T kelio - Ne\nMiesto mazgas - ${opts.town ?? "Vilnius"}`;
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

  it("keeps the address once when the register repeats it, and splits off a place name", () => {
    const [plain, named] = parseRegisterRows([
      HEADER,
      row("A", { location: "Kauno g. 10, Kauno g. 10" }),
      row("B", {
        lat: "56.2",
        lon: "23.5",
        location: "Norfa XL Vilniaus g. 47B, Joniškis, Vilniaus g. 47B, Joniškis",
      }),
    ]);
    expect(plain).toMatchObject({ name: "Kauno g. 10", address: "Kauno g. 10" });
    expect(named).toMatchObject({ name: "Norfa XL", address: "Vilniaus g. 47B, Joniškis" });
  });

  it("brands a site by its operator, not the company that owns the charger", () => {
    const [site] = parseRegisterRows([
      HEADER,
      row("STR-1", { owner: "AB „Ignitis gamyba“", operator: "Stuart Energy" }),
    ]);
    expect(site).toMatchObject({ brand: "independent", ev: { network: "Stuart Energy" } });
  });

  it("folds a pin dropped far outside its stated town into the operator's namesake site there", () => {
    const plant = "Elektrinės g. 21, Elektrėnai, Elektrinės g. 21, Elektrėnai";
    const str = (id: string, lat: string, lon: string, location = plant) =>
      row(id, { lat, lon, location, operator: "Stuart Energy", town: "Elektrėnai" });
    const sites = parseRegisterRows([
      HEADER,
      // Other operators' chargers in Elektrėnai locate the town.
      row("L-1", { lat: "54.7894", lon: "24.6751", town: "Elektrėnai", operator: "Lidl" }),
      row("E-1", { lat: "54.7879", lon: "24.6812", town: "Elektrėnai", operator: "Enefit Volt" }),
      row("I-1", { lat: "54.7891", lon: "24.6770", town: "Elektrėnai", operator: "Ignitis LT" }),
      str("STR-2835", "54.7734205", "24.648071"),
      // Same place typed, pins around Vilnius Old Town, 40 km away.
      str("STR-7922", "54.6832596", "25.2932739", plant.replaceAll("g. 21", "g.  21")),
      str("STR-8457", "54.690643", "25.2806613"),
      // A different place of the same operator stays where it is.
      str(
        "STR-7R08",
        "54.6673285",
        "25.1584233",
        "Jočionių g. 13, Vilnius, Jočionių g. 13, Vilnius",
      ),
    ]);
    const str2835 = sites.find((s) => s.sourceIds["via-lietuva"]?.includes("STR-2835"))!;
    expect(str2835).toMatchObject({
      lat: 54.7734205,
      lon: 24.648071,
      address: "Elektrinės g. 21, Elektrėnai",
    });
    expect(str2835.sourceIds["via-lietuva"]).toBe("STR-2835,STR-7922,STR-8457");
    expect(sites.filter((s) => s.lon > 25 && s.address?.includes("Elektrėnai"))).toEqual([]);
    expect(sites.find((s) => s.id === "vl:STR-7R08")).toMatchObject({ lat: 54.6673285 });
    expect(sites).toHaveLength(5);
  });

  it("leaves a far pin alone when the operator has no namesake site inside the town", () => {
    const sites = parseRegisterRows([
      HEADER,
      row("L-1", { lat: "54.7894", lon: "24.6751", town: "Elektrėnai", operator: "Lidl" }),
      row("E-1", { lat: "54.7879", lon: "24.6812", town: "Elektrėnai", operator: "Enefit Volt" }),
      row("I-1", { lat: "54.7891", lon: "24.6770", town: "Elektrėnai", operator: "Ignitis LT" }),
      row("X-1", {
        lat: "54.6832",
        lon: "25.2932",
        town: "Elektrėnai",
        location: "Kelias 1, Kelias 1",
      }),
      row("X-2", {
        lat: "54.6906",
        lon: "25.2806",
        town: "Elektrėnai",
        location: "Kelias 1, Kelias 1",
      }),
    ]);
    expect(sites.map((s) => s.id).sort()).toEqual([
      "vl:E-1",
      "vl:I-1",
      "vl:L-1",
      "vl:X-1",
      "vl:X-2",
    ]);
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

describe("freeReason", () => {
  it("reads why a charger is free from its owner and site", () => {
    expect(freeReason("AB „Ignitis gamyba“", "Stuart Energy", "Elektrinės g. 21")).toEqual({
      reason: "powerPlant",
      owner: "Ignitis gamyba",
    });
    expect(freeReason("Jonavos rajono savivaldybės administracija", "Stuart Energy", "")).toEqual({
      reason: "municipal",
    });
    expect(freeReason("Lietuvos oro uostai, AB", "Stuart Energy", "")).toEqual({
      reason: "airport",
      owner: "Lietuvos oro uostai",
    });
    expect(freeReason('UAB "Rar transportas"', "Stuart Energy", "")).toEqual({
      reason: "fleet",
      owner: "Rar transportas",
    });
    expect(freeReason('AB "Klaipėdos vanduo"', "Stuart Energy", "")).toEqual({
      reason: "workplace",
      owner: "Klaipėdos vanduo",
    });
    expect(
      freeReason("In Balance grid, UAB", "Inbalance grid", "SEB, Konstitucijos pr. 25 | x"),
    ).toEqual({ reason: "workplace", owner: "SEB" });
    expect(
      freeReason("In Balance grid, UAB", "Inbalance grid", "Kapsų g. 26 | Vilniaus Apšvietimas"),
    ).toEqual({ reason: "networkPaid" });
    // The operator owning its own charger is not a workplace.
    expect(freeReason("In Balance grid, UAB", "Inbalance grid", "Smiltynės perkėla")).toEqual({
      reason: "unknown",
    });
  });

  it("is set only on free sites", () => {
    const [free, paid] = parseRegisterRows([
      HEADER,
      row("F", { price: "Nemokama", owner: 'UAB "IDM GROUP"', operator: "Stuart Energy" }),
      row("P", { lat: "55.1", lon: "24.1", owner: 'UAB "IDM GROUP"', operator: "Stuart Energy" }),
    ]);
    expect(free!.ev).toMatchObject({
      registerPrice: 0,
      free: { reason: "workplace", owner: "IDM GROUP" },
    });
    expect(paid!.ev?.free).toBeUndefined();
  });

  it("drops legal forms and quotes from company names", () => {
    expect(companyName("Iglu Tech Arnoldas, UAB")).toBe("Iglu Tech Arnoldas");
    expect(companyName('VĮ "Ignalinos atominė elektrinė"')).toBe("Ignalinos atominė elektrinė");
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
  // ~250 m east of the site, as OSM points in a big car park often are; ~370 m is a neighbour.
  const carPark: Station = { ...near, id: "ev:node:3", lon: 25.2789, sourceIds: { osm: "node/3" } };
  const nextDoor: Station = {
    ...near,
    id: "ev:node:4",
    lon: 25.2808,
    sourceIds: { osm: "node/4" },
  };

  it("treats an OSM point up to 300 m away as the same site", () => {
    const { chargers, osmOnly } = mergeChargers([site], [carPark, nextDoor]);
    expect(osmOnly).toBe(1);
    expect(chargers.map((c) => c.id)).toEqual(["vl:A", "ev:node:4"]);
  });

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

describe("networkSlug", () => {
  it("makes a provider id from an operator name", () => {
    expect(networkSlug("In Balance grid, UAB")).toBe("inbalance-grid");
    expect(networkSlug("Inbalance grid")).toBe("inbalance-grid");
    expect(networkSlug("UAB „Elinta“")).toBe("elinta");
    expect(networkSlug("Eldrive Lithuania")).toBe("eldrive-lithuania");
    expect(networkSlug("VšĮ Šiaulių būstas")).toBe("siauliu-bustas");
    expect(networkSlug("")).toBe("independent");
  });
});

describe("assignNetworkBrands", () => {
  const at = (id: string, network: string, brand = "independent"): Station => ({
    id,
    name: id,
    brand,
    lat: 54.7,
    lon: 25.3,
    fuels: ["EV"],
    sourceIds: {},
    ev: { sockets: [], network },
  });

  it("names networks with enough sites and leaves the long tail under Kita", () => {
    const { chargers, networks } = assignNetworkBrands([
      at("a", "Inbalance grid"),
      at("b", "Inbalance grid"),
      at("c", "Inbalance grid"),
      at("d", "Hotel Charger"),
      at("e", "Tesla", "tesla"),
    ]);
    expect(chargers.map((c) => c.brand)).toEqual([
      "inbalance-grid",
      "inbalance-grid",
      "inbalance-grid",
      "independent",
      "tesla",
    ]);
    expect(networks).toBe(2);
    expect(networkLabels(chargers).get("inbalance-grid")).toBe("Inbalance grid");
    expect(chargerBrandLabel(chargers[0])).toBe("Inbalance grid");
    expect(chargerBrandLabel(chargers[4])).toBe("Tesla");
    expect(chargerBrandLabel(chargers[3])).toBe("Hotel Charger");
  });
});
