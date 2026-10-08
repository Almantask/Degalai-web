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
    const e2e = job(ci, "e2e");
    expect(e2e, "browser tests run on pull requests and pushes, not only when called").not.toMatch(
      /^\s+if:/m,
    );
    expect(e2e).toContain("npm run test:e2e");
    const publish = job(ci, "publish-e2e-coverage");
    expect(publish).toContain("github.event_name != 'pull_request'");
    expect(publish).toContain("needs.e2e.result == 'success'");
    expect(script).toContain("coverage-badges");
    expect(script).toContain("gh release upload");
    expect(script).toContain("--clobber");
    expect(script).not.toMatch(/^\s*git (commit|push)/m);
  });

  it("points the README badges at the worker, which Shields can fetch", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).not.toContain("endpoint?url=https%3A%2F%2Fgithub.com");
    expect(readme).toContain(
      "https%3A%2F%2Fkur-degalai-cron.almantusk.workers.dev%2Fcoverage%2Funit.json",
    );
    expect(readme).toContain(
      "https%3A%2F%2Fkur-degalai-cron.almantusk.workers.dev%2Fcoverage%2Fe2e.json",
    );
  });
});

/** The YAML of one job, from its key through the line before the next job. */
function job(yaml: string, name: string): string {
  const start = yaml.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`missing job ${name}`);
  const rest = yaml.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

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
