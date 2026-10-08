import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test as base, expect } from "@playwright/test";
import { E2E_RAW_DIR } from "../scripts/e2e-coverage.ts";

/**
 * Keeps Istanbul coverage across full page loads. `pagehide` stashes the
 * current document; the next document starts again. Counts are summed, and a
 * line is covered when its count is above zero, so saving twice does not
 * change the percentage.
 */
const STASH_COVERAGE = `(() => {
  const KEY = "__e2e_cov";
  const merge = (into, from) => {
    if (!from) return into || {};
    const out = into || {};
    for (const file of Object.keys(from)) {
      const next = from[file];
      const prev = out[file];
      if (!prev) {
        out[file] = next;
        continue;
      }
      for (const bucket of ["s", "f"]) {
        const counts = next[bucket] || {};
        prev[bucket] = prev[bucket] || {};
        for (const id of Object.keys(counts)) {
          prev[bucket][id] = (prev[bucket][id] || 0) + counts[id];
        }
      }
      const branches = next.b || {};
      prev.b = prev.b || {};
      for (const id of Object.keys(branches)) {
        const src = branches[id];
        const dst = prev.b[id] || src.map(() => 0);
        prev.b[id] = dst.map((n, i) => n + (src[i] || 0));
      }
    }
    return out;
  };
  const read = () => {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const write = (value) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Over the quota: this document is still read at the end of the test.
    }
  };
  addEventListener("pagehide", () => {
    if (globalThis.__coverage__) write(merge(read(), globalThis.__coverage__));
  });
  globalThis.__e2eReadCoverage = () => merge(read(), globalThis.__coverage__);
})();`;

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await page.addInitScript({ content: STASH_COVERAGE });
    await use(page);
    try {
      const coverage = await page.evaluate(() => {
        const read = (globalThis as { __e2eReadCoverage?: () => Record<string, unknown> | null })
          .__e2eReadCoverage;
        return read ? read() : null;
      });
      if (!coverage || Object.keys(coverage).length === 0) return;
      mkdirSync(E2E_RAW_DIR, { recursive: true });
      const name = testInfo.testId.replace(/[^\w.-]+/g, "_");
      writeFileSync(join(E2E_RAW_DIR, `${name}.json`), JSON.stringify(coverage));
    } catch (error) {
      console.log(
        `e2e coverage was not collected: ${error instanceof Error ? error.message : error}`,
      );
    }
  },
});

export { expect };
export type { Page } from "@playwright/test";
