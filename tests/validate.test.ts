import { describe, expect, it } from "vitest";
import {
  firstObservedAt,
  latestObservedAt,
  observationsToDaily,
  pickPrice,
  reuseGeneratedAtIfUnchanged,
  type SelectionPolicy,
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

describe("pickPrice", () => {
  const policy = (order: string[], now = "2026-09-17T16:00:00+03:00"): SelectionPolicy => ({
    order,
    maxAgeHours: { "lea-live": 36, lea: 36, "circle-k": 36 },
    now: new Date(now),
  });
  const pick = (rows: Observation[], p: SelectionPolicy) => {
    const forward = pickPrice(rows, p);
    // Selection is per group, so input order must never change the winner.
    expect(pickPrice([...rows].reverse(), p)).toEqual(forward);
    return forward;
  };

  it("uses the most reliable fresh source even when a lower-ranked one is newer", () => {
    const rows = [
      row("circle-k", 2.229, "2026-09-17T00:00:00+03:00"),
      row("lea-live", 2.254, "2026-09-16T15:00:00+03:00"),
      row("lea", 2.284, "2026-09-17T10:00:00+03:00"),
    ];
    expect(pick(rows, policy(["lea-live", "lea", "circle-k"])).source).toBe("lea-live");
    expect(pick(rows, policy(["lea", "circle-k", "lea-live"])).source).toBe("lea");
  });

  it("falls back to a lower-ranked source when the preferred price has gone stale", () => {
    const rows = [
      row("lea-live", 2.254, "2026-09-15T09:00:00+03:00"),
      row("circle-k", 2.229, "2026-09-17T00:00:00+03:00"),
    ];
    expect(pick(rows, policy(["lea-live", "lea", "circle-k"])).source).toBe("circle-k");
  });

  it("with nothing fresh, takes the newest Vilnius day and then the ranking", () => {
    const monday = "2026-09-21T08:00:00+03:00";
    const rows = [
      row("lea", 2.284, "2026-09-18T10:00:00+03:00"),
      row("lea-live", 2.254, "2026-09-18T09:45:00+03:00"),
      row("circle-k", 2.199, "2026-09-17T00:00:00+03:00"),
    ];
    expect(pick(rows, policy(["lea-live", "lea", "circle-k"], monday))).toMatchObject({
      source: "lea-live",
      price: 2.254,
    });
    expect(pick(rows, policy(["circle-k", "lea", "lea-live"], monday)).source).toBe("lea");
  });

  it("applies a user report unless the ranked winner was observed later", () => {
    const report = row("report", 2.199, "2026-09-17T12:00:00+03:00");
    const order = ["lea-live", "lea", "circle-k"];
    expect(
      pick([report, row("lea", 2.284, "2026-09-17T10:00:00+03:00")], policy(order)).source,
    ).toBe("report");
    expect(
      pick([report, row("lea-live", 2.254, "2026-09-17T15:00:00+03:00")], policy(order)).source,
    ).toBe("lea-live");
  });

  it("ranks sources missing from the order last", () => {
    const rows = [
      row("mystery", 2.1, "2026-09-17T15:00:00+03:00"),
      row("lea", 2.2, "2026-09-17T10:00:00+03:00"),
    ];
    expect(pick(rows, policy(["lea-live", "lea"])).source).toBe("lea");
  });

  it("keeps the later row on an exact tie, as two LEA sites matched to one station did before", () => {
    const at = "2026-09-17T09:33:05+03:00";
    const order = ["lea-live", "lea", "circle-k"];
    const first = row("lea-live", 1.859, at);
    const second = row("lea-live", 1.899, at);
    expect(pickPrice([first, second], policy(order)).price).toBe(1.899);
    expect(pickPrice([second, first], policy(order)).price).toBe(1.859);
  });

  it("passes the policy through observationsToDaily", () => {
    const { daily } = observationsToDaily(
      "2026-09-17",
      [
        row("lea-live", 2.254, "2026-09-17T09:45:16+03:00"),
        row("lea", 2.284, "2026-09-17T10:00:00+03:00"),
      ],
      null,
      policy(["lea", "lea-live", "circle-k"]),
    );
    expect(daily.prices["osm:way:138809868"]?.D).toMatchObject({ price: 2.284, source: "lea" });
  });
});
