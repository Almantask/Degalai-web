import { extraMinutesFromKm, minutesAtMaxSpeed, netBenefit } from "../src/calc.ts";
import { formatDuration } from "../src/format.ts";
import { haversineKm, inLithuania, roadDistanceKm } from "../src/geo.ts";
import { pluralCategory, setLocale } from "../src/i18n/index.ts";
import { normalizeBrand } from "../src/brands.ts";
import { PRICE_RANGE } from "../scripts/validate.ts";
import { median } from "../scripts/history.ts";
import { jaccard, tokens } from "../scripts/match.ts";

describe("netBenefit", () => {
  it("matches the worked example from the plan", () => {
    // 0.05 €/l cheaper × 40 l = 2.00 €; detour 3.2 km ≈ 0.35 € fuel at 7 l/100km and 1.55 €/l
    const r = netBenefit({
      baselinePrice: 1.6,
      stationPrice: 1.55,
      litres: 40,
      extraKm: 3.2,
      extraMin: 4,
      consumptionLPer100km: 7,
      timeValueEurH: 0,
    });
    expect(r.savings).toBe(2);
    expect(r.fuelCost).toBeCloseTo(0.347, 2);
    expect(r.timeCost).toBe(0);
    expect(r.netBenefit).toBeCloseTo(1.653, 2);
  });

  it("counts time when a value of time is set", () => {
    const r = netBenefit({
      baselinePrice: 1.6,
      stationPrice: 1.55,
      litres: 40,
      extraKm: 3.2,
      extraMin: 30,
      consumptionLPer100km: 7,
      timeValueEurH: 10,
    });
    expect(r.timeCost).toBe(5);
    expect(r.netBenefit).toBeCloseTo(-3.347, 2);
  });

  it("is negative when the station is more expensive and there is a detour", () => {
    const r = netBenefit({
      baselinePrice: 1.5,
      stationPrice: 1.6,
      litres: 40,
      extraKm: 2,
      extraMin: extraMinutesFromKm(2),
      consumptionLPer100km: 7,
      timeValueEurH: 0,
    });
    expect(r.savings).toBeCloseTo(-4, 5);
    expect(r.netBenefit).toBeLessThan(0);
  });
});

describe("geo", () => {
  it("computes Vilnius–Kaunas haversine around 90 km", () => {
    const km = haversineKm({ lat: 54.687, lon: 25.28 }, { lat: 54.8985, lon: 23.9036 });
    expect(km).toBeGreaterThan(85);
    expect(km).toBeLessThan(105);
  });

  it("applies the road factor", () => {
    expect(roadDistanceKm({ lat: 0, lon: 0 }, { lat: 0, lon: 0 }, 1.3)).toBe(0);
  });

  it("recognises Lithuania and rejects a far origin", () => {
    expect(inLithuania({ lat: 54.687, lon: 25.28 })).toBe(true);
    expect(inLithuania({ lat: 37.39, lon: -122.08 })).toBe(false);
  });
});

describe("brands", () => {
  it("normalises Circle K and Statoil", () => {
    expect(normalizeBrand("UAB Circle K Lietuva")).toBe("circle-k");
    expect(normalizeBrand("Statoil")).toBe("circle-k");
    expect(normalizeBrand("Viada LT")).toBe("viada");
    expect(normalizeBrand("Random local")).toBe("independent");
  });
});

describe("validation ranges", () => {
  it("accepts typical Lithuanian prices", () => {
    expect(1.55).toBeGreaterThan(PRICE_RANGE["95"].min);
    expect(1.55).toBeLessThan(PRICE_RANGE["95"].max);
    expect(0.7).toBeGreaterThan(PRICE_RANGE.LPG.min);
  });
});

describe("median", () => {
  it("handles odd and even lists", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("address tokens", () => {
  it("scores similar addresses highly", () => {
    const a = tokens("Vilnius, Gariūnų g. 45");
    const b = tokens("Gariunu g 45 Vilnius");
    expect(jaccard(a, b)).toBeGreaterThan(0.4);
  });
});

describe("max-speed ETA", () => {
  it("is 60 minutes for 130 km at the motorway limit", () => {
    expect(minutesAtMaxSpeed(130)).toBe(60);
  });

  it("formats minutes and hours", () => {
    setLocale("lt");
    expect(formatDuration(0.2)).toBe("< 1 min");
    expect(formatDuration(8.2)).toBe("8 min");
    expect(formatDuration(60)).toBe("1 val.");
    expect(formatDuration(75)).toBe("1 val. 15 min");
    setLocale("en");
    expect(formatDuration(75)).toBe("1 h 15 min");
  });
});

describe("plurals", () => {
  it("uses Lithuanian one/few/other", () => {
    expect(pluralCategory(1, "lt")).toBe("one");
    expect(pluralCategory(2, "lt")).toBe("few");
    expect(pluralCategory(12, "lt")).toBe("other");
    expect(pluralCategory(21, "lt")).toBe("one");
    expect(pluralCategory(2, "en")).toBe("other");
  });
});
