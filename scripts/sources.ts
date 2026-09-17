import type { Observation } from "../src/types.ts";
import { fetchCircleK } from "./adapters/circle-k.ts";
import { fetchLeaWorkbook } from "./adapters/lea.ts";
import { fetchLeaLive } from "./adapters/lea-live.ts";
import { EXCEL_SOURCE, excelFloorDate } from "./merge-sources.ts";
import { SOURCE_META, type SourceMeta, type SourceRun } from "./source-health.ts";

export interface SourceContext {
  /** Snapshot date the run is building (Vilnius today unless `--date`). */
  requested: string;
  /** Every day in the LEA workbook, kept for `--backfill`. */
  leaByDate: Map<string, Observation[]>;
  /** Date of the Excel floor rows returned by the `lea` provider. */
  leaDate: string | null;
}

export interface PriceProvider extends SourceMeta {
  fetch(ctx: SourceContext): Promise<Observation[]>;
}

const FETCHERS: Record<string, PriceProvider["fetch"]> = {
  "lea-live": () => fetchLeaLive(),
  [EXCEL_SOURCE]: async (ctx) => {
    ctx.leaByDate = await fetchLeaWorkbook();
    ctx.leaDate = excelFloorDate(ctx.leaByDate, ctx.requested);
    return ctx.leaDate ? (ctx.leaByDate.get(ctx.leaDate) ?? []) : [];
  },
  "circle-k": () => fetchCircleK(),
};

export const PROVIDERS: PriceProvider[] = SOURCE_META.map((meta) => {
  const fetch = FETCHERS[meta.name];
  if (!fetch) throw new Error(`No fetcher for source ${meta.name}`);
  return { ...meta, fetch };
});

export const PROVIDER_TIMEOUT_MS = 180_000;

export interface ProviderResults {
  byProvider: Record<string, Observation[]>;
  runs: Array<SourceRun & { name: string }>;
}

/** Comma-separated source names that should fail this run, e.g. to rehearse a fallback. */
export function skippedSources(value = process.env.PIPELINE_SKIP_SOURCES): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Fetches every source in parallel. A failure is logged as a run, never thrown. */
export async function runProviders(
  ctx: SourceContext,
  providers: PriceProvider[] = PROVIDERS,
  opts: { skip?: Set<string>; timeoutMs?: number; now?: () => Date } = {},
): Promise<ProviderResults> {
  const skip = opts.skip ?? skippedSources();
  const timeoutMs = opts.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const now = opts.now ?? (() => new Date());
  const at = now().toISOString();

  const results = await Promise.all(
    providers.map(async (p) => {
      const start = performance.now();
      try {
        if (skip.has(p.name)) throw new Error("skipped by PIPELINE_SKIP_SOURCES");
        const rows = await withTimeout(p.fetch(ctx), timeoutMs, p.name);
        const run: SourceRun = {
          at,
          ok: true,
          rows: rows.length,
          ms: Math.round(performance.now() - start),
        };
        const newest = newestObservedAt(rows);
        if (newest) run.newestObservedAt = newest;
        return { name: p.name, rows, run };
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        const run: SourceRun = {
          at,
          ok: false,
          rows: 0,
          ms: Math.round(performance.now() - start),
          error,
        };
        return { name: p.name, rows: [] as Observation[], run };
      }
    }),
  );

  const byProvider: Record<string, Observation[]> = {};
  const runs: ProviderResults["runs"] = [];
  for (const { name, rows, run } of results) {
    byProvider[name] = rows;
    runs.push({ name, ...run });
  }
  return { byProvider, runs };
}

function newestObservedAt(rows: Observation[]): string | undefined {
  let best: string | undefined;
  let bestMs = -Infinity;
  for (const o of rows) {
    const ms = Date.parse(o.observedAt);
    if (ms > bestMs) {
      bestMs = ms;
      best = o.observedAt;
    }
  }
  return best;
}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timed out after ${ms} ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
