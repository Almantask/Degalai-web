import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chargerPrices,
  countBySource,
  EV_TARIFF_SOURCE,
  isDcCharger,
  loadEvTariffs,
  mergeChargerPrices,
  OSM_CHARGE_SOURCE,
  type EvTariff,
} from "../scripts/adapters/ev-tariffs.ts";
import { VIA_LIETUVA_SOURCE } from "../scripts/adapters/via-lietuva.ts";
import type { Station } from "../src/types.ts";

const NOW = new Date("2026-10-06T12:00:00Z");

function charger(id: string, brand: string, ev: Partial<NonNullable<Station["ev"]>> = {}): Station {
  return {
    id,
    name: id,
    brand,
    lat: 54.7,
    lon: 25.3,
    fuels: ["EV"],
    sourceIds: {},
    ev: { sockets: ["type2"], ...ev },
  };
}

const TARIFFS: EvTariff[] = [
  { network: "Ignitis ON", ac: 0.29, dc: 0.39, observedAt: "2026-10-01T00:00:00Z" },
];

describe("loadEvTariffs", () => {
  it("loads tariffs and drops entries that are not a price", () => {
    const dir = mkdtempSync(join(tmpdir(), "ev-tariffs-"));
    try {
      const path = join(dir, "tariffs.json");
      expect(loadEvTariffs(join(dir, "missing.json"))).toEqual([]);
      writeFileSync(path, "{}");
      expect(loadEvTariffs(path)).toEqual([]);
      const kept = [
        { network: "Ignitis ON", ac: 0.29, observedAt: "2026-10-01T00:00:00Z" },
        { network: "Eleport", dc: 0.41, observedAt: "2026-10-02T00:00:00Z" },
        { network: "Enefit", ac: 0.2, dc: 0.4, observedAt: "2026-10-03T00:00:00Z" },
      ];
      writeFileSync(
        path,
        JSON.stringify([
          null,
          "x",
          { network: "  ", ac: 0.3, observedAt: "2026-10-01T00:00:00Z" },
          { network: 1, ac: 0.3, observedAt: "2026-10-01T00:00:00Z" },
          { network: "Ignitis ON", ac: 0.3, observedAt: "nope" },
          { network: "Ignitis ON", ac: 0.3, observedAt: 1 },
          { network: "Ignitis ON", observedAt: "2026-10-01T00:00:00Z" },
          { network: "Ignitis ON", ac: "0.3", observedAt: "2026-10-01T00:00:00Z" },
          { network: "Ignitis ON", ac: Number.NaN, observedAt: "2026-10-01T00:00:00Z" },
          ...kept,
        ]),
      );
      expect(loadEvTariffs(path)).toEqual(kept);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("isDcCharger", () => {
  it("treats 50 kW+ or CCS / CHAdeMO sockets as DC", () => {
    expect(isDcCharger(charger("a", "x", { maxKw: 50 }))).toBe(true);
    expect(isDcCharger(charger("b", "x", { sockets: ["type2_combo"] }))).toBe(true);
    expect(isDcCharger(charger("c", "x", { maxKw: 22 }))).toBe(false);
  });
});

describe("chargerPrices", () => {
  it("applies the network AC or DC tariff by charger type", () => {
    const prices = chargerPrices(
      [
        charger("ac", "ignitis-on", { maxKw: 22 }),
        charger("dc", "ignitis-on", { maxKw: 150, sockets: ["type2_combo"] }),
      ],
      TARIFFS,
      NOW,
    );
    expect(prices.ac?.EV).toMatchObject({ price: 0.29, source: EV_TARIFF_SOURCE });
    expect(prices.dc?.EV).toMatchObject({ price: 0.39, source: EV_TARIFF_SOURCE });
  });

  it("ranks the register over network tariffs over OSM tags", () => {
    const all = charger("a", "ignitis-on", { maxKw: 22, chargeTag: 0.33, registerPrice: 0.27 });
    const prices = chargerPrices(
      [
        all,
        charger("b", "ignitis-on", { maxKw: 22, chargeTag: 0.33 }),
        charger("c", "x", { chargeTag: 0.33 }),
      ],
      TARIFFS,
      NOW,
    );
    expect(prices.a?.EV).toMatchObject({ price: 0.27, source: VIA_LIETUVA_SOURCE });
    expect(prices.b?.EV).toMatchObject({ price: 0.29, source: EV_TARIFF_SOURCE });
    expect(prices.c?.EV).toEqual({
      price: 0.33,
      source: OSM_CHARGE_SOURCE,
      observedAt: NOW.toISOString(),
    });
    expect(countBySource(prices)).toEqual({ "via-lietuva": 1, "ev-tariff": 1, "osm-charge": 1 });
  });

  it("keeps free register chargers at 0 and skips a lower source's out-of-range price", () => {
    const prices = chargerPrices(
      [
        charger("free", "x", { registerPrice: 0, chargeTag: 0.4 }),
        charger("bad", "x", { chargeTag: 7 }),
      ],
      [],
      NOW,
    );
    expect(prices.free?.EV).toMatchObject({ price: 0, source: VIA_LIETUVA_SOURCE });
    expect(prices.bad).toBeUndefined();
  });

  it("keeps an unchanged tag price's first observation so hourly runs stay identical", () => {
    const first = chargerPrices([charger("a", "x", { chargeTag: 0.33 })], [], NOW);
    const later = new Date("2026-10-06T13:00:00Z");
    const previous = { date: "2026-10-06", generatedAt: NOW.toISOString(), prices: first };
    const again = chargerPrices([charger("a", "x", { chargeTag: 0.33 })], [], later, previous);
    expect(again).toEqual(first);
    const changed = chargerPrices([charger("a", "x", { chargeTag: 0.35 })], [], later, previous);
    expect(changed.a?.EV?.observedAt).toBe(later.toISOString());
  });

  it("leaves unknown networks and out-of-range prices unpriced", () => {
    const prices = chargerPrices(
      [charger("other", "independent"), charger("bad", "eleport")],
      [{ network: "Eleport", ac: 9, observedAt: "2026-10-01T00:00:00Z" }],
      NOW,
    );
    expect(prices).toEqual({});
  });

  it("falls back to the other tariff when only one is published", () => {
    const prices = chargerPrices(
      [charger("dc", "enefit", { maxKw: 120 }), charger("ac", "eleport", { maxKw: 22 })],
      [
        { network: "Enefit Volt", ac: 0.3, observedAt: "2026-10-01T00:00:00Z" },
        { network: "Eleport", dc: 0.35, observedAt: "2026-10-01T00:00:00Z" },
      ],
      NOW,
    );
    expect(prices.dc?.EV?.price).toBe(0.3);
    expect(prices.ac?.EV?.price).toBe(0.35);
  });

  it("keeps the newest tariff for a network and ignores an unknown network", () => {
    const prices = chargerPrices(
      [charger("a", "ignitis-on", { maxKw: 22 })],
      [
        { network: "Ignitis ON", ac: 0.29, observedAt: "2026-10-01T00:00:00Z" },
        { network: "Ignitis", ac: 0.33, observedAt: "2026-10-06T00:00:00Z" },
        { network: "Ignitis ON", ac: 0.2, observedAt: "2026-09-01T00:00:00Z" },
        { network: "Local Farm", ac: 0.4, observedAt: "2026-10-01T00:00:00Z" },
      ],
      NOW,
    );
    expect(prices.a?.EV?.price).toBe(0.33);
  });
});

describe("mergeChargerPrices", () => {
  it("adds EV entries without touching pump prices", () => {
    const observedAt = "2026-10-06T07:00:00Z";
    const daily = {
      date: "2026-10-06",
      generatedAt: observedAt,
      prices: { s: { D: { price: 1.5, source: "lea", observedAt } } },
    };
    mergeChargerPrices(daily, { c: { EV: { price: 0.3, source: "ev-tariff", observedAt } } });
    expect(Object.keys(daily.prices).sort()).toEqual(["c", "s"]);
    expect(daily.prices.s.D.price).toBe(1.5);
  });
});
