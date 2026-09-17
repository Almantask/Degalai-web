import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyHealth,
  loadHealth,
  rankSources,
  recordRuns,
  reliability,
  runScore,
  saveHealth,
  SEED_WEIGHT,
  SOURCE_META,
  type SourceHealthFile,
  type SourceMeta,
  type SourceRun,
} from "../scripts/source-health.ts";

const now = new Date("2026-09-17T12:00:00Z");
const hoursAgo = (h: number): string => new Date(now.getTime() - h * 3_600_000).toISOString();
const run = (h: number, ok: boolean, rows: number): SourceRun => ({
  at: hoursAgo(h),
  ok,
  rows,
  ms: 10,
});
const meta = (name: string): SourceMeta => SOURCE_META.find((m) => m.name === name)!;

/** `count` hourly runs ending now, all with the same outcome. */
const hourly = (count: number, ok: boolean, rows: number): SourceRun[] =>
  Array.from({ length: count }, (_, i) => run(count - 1 - i, ok, rows));

describe("recordRuns", () => {
  it("appends this hour's runs and drops runs older than seven days", () => {
    const health: SourceHealthFile = {
      updatedAt: hoursAgo(1),
      runs: { lea: [run(24 * 8, true, 700), run(1, true, 700)], gone: [run(24 * 9, true, 5)] },
    };
    const next = recordRuns(health, [{ name: "lea", ...run(0, false, 0), error: "HTTP 500" }], now);
    expect(next.updatedAt).toBe(now.toISOString());
    expect(next.runs.lea.map((r) => r.at)).toEqual([hoursAgo(1), hoursAgo(0)]);
    expect(next.runs.gone).toBeUndefined();
  });
});

describe("runScore", () => {
  it("scores usable, thin and failed fetches", () => {
    expect(runScore(run(0, true, 300), 300)).toBe(1);
    expect(runScore(run(0, true, 12), 300)).toBe(0.5);
    expect(runScore(run(0, false, 0), 300)).toBe(0);
  });
});

describe("reliability", () => {
  it("starts at the seed score before any runs are logged", () => {
    expect(reliability([], meta("lea-live"))).toBeCloseTo(0.95);
  });

  it("moves toward the measured success rate as runs accumulate", () => {
    const failing = hourly(SEED_WEIGHT, false, 0);
    expect(reliability(failing, meta("lea-live"))).toBeCloseTo(0.475);
    const perfect = hourly(168, true, 700);
    expect(reliability(perfect, meta("lea"))).toBeGreaterThan(0.98);
  });
});

describe("rankSources", () => {
  it("keeps seed order on a cold start", () => {
    expect(rankSources(emptyHealth()).map((r) => r.name)).toEqual(["lea-live", "lea", "circle-k"]);
  });

  it("keeps seed order when scores are within the margin", () => {
    const health: SourceHealthFile = {
      updatedAt: now.toISOString(),
      // lea-live misses a few hours; lea is perfect but not more than 0.05 ahead.
      runs: {
        "lea-live": [...hourly(160, true, 700), ...hourly(8, false, 0)],
        lea: hourly(168, true, 700),
        "circle-k": hourly(168, true, 4),
      },
    };
    const ranked = rankSources(health);
    expect(ranked[1].score - ranked[0].score).toBeLessThanOrEqual(0.05);
    expect(ranked.map((r) => r.name)).toEqual(["lea-live", "lea", "circle-k"]);
  });

  it("drops a failing lea-live below lea", () => {
    const health: SourceHealthFile = {
      updatedAt: now.toISOString(),
      runs: {
        "lea-live": hourly(48, false, 0),
        lea: hourly(48, true, 700),
        "circle-k": hourly(48, true, 4),
      },
    };
    expect(rankSources(health).map((r) => r.name)).toEqual(["lea", "circle-k", "lea-live"]);
  });

  it("lets Circle K pass both LEA sources when they stop returning enough rows", () => {
    const health: SourceHealthFile = {
      updatedAt: now.toISOString(),
      runs: {
        "lea-live": hourly(72, true, 20),
        lea: hourly(72, false, 0),
        "circle-k": hourly(72, true, 4),
      },
    };
    expect(rankSources(health).map((r) => r.name)).toEqual(["circle-k", "lea-live", "lea"]);
  });
});

describe("loadHealth / saveHealth", () => {
  it("round-trips the file and falls back to empty on a missing or corrupt file", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-health-"));
    try {
      const path = join(dir, "cache", "source-health.json");
      expect(loadHealth(path)).toEqual(emptyHealth());
      const health = recordRuns(emptyHealth(), [{ name: "lea", ...run(0, true, 700) }], now);
      saveHealth(path, health);
      expect(loadHealth(path)).toEqual(health);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
