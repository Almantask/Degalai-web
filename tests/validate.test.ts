import { describe, expect, it } from "vitest";
import {
  applyStale,
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
    daily.prices["ev:node:1"] = {
      EV: { price: 0.3, source: "osm-charge", observedAt: "2026-09-17T15:00:00Z" },
    };
    // Charger prices are not fuel observations and must not move the fuel snapshot time.
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

  it("rejects an empty candidate list", () => {
    expect(() => pickPrice([], policy(["lea"]))).toThrow(/at least one/);
  });

  it("breaks a stale tie on the same source by the later observation", () => {
    const rows = [
      row("lea", 2.1, "2026-09-18T08:00:00+03:00"),
      row("lea", 2.2, "2026-09-18T12:00:00+03:00"),
    ];
    expect(pickPrice(rows, policy(["lea"], "2026-09-21T08:00:00+03:00")).price).toBe(2.2);
  });
});

describe("observationsToDaily edges", () => {
  const previous: DailyPrices = {
    date: "2026-09-16",
    generatedAt: "2026-09-16T08:00:00.000Z",
    prices: {
      "osm:way:138809868": {
        D: { price: 1.2, source: "lea", observedAt: "2026-09-16T08:00:00+03:00" },
      },
    },
  };

  it("drops a price outside the fuel range", () => {
    const { daily, log } = observationsToDaily(
      "2026-09-17",
      [row("lea", 9, "2026-09-17T10:00:00+03:00")],
      null,
    );
    expect(daily.prices).toEqual({});
    expect(log.dropped).toEqual([
      { stationId: "osm:way:138809868", fuel: "D", price: 9, reason: "out_of_range" },
    ]);
  });

  it("flags a jump of more than 15 percent", () => {
    const { daily, log } = observationsToDaily(
      "2026-09-17",
      [row("lea", 1.5, "2026-09-17T10:00:00+03:00")],
      previous,
    );
    expect(daily.prices["osm:way:138809868"]?.D?.suspicious).toBe(true);
    expect(log.suspicious[0]).toMatchObject({ prev: 1.2, next: 1.5 });
  });

  it("does not compare against a zero previous price", () => {
    const zero: DailyPrices = {
      ...previous,
      prices: {
        "osm:way:138809868": {
          D: { price: 0, source: "lea", observedAt: "2026-09-16T08:00:00+03:00" },
        },
      },
    };
    const { daily } = observationsToDaily(
      "2026-09-17",
      [row("lea", 1.5, "2026-09-17T10:00:00+03:00")],
      zero,
    );
    expect(daily.prices["osm:way:138809868"]?.D?.suspicious).toBeUndefined();
  });

  it("reads a lea id as lea when the row has no source", () => {
    const { daily } = observationsToDaily(
      "2026-09-17",
      [
        row("lea", 1.5, "2026-09-17T10:00:00+03:00", {
          source: undefined,
          sourceStationId: "lea:1",
        }),
      ],
      null,
    );
    expect(daily.prices["lea:1"]?.D?.source).toBe("lea");
  });

  it("reads an unprefixed id as unknown when the row has no source", () => {
    const { daily } = observationsToDaily(
      "2026-09-17",
      [
        row("lea", 1.5, "2026-09-17T10:00:00+03:00", {
          source: undefined,
          sourceStationId: "station-1",
        }),
      ],
      null,
    );
    expect(daily.prices["station-1"]?.D?.source).toBe("unknown");
  });
});

describe("latestObservedAt order", () => {
  it("keeps the newer of two pump fuels", () => {
    const snap: DailyPrices = {
      ...snapshot,
      prices: {
        a: {
          D: { price: 1.2, source: "lea", observedAt: "2026-09-15T07:00:00+03:00" },
          "95": { price: 1.4, source: "lea", observedAt: "2026-09-15T06:00:00+03:00" },
        },
      },
    };
    expect(latestObservedAt(snap)).toBe("2026-09-15T07:00:00+03:00");
  });
});

describe("applyStale", () => {
  const price = (n: number, at: string) => ({ price: n, source: "lea", observedAt: at });
  const snap = (date: string, prices: DailyPrices["prices"]): DailyPrices => ({
    date,
    generatedAt: `${date}T08:00:00.000Z`,
    prices,
  });

  it("returns the snapshot when there is no previous day", () => {
    const next = snap("2026-09-15", {});
    expect(applyStale(next, null, null)).toBe(next);
  });

  it("drops a previous day older than a week", () => {
    const next = snap("2026-09-15", {});
    const prev = snap("2026-09-01", { a: { D: price(1.2, "2026-09-01T08:00:00Z") } });
    expect(applyStale(next, prev, "2026-09-01").prices.a).toBeUndefined();
  });

  it("marks a price stale when the previous day is more than two days old", () => {
    const next = snap("2026-09-15", {});
    const prev = snap("2026-09-12", { a: { D: price(1.2, "2026-09-12T08:00:00Z") } });
    expect(applyStale(next, prev, "2026-09-12").prices.a?.D).toMatchObject({
      price: 1.2,
      stale: true,
    });
  });

  it("keeps today's price and carries the missing fuel as stale", () => {
    const next = snap("2026-09-15", { a: { "95": price(1.5, "2026-09-15T08:00:00Z") } });
    const prev = snap("2026-09-14", {
      a: {
        D: price(1.2, "2026-09-14T08:00:00Z"),
        "95": price(1.4, "2026-09-14T08:00:00Z"),
      },
    });
    const result = applyStale(next, prev, "2026-09-14");
    expect(result.prices.a?.D).toMatchObject({ price: 1.2, stale: true });
    expect(result.prices.a?.["95"]?.stale).toBeUndefined();
  });

  it("assumes one day when the previous date is unknown", () => {
    const next = snap("2026-09-15", {});
    const prev = snap("2026-09-14", { b: { LPG: price(0.8, "2026-09-14T08:00:00Z") } });
    expect(applyStale(next, prev, null).prices.b?.LPG).toMatchObject({ stale: true, price: 0.8 });
  });
});
