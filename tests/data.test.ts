import { describe, expect, it, vi } from "vitest";
import {
  dataUrl,
  lastUpdatedAt,
  loadAppData,
  loadChargers,
  loadHistory,
  pricesObservedAt,
  sourceLabels,
} from "../src/data.ts";
import type { DailyPrices, DataMeta, HistoryFile, Station } from "../src/types.ts";

const prices: DailyPrices = {
  date: "2026-09-15",
  generatedAt: "2026-09-15T07:46:15.824Z",
  prices: {},
};

const meta: DataMeta = {
  date: "2026-09-15",
  generatedAt: "2026-09-15T07:46:15.859Z",
  stationCount: 1,
  pricedStationCount: 1,
  sources: ["lea"],
};

describe("lastUpdatedAt", () => {
  it("uses the price snapshot time, not a later unchanged check", () => {
    expect(
      lastUpdatedAt({
        prices,
        meta: { ...meta, checkedAt: "2026-09-15T12:17:00.000Z" },
      }),
    ).toBe(prices.generatedAt);
  });

  it("falls back to meta when a price file is missing", () => {
    expect(lastUpdatedAt({ prices, meta })).toBe(prices.generatedAt);
    expect(lastUpdatedAt({ prices: null, meta })).toBe(meta.generatedAt);
    expect(lastUpdatedAt({ prices: null, meta: null })).toBeUndefined();
  });
});

describe("pricesObservedAt", () => {
  it("is omitted when the pipeline has not recorded a source snapshot", () => {
    expect(pricesObservedAt({ prices, meta })).toBeUndefined();
  });

  it("returns the LEA snapshot when it differs from last updated", () => {
    expect(
      pricesObservedAt({
        prices,
        meta: {
          ...meta,
          observedAt: "2026-09-16T10:00:00+03:00",
          checkedAt: "2026-09-17T06:18:18.431Z",
        },
      }),
    ).toBe("2026-09-16T10:00:00+03:00");
  });

  it("hides a duplicate when last updated landed on the same minute as the snapshot", () => {
    expect(
      pricesObservedAt({
        prices: { ...prices, generatedAt: "2026-09-16T07:00:20.000Z" },
        meta: {
          ...meta,
          generatedAt: "2026-09-16T07:00:20.000Z",
          observedAt: "2026-09-16T10:00:00+03:00",
          checkedAt: "2026-09-16T12:00:00.000Z",
        },
      }),
    ).toBeUndefined();
  });
});

describe("dataUrl", () => {
  it("joins a data file onto the base", () => {
    expect(dataUrl("stations.json")).toBe("/data/stations.json");
    expect(dataUrl("stations.json", "")).toBe("/data/stations.json");
    expect(dataUrl("stations.json", "/")).toBe("/data/stations.json");
    expect(dataUrl("stations.json", "/Degalai-web")).toBe("/Degalai-web/data/stations.json");
    expect(dataUrl("meta.json", "/Degalai-web/")).toBe("/Degalai-web/data/meta.json");
  });
});

function stubFetch(handler: (url: string) => { ok: boolean; body?: unknown } | "throw"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const spec = handler(String(url));
      if (spec === "throw") throw new Error("offline");
      return { ok: spec.ok, json: async () => spec.body };
    }),
  );
}

describe("loadAppData", () => {
  it("loads stations, meta and that day's prices, or the fallbacks", async () => {
    const stations: Station[] = [
      { id: "s1", name: "S", brand: "neste", lat: 1, lon: 2, fuels: ["D"], sourceIds: {} },
    ];
    const meta: DataMeta = {
      date: "2026-09-15",
      generatedAt: "t",
      stationCount: 1,
      pricedStationCount: 1,
      sources: ["lea"],
    };
    const prices: DailyPrices = { date: "2026-09-15", generatedAt: "t", prices: {} };
    stubFetch((url) => {
      if (url.endsWith("stations.json")) return { ok: true, body: stations };
      if (url.endsWith("meta.json")) return { ok: true, body: meta };
      return { ok: true, body: prices };
    });
    await expect(loadAppData()).resolves.toEqual({ stations, prices, meta });

    stubFetch((url) => {
      if (url.endsWith("stations.json")) return { ok: true, body: [] };
      return { ok: true, body: { ...meta, date: null } };
    });
    await expect(loadAppData()).resolves.toEqual({
      stations: [],
      prices: null,
      meta: { ...meta, date: null },
    });

    stubFetch(() => ({ ok: false }));
    await expect(loadAppData()).resolves.toEqual({ stations: [], prices: null, meta: null });

    stubFetch(() => "throw");
    await expect(loadAppData()).resolves.toEqual({ stations: [], prices: null, meta: null });
    vi.unstubAllGlobals();
  });
});

describe("loadChargers", () => {
  it("returns the list, or nothing when the file is not an array", async () => {
    const chargers: Station[] = [
      { id: "c", name: "C", brand: "independent", lat: 1, lon: 2, fuels: ["EV"], sourceIds: {} },
    ];
    stubFetch(() => ({ ok: true, body: chargers }));
    await expect(loadChargers()).resolves.toEqual(chargers);
    stubFetch(() => ({ ok: true, body: { nope: true } }));
    await expect(loadChargers()).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("loadHistory", () => {
  it("returns the file only when it is an object with byFuel", async () => {
    const file: HistoryFile = { generatedAt: "t", keepDays: 7, byFuel: {} };
    stubFetch(() => ({ ok: true, body: file }));
    await expect(loadHistory()).resolves.toEqual(file);
    stubFetch(() => ({ ok: true, body: null }));
    await expect(loadHistory()).resolves.toBeNull();
    stubFetch(() => ({ ok: true, body: "x" }));
    await expect(loadHistory()).resolves.toBeNull();
    stubFetch(() => ({ ok: true, body: [] }));
    await expect(loadHistory()).resolves.toBeNull();
    stubFetch(() => ({ ok: true, body: { generatedAt: "t" } }));
    await expect(loadHistory()).resolves.toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("sourceLabels", () => {
  it("merges both LEA feeds and keeps ranked order for other sources", () => {
    expect(sourceLabels({ ...meta, sources: ["lea-live", "lea", "circle-k", "report"] })).toEqual([
      "lea",
      "circle-k",
      "report",
    ]);
    expect(sourceLabels({ ...meta, sources: ["circle-k", "lea"] })).toEqual(["circle-k", "lea"]);
  });

  it("falls back to LEA when the sources are empty or unknown", () => {
    expect(sourceLabels({ ...meta, sources: [] })).toEqual(["lea"]);
    expect(sourceLabels({ ...meta, sources: ["mystery"] })).toEqual(["lea"]);
    expect(sourceLabels(null)).toEqual(["lea"]);
  });
});
