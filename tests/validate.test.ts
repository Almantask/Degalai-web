import { describe, expect, it } from "vitest";
import { reuseGeneratedAtIfUnchanged } from "../scripts/validate.ts";
import type { DailyPrices } from "../src/types.ts";

const snapshot: DailyPrices = {
  date: "2026-09-15",
  generatedAt: "2026-09-15T07:46:15.824Z",
  prices: {
    a: { D: { price: 1.2, source: "lea", observedAt: "2026-09-15T07:00:00+03:00" } },
  },
};

describe("reuseGeneratedAtIfUnchanged", () => {
  it("keeps the previous timestamp when this check found the same prices", () => {
    const next: DailyPrices = {
      ...snapshot,
      generatedAt: "2026-09-15T12:17:00.000Z",
      prices: {
        a: { D: { price: 1.2, source: "lea", observedAt: "2026-09-15T07:00:00+03:00" } },
      },
    };
    expect(reuseGeneratedAtIfUnchanged(snapshot, next).generatedAt).toBe(snapshot.generatedAt);
  });

  it("uses the new timestamp when prices changed", () => {
    const next: DailyPrices = {
      ...snapshot,
      generatedAt: "2026-09-15T12:17:00.000Z",
      prices: {
        a: { D: { price: 1.25, source: "lea", observedAt: "2026-09-15T07:00:00+03:00" } },
      },
    };
    expect(reuseGeneratedAtIfUnchanged(snapshot, next).generatedAt).toBe(next.generatedAt);
  });
});
