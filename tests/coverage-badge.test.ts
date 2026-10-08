import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFileCoverage } from "istanbul-lib-coverage";
import { describe, expect, it } from "vitest";
import { coverageBadge, linePercent } from "../scripts/coverage-badge.ts";
import { instrumentPath, instrumentSource } from "../scripts/coverage-instrument.ts";
import { isAppSource, summarizeCoverage } from "../scripts/e2e-coverage.ts";

describe("coverage badge", () => {
  it("rounds to the percentage it shows and colours that", () => {
    expect(coverageBadge(90, "unit coverage")).toMatchObject({
      schemaVersion: 1,
      label: "unit coverage",
      message: "90%",
      color: "brightgreen",
      cacheSeconds: 300,
    });
    expect(coverageBadge(79.96, "e2e coverage")).toMatchObject({ message: "80%", color: "green" });
    expect(coverageBadge(70, "unit coverage").color).toBe("yellow");
    expect(coverageBadge(69.94, "unit coverage")).toMatchObject({
      message: "69.9%",
      color: "orange",
    });
    expect(coverageBadge(49.94, "unit coverage")).toMatchObject({ message: "49.9%", color: "red" });
  });

  it("reads the line percentage from a coverage summary", () => {
    expect(linePercent({ total: { lines: { pct: 12.5 } } })).toBe(12.5);
    expect(() => linePercent({ total: { lines: { pct: "Unknown" } } })).toThrow(/line percentage/);
    expect(() => linePercent(null)).toThrow(/not an object/);
  });
});

describe("e2e coverage", () => {
  it("instruments src TypeScript only", () => {
    const app = resolve("src/app.ts");
    expect(instrumentPath(app)).toBe(app);
    expect(instrumentPath(`${app}?used`)).toBe(app);
    expect(instrumentPath(resolve("src/vite-env.d.ts"))).toBeUndefined();
    expect(instrumentPath(resolve("node_modules/pkg/src/x.ts"))).toBeUndefined();
    expect(instrumentPath(resolve("scripts/pipeline.ts"))).toBeUndefined();
  });

  it("counts a covered line in src and ignores the pipeline", () => {
    const srcFile = resolve("src/a.ts");
    const pipelineFile = resolve("scripts/pipeline.ts");
    const summary = summarizeCoverage({
      [srcFile]: fileCoverage(srcFile, [1, 0]),
      [pipelineFile]: fileCoverage(pipelineFile, [1]),
    });
    expect(summary.total.lines).toMatchObject({ total: 2, covered: 1, pct: 50 });
    expect(isAppSource(resolve("worker/src/report.ts"))).toBe(false);
  });

  it("records hits on globalThis", () => {
    const code = instrumentSource(
      "function add(a, b) { return a + b; }\nadd(1, 2);\n",
      "/workspace/src/add.ts",
    );
    const coverage = new Function("globalThis", `${code}\nreturn globalThis.__coverage__;`)(
      globalThis,
    ) as Record<string, { s: Record<string, number> }>;
    expect(Object.values(coverage["/workspace/src/add.ts"].s).some((hit) => hit > 0)).toBe(true);
  });
});

describe("coverage publish", () => {
  it("replaces a release asset and does not commit", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    const script = readFileSync("scripts/publish-coverage-release.sh", "utf8");
    expect(ci).toContain("publish-coverage-release.sh");
    expect(ci).not.toMatch(/^\s*(-\s*)?(run:\s*)?git (commit|push)/m);
    expect(script).toContain("coverage-badges");
    expect(script).toContain("gh release upload");
    expect(script).toContain("--clobber");
    expect(script).not.toMatch(/^\s*git (commit|push)/m);
  });
});

/** Two statements on their own lines; `hits[i]` is how many times line i + 1 ran. */
function fileCoverage(path: string, hits: number[]) {
  const statementMap: Record<
    string,
    { start: { line: number; column: number }; end: { line: number; column: number } }
  > = {};
  const s: Record<string, number> = {};
  hits.forEach((hit, index) => {
    const id = String(index);
    statementMap[id] = {
      start: { line: index + 1, column: 0 },
      end: { line: index + 1, column: 1 },
    };
    s[id] = hit;
  });
  return createFileCoverage({
    path,
    statementMap,
    fnMap: {},
    branchMap: {},
    s,
    f: {},
    b: {},
  });
}
