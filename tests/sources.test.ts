import { describe, expect, it, vi } from "vitest";
import { PROVIDERS, runProviders, skippedSources, type PriceProvider } from "../scripts/sources.ts";
import { SOURCE_META } from "../scripts/source-health.ts";
import type { Observation } from "../src/types.ts";

const adapters = vi.hoisted(() => ({
  fetchLeaWorkbook: vi.fn(),
  fetchLeaLive: vi.fn(),
  fetchCircleK: vi.fn(),
}));

vi.mock("../scripts/adapters/lea.ts", () => ({
  fetchLeaWorkbook: adapters.fetchLeaWorkbook,
}));
vi.mock("../scripts/adapters/lea-live.ts", () => ({
  fetchLeaLive: adapters.fetchLeaLive,
}));
vi.mock("../scripts/adapters/circle-k.ts", () => ({
  fetchCircleK: adapters.fetchCircleK,
}));

const obs = (observedAt: string): Observation => ({
  sourceStationId: "lea:x",
  brand: "viada",
  fuel: "D",
  price: 2.2,
  observedAt,
});

const provider = (name: string, fetch: PriceProvider["fetch"]): PriceProvider => ({
  name,
  seedScore: 0.5,
  maxAgeHours: 36,
  minRows: 1,
  fetch,
});

const ctx = () => ({ requested: "2026-09-17", leaByDate: new Map(), leaDate: null });
const at = () => new Date("2026-09-17T09:00:00Z");

describe("PROVIDERS", () => {
  it("has a fetcher for every ranked source", () => {
    expect(PROVIDERS.map((p) => p.name)).toEqual(SOURCE_META.map((m) => m.name));
  });
});

describe("skippedSources", () => {
  it("parses a comma-separated list", () => {
    expect([...skippedSources(" lea-live, circle-k ,")]).toEqual(["lea-live", "circle-k"]);
    expect(skippedSources(undefined).size).toBe(0);
  });
});

describe("runProviders", () => {
  it("logs a run per source and never throws when one fails", async () => {
    const { byProvider, runs } = await runProviders(
      ctx(),
      [
        provider("good", async () => [
          obs("2026-09-17T09:00:00+03:00"),
          obs("2026-09-17T11:00:00+03:00"),
        ]),
        provider("broken", async () => {
          throw new Error("HTTP 500");
        }),
        provider("skipped", async () => [obs("2026-09-17T10:00:00+03:00")]),
      ],
      { skip: new Set(["skipped"]), now: at },
    );
    expect(byProvider.good).toHaveLength(2);
    expect(byProvider.broken).toEqual([]);
    expect(byProvider.skipped).toEqual([]);
    expect(runs.map(({ ms: _ms, ...r }) => r)).toEqual([
      {
        name: "good",
        at: "2026-09-17T09:00:00.000Z",
        ok: true,
        rows: 2,
        newestObservedAt: "2026-09-17T11:00:00+03:00",
      },
      { name: "broken", at: "2026-09-17T09:00:00.000Z", ok: false, rows: 0, error: "HTTP 500" },
      {
        name: "skipped",
        at: "2026-09-17T09:00:00.000Z",
        ok: false,
        rows: 0,
        error: "skipped by PIPELINE_SKIP_SOURCES",
      },
    ]);
  });

  it("fails a source that does not answer in time", async () => {
    const { runs } = await runProviders(
      ctx(),
      [provider("slow", () => new Promise<Observation[]>(() => {}))],
      { skip: new Set(), timeoutMs: 20, now: at },
    );
    expect(runs[0]).toMatchObject({ ok: false, error: "slow timed out after 20 ms" });
  });

  it("stamps runs with the current time when no clock is passed", async () => {
    const before = Date.now();
    const { runs } = await runProviders(ctx(), [provider("x", async () => [])], {
      skip: new Set(),
      timeoutMs: 1000,
    });
    expect(Date.parse(runs[0].at)).toBeGreaterThanOrEqual(before);
    expect(runs[0].ok).toBe(true);
  });

  it("skips nothing when the option and the env are empty", async () => {
    const prev = process.env.PIPELINE_SKIP_SOURCES;
    delete process.env.PIPELINE_SKIP_SOURCES;
    try {
      const { byProvider } = await runProviders(
        ctx(),
        [provider("x", async () => [obs("2026-09-17T09:00:00Z")])],
        { now: at },
      );
      expect(byProvider.x).toHaveLength(1);
    } finally {
      if (prev === undefined) delete process.env.PIPELINE_SKIP_SOURCES;
      else process.env.PIPELINE_SKIP_SOURCES = prev;
    }
  });

  it("stringifies a rejection that is not an Error", async () => {
    const { runs } = await runProviders(
      ctx(),
      [
        provider("bad", async () => {
          throw "disk full";
        }),
      ],
      { skip: new Set(), now: at },
    );
    expect(runs[0]).toMatchObject({ ok: false, error: "disk full" });
  });

  it("loads the lea workbook day on or before the request", async () => {
    adapters.fetchLeaWorkbook.mockResolvedValueOnce(
      new Map([["2026-09-16", [obs("2026-09-16T10:00:00+03:00")]]]),
    );
    const context = ctx();
    const lea = PROVIDERS.find((p) => p.name === "lea")!;
    const { byProvider } = await runProviders(context, [lea], { skip: new Set(), now: at });
    expect(context.leaDate).toBe("2026-09-16");
    expect(byProvider.lea).toHaveLength(1);
  });

  it("returns no lea rows when the workbook is empty", async () => {
    adapters.fetchLeaWorkbook.mockResolvedValueOnce(new Map());
    const context = ctx();
    const lea = PROVIDERS.find((p) => p.name === "lea")!;
    const { byProvider } = await runProviders(context, [lea], { skip: new Set(), now: at });
    expect(context.leaDate).toBeNull();
    expect(byProvider.lea).toEqual([]);
  });

  it("returns no lea rows when the floor date is missing from the workbook", async () => {
    const map = new Map<string, Observation[]>();
    vi.spyOn(map, "has").mockReturnValue(true);
    vi.spyOn(map, "get").mockReturnValue(undefined);
    adapters.fetchLeaWorkbook.mockResolvedValueOnce(map);
    const context = ctx();
    const lea = PROVIDERS.find((p) => p.name === "lea")!;
    const { byProvider } = await runProviders(context, [lea], { skip: new Set(), now: at });
    expect(context.leaDate).toBe("2026-09-17");
    expect(byProvider.lea).toEqual([]);
  });

  it("fetches lea-live through the ranked provider", async () => {
    adapters.fetchLeaLive.mockResolvedValueOnce([obs("2026-09-17T09:00:00+03:00")]);
    const live = PROVIDERS.find((p) => p.name === "lea-live")!;
    const { byProvider } = await runProviders(ctx(), [live], { skip: new Set(), now: at });
    expect(byProvider["lea-live"]).toHaveLength(1);
    expect(adapters.fetchLeaLive).toHaveBeenCalled();
  });

  it("fetches Circle K through the ranked provider", async () => {
    adapters.fetchCircleK.mockResolvedValueOnce([obs("2026-09-17T00:00:00+03:00")]);
    const circle = PROVIDERS.find((p) => p.name === "circle-k")!;
    const { byProvider } = await runProviders(ctx(), [circle], { skip: new Set(), now: at });
    expect(byProvider["circle-k"]).toHaveLength(1);
    expect(adapters.fetchCircleK).toHaveBeenCalled();
  });
});

describe("PROVIDERS without a fetcher", () => {
  it("throws when a ranked source has no fetcher", async () => {
    vi.resetModules();
    vi.doMock("../scripts/source-health.ts", async () => {
      const actual = await vi.importActual<typeof import("../scripts/source-health.ts")>(
        "../scripts/source-health.ts",
      );
      return {
        ...actual,
        SOURCE_META: [
          ...actual.SOURCE_META,
          { name: "ghost", seedScore: 0, maxAgeHours: 1, minRows: 1 },
        ],
      };
    });
    await expect(import("../scripts/sources.ts")).rejects.toThrow(/No fetcher for source ghost/);
    vi.doUnmock("../scripts/source-health.ts");
  });
});
