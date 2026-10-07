import { describe, expect, it } from "vitest";
import {
  addSocketKw,
  chargerFits,
  evPricesFor,
  fittingPrice,
  isDcSocket,
  plugGroup,
  socketKw,
  type EvFilter,
} from "../src/ev-filter.ts";
import type { ChargerInfo, DailyPrices, PriceEntry, Station } from "../src/types.ts";

function charger(id: string, ev: ChargerInfo): Station {
  return {
    id,
    name: id,
    brand: "independent",
    lat: 54.7,
    lon: 25.3,
    fuels: ["EV"],
    sourceIds: {},
    ev,
  };
}

const any: EvFilter = { excludedPlugs: [], minKw: 0 };
const fast: EvFilter = { excludedPlugs: [], minKw: 50 };
const ultra: EvFilter = { excludedPlugs: [], minKw: 150 };
const type2Only: EvFilter = { excludedPlugs: ["ccs", "chademo", "other"], minKw: 0 };

// Shapes seen in the register: a logistics centre with AC and DC, a CCS-only motorway site,
// a street-light Type 2 and a triple-standard 50 kW unit.
const mixed = charger("vl:ELD-E-T351", {
  sockets: ["type2", "type2_combo"],
  maxKw: 200,
  kwBySocket: { type2: 22, type2_combo: 200 },
  registerPrice: 0.29,
  prices: { ac: 0.29, dc: 0.37 },
});
const motorway = charger("vl:008-E-0012", {
  sockets: ["type2_combo"],
  maxKw: 150,
  registerPrice: 0.38,
  prices: { dc: 0.38 },
});
const street = charger("vl:IBG-E-ENJH", {
  sockets: ["type2"],
  maxKw: 11,
  kwBySocket: { type2: 11 },
  registerPrice: 0.29,
  prices: { ac: 0.29 },
});
const triple = charger("vl:LLT-E-TF4N", {
  sockets: ["chademo", "type2", "type2_combo"],
  maxKw: 50,
  kwBySocket: { chademo: 50, type2: 22, type2_combo: 50 },
  registerPrice: 0.3,
  prices: { ac: 0.3, dc: 0.36 },
});

const entry = (s: Station, source = "via-lietuva"): PriceEntry => ({
  price: s.ev!.registerPrice!,
  source,
  observedAt: "2026-10-07T10:00:00Z",
});

describe("plug groups", () => {
  it("files socket kinds under the plugs the settings offer", () => {
    expect(plugGroup("type2")).toBe("type2");
    expect(plugGroup("type2_cable")).toBe("type2");
    expect(plugGroup("type2_combo")).toBe("ccs");
    expect(plugGroup("chademo")).toBe("chademo");
    expect(plugGroup("tesla_supercharger")).toBe("other");
    expect(plugGroup("type1_combo")).toBe("other");
    expect(plugGroup("schuko")).toBe("other");
  });

  it("knows which sockets charge on DC", () => {
    expect(["type2_combo", "chademo", "tesla_supercharger"].every(isDcSocket)).toBe(true);
    expect(["type2", "type2_cable", "schuko"].some(isDcSocket)).toBe(false);
  });
});

describe("socketKw", () => {
  it("reads the socket's own power, or the site's top power when it has one kind of socket", () => {
    expect(socketKw(mixed.ev!, "type2")).toBe(22);
    expect(socketKw(motorway.ev!, "type2_combo")).toBe(150);
    expect(socketKw({ sockets: ["type2", "type2_combo"], maxKw: 150 }, "type2")).toBeUndefined();
  });
});

describe("chargerFits", () => {
  it("keeps every charger with no filter on, even one with no data", () => {
    expect(chargerFits(charger("ev:node:1", { sockets: [] }), any)).toBe(true);
  });

  it("keeps a charger with a fast socket and drops slow ones", () => {
    expect(chargerFits(mixed, fast)).toBe(true);
    expect(chargerFits(motorway, ultra)).toBe(true);
    expect(chargerFits(street, fast)).toBe(false);
    expect(chargerFits(triple, ultra)).toBe(false);
  });

  it("needs the chosen plug itself to be fast, not some other socket at the site", () => {
    expect(chargerFits(mixed, type2Only)).toBe(true);
    expect(chargerFits(mixed, { ...type2Only, minKw: 50 })).toBe(false);
    expect(chargerFits(motorway, type2Only)).toBe(false);
  });

  it("drops a socket of unknown power from a power filter", () => {
    const unknown = charger("ev:node:2", { sockets: ["type2", "type2_combo"], maxKw: 150 });
    expect(chargerFits(unknown, fast)).toBe(false);
    expect(chargerFits(unknown, { excludedPlugs: ["chademo"], minKw: 0 })).toBe(true);
  });

  it("judges a charger with no socket data by its top power, and only for power", () => {
    const bare = charger("ev:node:3", { sockets: [], maxKw: 150 });
    expect(chargerFits(bare, fast)).toBe(true);
    expect(chargerFits(bare, { excludedPlugs: ["chademo"], minKw: 0 })).toBe(false);
    expect(chargerFits(charger("ev:node:4", { sockets: [] }), fast)).toBe(false);
  });
});

describe("fittingPrice", () => {
  it("keeps the published price with no filter on", () => {
    expect(fittingPrice(mixed, entry(mixed), any)).toBe(0.29);
  });

  it("prices a fast-charge search at DC, not the cheaper AC", () => {
    expect(fittingPrice(mixed, entry(mixed), fast)).toBe(0.37);
    expect(fittingPrice(triple, entry(triple), fast)).toBe(0.36);
  });

  it("prices a Type 2 search at AC, and has no price where the register prices only DC", () => {
    expect(fittingPrice(mixed, entry(mixed), type2Only)).toBe(0.29);
    expect(fittingPrice(triple, entry(triple), { excludedPlugs: ["ccs"], minKw: 0 })).toBe(0.3);
    const dcOnlyPriced = charger("vl:X", { ...mixed.ev!, prices: { dc: 0.37 } });
    expect(fittingPrice(dcOnlyPriced, entry(mixed), type2Only)).toBeUndefined();
  });

  it("keeps a single-price source as it is", () => {
    expect(fittingPrice(mixed, entry(mixed, "osm-charge"), fast)).toBe(0.29);
  });
});

describe("evPricesFor", () => {
  const prices: DailyPrices = {
    date: "2026-10-07",
    generatedAt: "2026-10-07T10:00:00Z",
    prices: {
      [mixed.id]: { EV: entry(mixed) },
      [street.id]: { EV: entry(street) },
      "osm:node:9": { D: { price: 1.5, source: "lea", observedAt: "x" } },
    },
  };

  it("is the same snapshot with no filter on", () => {
    expect(evPricesFor(prices, [mixed, street], any)).toBe(prices);
  });

  it("swaps in the fitting price and drops one the filter cannot price", () => {
    const dcOnlyPriced = charger(street.id, { ...street.ev!, prices: { dc: 0.4 } });
    const out = evPricesFor(prices, [mixed, dcOnlyPriced], type2Only);
    expect(out.prices[mixed.id]?.EV?.price).toBe(0.29);
    expect(out.prices[street.id]).toEqual({});
    const fastOut = evPricesFor(prices, [mixed, street], fast);
    expect(fastOut.prices[mixed.id]?.EV).toMatchObject({ price: 0.37, source: "via-lietuva" });
    expect(fastOut.prices["osm:node:9"]).toBe(prices.prices["osm:node:9"]);
    expect(prices.prices[mixed.id]?.EV?.price).toBe(0.29);
  });
});

describe("addSocketKw", () => {
  it("keeps the highest power per socket and never edits a shared map", () => {
    const shared = { type2: 11 };
    const ev: ChargerInfo = { sockets: ["type2"], kwBySocket: shared };
    addSocketKw(ev, "type2", 22);
    addSocketKw(ev, "type2", 7.4);
    addSocketKw(ev, "type2_combo", 150);
    expect(ev.kwBySocket).toEqual({ type2: 22, type2_combo: 150 });
    expect(shared).toEqual({ type2: 11 });
  });
});
