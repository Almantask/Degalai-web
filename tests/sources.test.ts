import { describe, expect, it } from "vitest";
import { PROVIDERS, runProviders, skippedSources, type PriceProvider } from "../scripts/sources.ts";
import { SOURCE_META } from "../scripts/source-health.ts";
import type { Observation } from "../src/types.ts";

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
});
