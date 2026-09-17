import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { HISTORY_KEEP_DAYS } from "../src/types.ts";

export interface SourceMeta {
  name: string;
  /** Prior reliability before any runs are logged; also the order when scores are close. */
  seedScore: number;
  /** A price from this source counts as current for this long after `observedAt`. */
  maxAgeHours: number;
  /** Fewer rows than this means the fetch worked but the source is thin or broken. */
  minRows: number;
}

/** Ranked price sources in seed order. User reports are a manual overlay, not ranked. */
export const SOURCE_META: SourceMeta[] = [
  { name: "lea-live", seedScore: 0.95, maxAgeHours: 36, minRows: 300 },
  { name: "lea", seedScore: 0.9, maxAgeHours: 36, minRows: 300 },
  { name: "circle-k", seedScore: 0.7, maxAgeHours: 36, minRows: 3 },
];

export const DEFAULT_MAX_AGE_HOURS = 36;
/** Pseudo-runs of the seed score, so a cold start or one bad hour does not reorder sources. */
export const SEED_WEIGHT = 24;
/** A lower-seeded source only moves ahead when it is this much more reliable. */
export const RANK_MARGIN = 0.05;

export interface SourceRun {
  at: string;
  ok: boolean;
  rows: number;
  newestObservedAt?: string;
  ms: number;
  error?: string;
}

export interface SourceHealthFile {
  updatedAt: string;
  runs: Record<string, SourceRun[]>;
}

export interface RankedSource {
  name: string;
  score: number;
  seedScore: number;
  runs: number;
}

export function emptyHealth(): SourceHealthFile {
  return { updatedAt: new Date(0).toISOString(), runs: {} };
}

export function loadHealth(path: string): SourceHealthFile {
  if (!existsSync(path)) return emptyHealth();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<SourceHealthFile>;
    if (!raw || typeof raw.runs !== "object" || raw.runs === null) return emptyHealth();
    return { updatedAt: raw.updatedAt ?? emptyHealth().updatedAt, runs: raw.runs };
  } catch {
    return emptyHealth();
  }
}

export function saveHealth(path: string, health: SourceHealthFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(health, null, 2)}\n`);
}

/** Appends this hour's runs and drops runs older than the history window. */
export function recordRuns(
  health: SourceHealthFile,
  runs: Array<SourceRun & { name: string }>,
  now = new Date(),
  keepDays = HISTORY_KEEP_DAYS,
): SourceHealthFile {
  const cutoff = now.getTime() - keepDays * 86_400_000;
  const next: Record<string, SourceRun[]> = {};
  for (const [name, list] of Object.entries(health.runs)) {
    next[name] = list.filter((r) => Date.parse(r.at) >= cutoff);
  }
  for (const { name, ...run } of runs) (next[name] ??= []).push(run);
  for (const name of Object.keys(next)) if (next[name].length === 0) delete next[name];
  return { updatedAt: now.toISOString(), runs: next };
}

/** 1 = usable data, 0.5 = fetched but too few rows, 0 = failed. */
export function runScore(run: SourceRun, minRows: number): number {
  if (!run.ok) return 0;
  return run.rows >= minRows ? 1 : 0.5;
}

export function reliability(runs: SourceRun[], meta: SourceMeta): number {
  const sum = runs.reduce((acc, r) => acc + runScore(r, meta.minRows), 0);
  return (sum + meta.seedScore * SEED_WEIGHT) / (runs.length + SEED_WEIGHT);
}

/**
 * Most reliable first. Starts from seed order and only lets a source overtake the one ahead
 * of it when its score is higher by more than `RANK_MARGIN`, so near-equal scores keep the
 * seed order instead of swapping hour to hour.
 */
export function rankSources(
  health: SourceHealthFile,
  metas: SourceMeta[] = SOURCE_META,
): RankedSource[] {
  const ranked = [...metas]
    .sort((a, b) => b.seedScore - a.seedScore)
    .map((m) => {
      const runs = health.runs[m.name] ?? [];
      return {
        name: m.name,
        score: reliability(runs, m),
        seedScore: m.seedScore,
        runs: runs.length,
      };
    });
  let swapped = true;
  while (swapped) {
    swapped = false;
    for (let i = 0; i + 1 < ranked.length; i++) {
      if (ranked[i + 1].score > ranked[i].score + RANK_MARGIN) {
        [ranked[i], ranked[i + 1]] = [ranked[i + 1], ranked[i]];
        swapped = true;
      }
    }
  }
  return ranked;
}
