import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEvTariffs } from "../../scripts/adapters/ev-tariffs.ts";
import { loadPriceReports } from "../../scripts/adapters/reports.ts";
import { loadOverrides } from "../../scripts/match.ts";
import { ISSUES_NEW_URL } from "../../src/report.ts";
import { read, readAll, reportOrigins, ROOT, workerVar, workflow, wrangler } from "./repo.ts";

// Offline: everything the code needs to call its dependencies is configured in this repository.

/** Names the cron worker reads from `env`, collected from its source. */
function workerEnvNames(): string[] {
  const source = [...readAll("worker/src", ".ts").values()].join("\n");
  return [...new Set([...source.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))].sort();
}

/** Worker secrets the deploy workflow sets: `wrangler secret put` scripts that worker.yml runs. */
function deployedWorkerSecrets(): string[] {
  const { scripts } = JSON.parse(read("worker/package.json")) as {
    scripts: Record<string, string>;
  };
  const deploy = workflow("worker.yml");
  return Object.entries(scripts).flatMap(([name, command]) => {
    const secret = command.match(/wrangler secret put ([A-Z][A-Z0-9_]*)/)?.[1];
    const runs = new RegExp(`npm run (?:--silent )?${escapeRegExp(name)}(?![\\w:-])`).test(deploy);
    return secret && runs ? [secret] : [];
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("cron worker", () => {
  it("has every variable, binding and secret it reads configured", () => {
    const config = wrangler();
    const provided = new Set([
      ...Object.keys(config.vars ?? {}),
      ...(config.ratelimits ?? []).map((r) => r.name),
      ...(config.kv_namespaces ?? []).map((k) => k.binding),
      ...deployedWorkerSecrets(),
    ]);
    const used = workerEnvNames();
    expect(used).toContain("GITHUB_TOKEN");
    expect(
      used.filter((name) => !provided.has(name)),
      "read from env but not set by worker/wrangler.jsonc or a secret in worker.yml",
    ).toEqual([]);
  });

  it("runs on a cron", () => {
    expect(wrangler().triggers?.crons ?? []).not.toEqual([]);
  });

  it("dispatches a workflow that accepts workflow_dispatch and deploys from that ref", () => {
    const name = workerVar("GITHUB_WORKFLOW");
    expect(existsSync(join(ROOT, ".github/workflows", name)), `.github/workflows/${name}`).toBe(
      true,
    );
    const text = workflow(name);
    expect(text).toMatch(/^\s+workflow_dispatch:/m);
    expect(text, "the deploy job is skipped on any other ref").toContain(
      `refs/heads/${workerVar("GITHUB_REF")}`,
    );
  });

  it("files feedback on the repository the site falls back to", () => {
    expect(ISSUES_NEW_URL).toBe(`https://github.com/${workerVar("GITHUB_REPO")}/issues/new`);
  });

  it("takes reports from the GitHub Pages origin", () => {
    const owner = workerVar("GITHUB_REPO").split("/")[0].toLowerCase();
    const origins = reportOrigins();
    expect(origins).toContain(`https://${owner}.github.io`);
    // Browsers send Origin without a path or trailing slash; anything else never matches.
    for (const origin of origins) expect(origin).toMatch(/^https:\/\/[^/]+$/);
  });
});

describe("site build", () => {
  /** Variables the app works without, and what it does instead. */
  const OPTIONAL_ENV: Record<string, string> = {
    VITE_ORS_KEY: "routes come from the public OSRM server",
  };

  it("gets every VITE_ variable the app reads", () => {
    const source = [...readAll("src", ".ts").values()].join("\n");
    const used = [
      ...new Set([...source.matchAll(/import\.meta\.env\.(VITE_\w+)/g)].map((m) => m[1])),
    ];
    expect(used).toContain("VITE_REPORT_URL");
    const declared = read("src/vite-env.d.ts");
    for (const name of used) expect(declared).toMatch(new RegExp(`readonly ${name}\\??:`));
    // The hourly workflow is the build that gets deployed.
    const build = workflow("daily.yml");
    const passed = new Set([...build.matchAll(/^\s+(VITE_\w+):/gm)].map((m) => m[1]));
    expect(
      used.filter((name) => !passed.has(name) && !(name in OPTIONAL_ENV)),
      "not passed to vite build in daily.yml",
    ).toEqual([]);
  });

  it("links only to issue templates that exist", () => {
    const source = [...readAll("src", ".ts").values()].join("\n");
    for (const [, file] of source.matchAll(/issues\/new\?template=([\w.-]+)/g)) {
      expect(existsSync(join(ROOT, ".github/ISSUE_TEMPLATE", file)), file).toBe(true);
    }
  });
});

describe("data pipeline", () => {
  it("has the committed overrides the hourly run checks out, with no entry dropped", () => {
    expect(workflow("daily.yml")).toContain("git checkout HEAD -- data/overrides");
    const loaders: Record<string, (path: string) => unknown[]> = {
      "stations.json": loadOverrides,
      "prices.json": loadPriceReports,
      "ev-tariffs.json": loadEvTariffs,
    };
    for (const [file, load] of Object.entries(loaders)) {
      const path = join(ROOT, "data/overrides", file);
      expect(existsSync(path), `data/overrides/${file}`).toBe(true);
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      expect(Array.isArray(raw), `data/overrides/${file} is an array`).toBe(true);
      expect(load(path), `invalid entries in data/overrides/${file}`).toHaveLength(
        (raw as unknown[]).length,
      );
    }
  });
});
