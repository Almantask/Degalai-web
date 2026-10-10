import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import {
  companyName,
  cellText,
  fetchRegister,
  freeReason,
  loadRegisterCache,
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

describe("cellText", () => {
  it("stringifies empty, linked and formula cells", () => {
    expect(cellText(null)).toBe("");
    expect(cellText({ text: null })).toBe("");
    expect(cellText({ result: undefined })).toBe("");
    expect(cellText({ text: "A" })).toBe("A");
    expect(cellText({ result: 2 })).toBe("2");
  });
});

describe("parseRegisterPrice", () => {
  it("reads €/kWh, free chargers and session fees", () => {
    expect(parseRegisterPrice("0.28 €/kWh")).toEqual({ kwh: 0.28 });
    expect(parseRegisterPrice("0,35 EUR/kWh")).toEqual({ kwh: 0.35 });
    expect(parseRegisterPrice("Nemokama")).toEqual({ kwh: 0 });
    expect(parseRegisterPrice("0.48 €/kWh ir 0.3 €")).toEqual({ kwh: 0.48, sessionFee: 0.3 });
    expect(parseRegisterPrice("0.85510416666667 €/kWh")).toEqual({ kwh: 0.855 });
    expect(parseRegisterPrice("")).toEqual({});
    expect(parseRegisterPrice("nėra")).toEqual({});
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

  it("maps the other connector names and unknown plugs", () => {
    expect(socketKey("tipas 2")).toBe("type2");
    expect(socketKey("Mennekes")).toBe("type2");
    expect(socketKey("Combo")).toBe("type2_combo");
    expect(socketKey("Type 1")).toBe("type1");
    expect(socketKey("Schuko")).toBe("schuko");
    expect(socketKey("Tesla")).toBe("tesla");
    expect(socketKey("a b")).toBe("a_b");
    expect(socketKey("!!!")).toBe("other");
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
        kwBySocket: { type2: 22, type2_combo: 150 },
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
    expect(() => parseRegisterRows([])).toThrow(/empty/);
  });

  it("reads odd rows: swapped coordinates, missing cells and nameless sites", () => {
    const place = (i: number) => ({
      lat: (54.5 + i * 0.01).toFixed(5),
      lon: (23.5 + i * 0.01).toFixed(5),
    });
    const short = row("SHORT", { ...place(12), type: "Type 2" }).slice(0, 15);
    const sites = parseRegisterRows([
      HEADER,
      row("SW", {
        lat: "25.20",
        lon: "54.90",
        operator: "Swap Op",
        location: "Swap place",
      }),
      row("BADX", { lat: "nope", lon: "24.00" }),
      row("BADY", { ...place(2), lon: "nope" }),
      row("OWN", {
        ...place(3),
        operator: "",
        owner: "Stuart Energy",
        location: "Stuart | Street 9",
      }),
      row("BLANK", { ...place(4), location: "", town: "", operator: "Lidl" }),
      row("PLAIN", { ...place(5), location: "Parduotuve" }),
      row("PREFIX", {
        ...place(6),
        operator: "Inbalance grid",
        location: "Shop | Inbalance grid, Gatve 1",
      }),
      row("OTHER", {
        ...place(7),
        operator: "Inbalance grid",
        location: "Shop | Other, Gatve 3",
      }),
      row("HEAD", { ...place(8), operator: "Ignitis", location: "| Gatve 2" }),
      row("NAME", { ...place(9), operator: "Viada", location: "Only name |" }),
      row("DC", {
        ...place(10),
        type: "CCS2",
        current: "Nuolatinė",
        kw: "150",
        price: "0.39 €/kWh",
      }),
      row("", {
        lat: "55.10000",
        lon: "24.10000",
        operator: "No Id Op",
        location: "No id place",
      }),
      row("NONAME", { ...place(11), operator: "", owner: "", location: "", town: "" }),
      row("FREE", {
        ...place(13),
        price: "Nemokama",
        operator: "",
        owner: "",
        location: "Parkas",
      }),
      short,
    ]);
    const byId = new Map(sites.map((s) => [s.id, s]));
    expect(byId.get("vl:SW")).toMatchObject({ lat: 54.9, lon: 25.2 });
    expect(byId.get("vl:OWN")).toMatchObject({
      name: "Stuart",
      address: "Street 9",
      ev: { network: "Stuart Energy" },
    });
    expect(byId.get("vl:BLANK")).toMatchObject({ name: "Lidl" });
    expect(byId.get("vl:BLANK")!.address).toBeUndefined();
    expect(byId.get("vl:PLAIN")).toMatchObject({ name: "Parduotuve", address: "Parduotuve" });
    expect(byId.get("vl:PREFIX")).toMatchObject({ name: "Shop", address: "Gatve 1" });
    expect(byId.get("vl:OTHER")).toMatchObject({ name: "Shop", address: "Other, Gatve 3" });
    expect(byId.get("vl:HEAD")).toMatchObject({ name: "Ignitis", address: "Gatve 2" });
    expect(byId.get("vl:NAME")).toMatchObject({ name: "Only name" });
    expect(byId.get("vl:NAME")!.address).toBeUndefined();
    expect(byId.get("vl:DC")!.ev).toMatchObject({
      sockets: ["type2_combo"],
      registerPrice: 0.39,
      prices: { dc: 0.39 },
    });
    expect(byId.get("vl:DC")!.ev!.prices!.ac).toBeUndefined();
    expect(byId.get("vl:55.10000,24.10000")).toBeDefined();
    expect(byId.get("vl:NONAME")).toMatchObject({ name: "Įkrovimo stotelė" });
    expect(byId.get("vl:NONAME")!.ev!.network).toBeUndefined();
    expect(byId.get("vl:FREE")!.ev).toMatchObject({
      registerPrice: 0,
      free: { reason: "unknown" },
    });
    expect(byId.get("vl:SHORT")).toBeDefined();
    expect(byId.has("vl:BADX")).toBe(false);
    expect(byId.has("vl:BADY")).toBe(false);
  });

  it("leaves the town blank when the features column is absent or has no town", () => {
    const header = [...HEADER];
    header[10] = "Kita";
    const [noCol] = parseRegisterRows([header, row("A", { lat: "54.80", lon: "24.70" })]);
    const unmarked = row("B", { lat: "54.81", lon: "24.71" });
    unmarked[10] = "Šalia TEN-T kelio - Ne";
    const [noTown] = parseRegisterRows([HEADER, unmarked]);
    expect(noCol.id).toBe("vl:A");
    expect(noTown.id).toBe("vl:B");
  });

  it("folds a far site's extra socket and higher power into the town site", () => {
    const plant = "Elektrinės g. 21, Elektrėnai, Elektrinės g. 21, Elektrėnai";
    const sites = parseRegisterRows([
      HEADER,
      row("L-1", { lat: "54.7894", lon: "24.6751", town: "Elektrėnai", operator: "Lidl" }),
      row("E-1", { lat: "54.7879", lon: "24.6812", town: "Elektrėnai", operator: "Enefit" }),
      row("I-1", { lat: "54.7891", lon: "24.6770", town: "Elektrėnai", operator: "Ignitis" }),
      row("V-1", { lat: "54.7885", lon: "24.6790", town: "Elektrėnai", operator: "Viada" }),
      row("H", {
        lat: "54.7860",
        lon: "24.6700",
        town: "Elektrėnai",
        operator: "Stuart",
        location: plant,
        type: "Type 2",
        kw: "22",
      }),
      row("H2", {
        lat: "54.8000",
        lon: "24.8000",
        town: "Elektrėnai",
        operator: "Stuart",
        location: plant,
        type: "Type 2",
        kw: "11",
      }),
      row("F1", {
        lat: "54.6832",
        lon: "25.2932",
        town: "Elektrėnai",
        operator: "Stuart",
        location: plant,
        type: "CCS2",
        kw: "150",
        current: "Nuolatinė",
      }),
      row("F2", {
        lat: "54.6900",
        lon: "25.2800",
        town: "Elektrėnai",
        operator: "Stuart",
        location: plant,
        type: "",
        kw: "",
      }),
      row("SOLO", { lat: "55.0000", lon: "23.5000", location: "", town: "", operator: "Solo" }),
    ]);
    const home = sites.find((s) => s.sourceIds["via-lietuva"]?.includes("H"))!;
    expect(home.ev).toMatchObject({ maxKw: 150, sockets: ["type2", "type2_combo"] });
    expect(home.id).toBe("vl:F1");
    expect(home.sourceIds["via-lietuva"]).toBe("F1,F2,H");
    expect(sites.find((s) => s.id === "vl:SOLO")).toMatchObject({ name: "Solo" });
    expect(sites.filter((s) => s.lon > 25)).toEqual([]);
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

  it("reads formula, link and empty cells", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Worksheet");
    ws.addRow(HEADER);
    const values = row("S1");
    values.push(null as unknown as string);
    ws.addRow(values);
    const data = ws.getRow(2);
    data.getCell(24).value = new Date("2026-09-16T00:00:00Z");
    data.getCell(25).value = { text: "link", hyperlink: "https://example.com" };
    data.getCell(26).value = { formula: "1+1", result: 2 };
    data.getCell(27).value = { richText: [{ text: "rich" }] };
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const sites = await parseRegisterXlsx(buf);
    expect(sites.map((s) => s.id)).toEqual(["vl:S1"]);
  });

  it("fails when the workbook has no sheet", async () => {
    const wb = new ExcelJS.Workbook();
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseRegisterXlsx(buf)).rejects.toThrow(/no sheet/);
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

  it("fills a register site's missing socket power from OSM but keeps its own", () => {
    const register: Station = {
      ...site,
      ev: { sockets: ["type2", "type2_combo"], maxKw: 150, kwBySocket: { type2_combo: 150 } },
    };
    const osm: Station = {
      ...near,
      ev: { sockets: ["type2", "type2_combo"], kwBySocket: { type2: 22, type2_combo: 50 } },
    };
    const [merged] = mergeChargers([register], [osm]).chargers;
    expect(merged!.ev!.kwBySocket).toEqual({ type2_combo: 150, type2: 22 });
    expect(register.ev!.kwBySocket).toEqual({ type2_combo: 150 });
  });

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

  it("copies sockets, power and city onto a register site that has none", () => {
    const bare: Station = { ...site, ev: { sockets: [] } };
    const osm: Station = {
      ...near,
      city: "Vilnius",
      ev: { sockets: ["type2"], maxKw: 22, chargeTag: 0.4 },
    };
    const [merged] = mergeChargers([bare], [osm]).chargers;
    expect(merged!.ev).toMatchObject({ sockets: ["type2"], maxKw: 22, chargeTag: 0.4 });
    expect(merged!.city).toBe("Vilnius");
    expect(merged!.address).toBe("Mindaugo g. 25, Vilnius");
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

  it("keeps a known network below the minimum and leaves a charger with no network independent", () => {
    const bare: Station = {
      id: "c",
      name: "c",
      brand: "independent",
      lat: 54.7,
      lon: 25.3,
      fuels: ["EV"],
      sourceIds: {},
    };
    const { chargers } = assignNetworkBrands([at("a", "Ignitis ON"), at("b", ""), bare]);
    expect(chargers.map((c) => c.brand)).toEqual(["ignitis-on", "independent", "independent"]);
  });

  it("treats a missing site count as below the minimum", () => {
    const real = Map.prototype.get;
    let calls = 0;
    const spy = vi.spyOn(Map.prototype, "get").mockImplementation(function (
      this: Map<string, number>,
      key: string,
    ) {
      calls += 1;
      if (calls === 1) return real.call(this, key);
      return undefined;
    });
    try {
      const { chargers } = assignNetworkBrands([at("a", "Hotel Charger")]);
      expect(chargers[0]!.brand).toBe("independent");
    } finally {
      spy.mockRestore();
    }
  });
});

async function registerWorkbook(count: number, pad: boolean): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Worksheet");
  ws.addRow(HEADER);
  for (let i = 0; i < count; i++) {
    const lat = (54.1 + (i % 20) * 0.05).toFixed(5);
    const lon = (21.2 + Math.floor(i / 20) * 0.4).toFixed(5);
    ws.addRow(
      row(`S${i}`, {
        lat,
        lon,
        operator: `Operator ${i}`,
        owner: `Owner ${i}`,
        location: `Place ${i} | Street ${i}`,
        town: `Town ${i}`,
      }),
    );
  }
  if (pad) ws.getCell(1, 30).value = randomBytes(20_000).toString("base64");
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("fetchRegister", () => {
  it("downloads the newest report", async () => {
    const buf = await registerWorkbook(200, false);
    const fetchImpl: typeof fetch = async (input) =>
      String(input).endsWith("/")
        ? new Response(`<a href="/report/1"></a><a href="/report/9"></a>`)
        : new Response(new Uint8Array(buf));
    const result = await fetchRegister(fetchImpl);
    expect(result.reportUrl).toBe("https://ev.vialietuva.lt/report/9");
    expect(result.chargers).toHaveLength(200);
  });

  it("uses global fetch when no implementation is passed", async () => {
    const buf = await registerWorkbook(200, false);
    vi.stubGlobal("fetch", async (input: RequestInfo) =>
      String(input).endsWith("/")
        ? new Response(`<a href="/report/4"></a>`)
        : new Response(new Uint8Array(buf)),
    );
    try {
      await expect(fetchRegister()).resolves.toMatchObject({
        reportUrl: "https://ev.vialietuva.lt/report/4",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails when the home page does not answer", async () => {
    const fetchImpl: typeof fetch = async () => new Response("", { status: 503 });
    await expect(fetchRegister(fetchImpl)).rejects.toThrow(/home HTTP 503/);
  });

  it("fails when the home page links no report", async () => {
    const fetchImpl: typeof fetch = async () => new Response("<p>none</p>");
    await expect(fetchRegister(fetchImpl)).rejects.toThrow(/links no report/);
  });

  it("fails when the report does not answer", async () => {
    const fetchImpl: typeof fetch = async (input) =>
      String(input).endsWith("/")
        ? new Response(`<a href="/report/9"></a>`)
        : new Response("", { status: 404 });
    await expect(fetchRegister(fetchImpl)).rejects.toThrow(/report HTTP 404/);
  });

  it("fails when the report is too small to be a workbook", async () => {
    const fetchImpl: typeof fetch = async (input) =>
      String(input).endsWith("/")
        ? new Response(`<a href="/report/9"></a>`)
        : new Response(Buffer.from("hi"));
    await expect(fetchRegister(fetchImpl)).rejects.toThrow(/not an XLSX/);
  });

  it("fails when a long download is not a workbook", async () => {
    const fetchImpl: typeof fetch = async (input) =>
      String(input).endsWith("/")
        ? new Response(`<a href="/report/9"></a>`)
        : new Response(new Uint8Array(Buffer.alloc(10_000, 1)));
    await expect(fetchRegister(fetchImpl)).rejects.toThrow(/not an XLSX/);
  });

  it("fails when a real workbook lists too few sites", async () => {
    const buf = await registerWorkbook(1, true);
    const fetchImpl: typeof fetch = async (input) =>
      String(input).endsWith("/")
        ? new Response(`<a href="/report/9"></a>`)
        : new Response(new Uint8Array(buf));
    await expect(fetchRegister(fetchImpl)).rejects.toThrow(/too few sites \(1\)/);
  });
});

describe("loadRegisterCache", () => {
  it("loads a cache and ignores a missing, broken or shapeless file", () => {
    const dir = mkdtempSync(join(tmpdir(), "via-register-"));
    try {
      const path = join(dir, "cache.json");
      expect(loadRegisterCache(path)).toBeNull();
      writeFileSync(path, "{");
      expect(loadRegisterCache(path)).toBeNull();
      writeFileSync(path, "null");
      expect(loadRegisterCache(path)).toBeNull();
      writeFileSync(path, JSON.stringify({ fetchedAt: 1, chargers: [] }));
      expect(loadRegisterCache(path)).toBeNull();
      writeFileSync(path, JSON.stringify({ fetchedAt: "2026-10-01T00:00:00Z", chargers: "no" }));
      expect(loadRegisterCache(path)).toBeNull();
      const cache = {
        fetchedAt: "2026-10-01T00:00:00Z",
        reportUrl: "https://ev.vialietuva.lt/report/1",
        chargers: [],
      };
      writeFileSync(path, JSON.stringify(cache));
      expect(loadRegisterCache(path)).toEqual(cache);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
