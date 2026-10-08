import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import istanbulCoverage, { type CoverageMapData } from "istanbul-lib-coverage";
import { isAppSource } from "./coverage-instrument.ts";

// Named exports are invisible to Node's ESM loader: the package is CommonJS
// and defines these as methods. Playwright loads this file that way; Vitest does not.
const { createCoverageMap } = istanbulCoverage;

export { isAppSource };

export const E2E_RAW_DIR = join("coverage", "e2e", "raw");
export const E2E_SUMMARY = join("coverage", "e2e", "coverage-summary.json");

export interface LineSummary {
  total: {
    lines: { total: number; covered: number; skipped: number; pct: number };
  };
}

/** Line coverage of the `src` entries in an Istanbul coverage map. */
export function summarizeCoverage(data: CoverageMapData): LineSummary {
  const map = createCoverageMap({});
  for (const [file, entry] of Object.entries(data)) {
    if (!isAppSource(file)) continue;
    map.merge({ [file]: entry });
  }
  const lines = map.getCoverageSummary().lines;
  if (lines.total === 0 || typeof lines.pct !== "number" || !Number.isFinite(lines.pct)) {
    throw new Error("e2e coverage did not include any src file");
  }
  return {
    total: {
      lines: {
        total: lines.total,
        covered: lines.covered,
        skipped: lines.skipped,
        pct: lines.pct,
      },
    },
  };
}

/**
 * Merges the per-test coverage files Playwright wrote and stores the summary
 * the badge is built from. Outside CI a build without counters is ignored, so a
 * reused preview server does not fail the run.
 */
export function writeE2eCoverageSummary(): void {
  const map = createCoverageMap({});
  let names: string[] = [];
  try {
    names = readdirSync(E2E_RAW_DIR).filter((name) => name.endsWith(".json"));
  } catch {
    names = [];
  }
  for (const name of names) {
    const data = JSON.parse(readFileSync(join(E2E_RAW_DIR, name), "utf8")) as CoverageMapData;
    for (const [file, entry] of Object.entries(data)) {
      if (isAppSource(file)) map.merge({ [file]: entry });
    }
  }
  try {
    const summary = summarizeCoverage(map.toJSON());
    mkdirSync(join("coverage", "e2e"), { recursive: true });
    writeFileSync(E2E_SUMMARY, `${JSON.stringify(summary)}\n`);
    const lines = summary.total.lines;
    console.log(`e2e coverage: ${lines.pct}% of lines (${lines.covered}/${lines.total})`);
  } catch (error) {
    if (process.env.CI) throw error;
    console.log(error instanceof Error ? error.message : error);
  }
}
