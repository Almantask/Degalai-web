import { describe, expect, it } from "vitest";
import {
  firstObservedAt,
  latestObservedAt,
  observationsToDaily,
  reuseGeneratedAtIfUnchanged,
} from "../scripts/validate.ts";
import type { DailyPrices, Observation } from "../src/types.ts";

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

describe("firstObservedAt", () => {
  it("returns the first price observation in the snapshot", () => {
    expect(firstObservedAt(snapshot)).toBe("2026-09-15T07:00:00+03:00");
  });

  it("is undefined when no prices were recorded", () => {
    expect(firstObservedAt({ ...snapshot, prices: {} })).toBeUndefined();
  });
});

const row = (
  source: string,
  price: number,
  observedAt: string,
  extras: Partial<Observation> = {},
): Observation => ({
  sourceStationId: extras.sourceStationId ?? "osm:way:138809868",
  brand: "circle-k",
  fuel: "D",
  price,
  observedAt,
  source,
  ...extras,
});

describe("observationsToDaily", () => {
  it("keeps lea-live after OSM remap even when Excel is stamped later the same morning", () => {
    const { daily } = observationsToDaily(
      "2026-09-17",
      [
        row("lea", 2.284, "2026-09-17T10:00:00+03:00"),
        row("lea-live", 2.254, "2026-09-17T09:45:16+03:00"),
      ],
      null,
    );
    expect(daily.prices["osm:way:138809868"]?.D).toMatchObject({
      price: 2.254,
      source: "lea-live",
      observedAt: "2026-09-17T09:45:16+03:00",
    });
    expect(latestObservedAt(daily)).toBe("2026-09-17T09:45:16+03:00");
  });

  it("lets a later live row replace a user report", () => {
    const { daily } = observationsToDaily(
      "2026-09-17",
      [
        row("report", 2.199, "2026-09-17T12:00:00+03:00"),
        row("lea-live", 2.254, "2026-09-17T15:00:00+03:00"),
      ],
      null,
    );
    expect(daily.prices["osm:way:138809868"]?.D).toMatchObject({
      price: 2.254,
      source: "lea-live",
    });
  });

  it("falls back to lea when an OSM id has no adapter source", () => {
    const { daily } = observationsToDaily(
      "2026-09-17",
      [row("lea", 2.2, "2026-09-17T10:00:00+03:00", { source: undefined })],
      null,
    );
    expect(daily.prices["osm:way:138809868"]?.D?.source).toBe("lea");
  });
});
