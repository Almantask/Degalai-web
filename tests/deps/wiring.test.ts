import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadEvTariffs } from "../../scripts/adapters/ev-tariffs.ts";
import { loadPriceReports } from "../../scripts/adapters/reports.ts";
import { loadOverrides } from "../../scripts/match.ts";
import { REPORT_ENDPOINT } from "../../src/report.ts";
import {
  read,
  readAll,
  reportOrigins,
  ROOT,
  workerSecrets,
  workerVar,
  workflow,
  wrangler,
} from "./repo.ts";

// Offline: everything the code needs to call its dependencies is configured in this repository.

/** Names the cron worker reads from `env`, collected from its source. */
function workerEnvNames(): string[] {
  const source = [...readAll("worker/src", ".ts").values()].join("\n");
  return [...new Set([...source.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))].sort();
}

describe("cron worker", () => {
  it("has every variable, binding and secret it reads configured", () => {
    const config = wrangler();
    const provided = new Set([
      ...Object.keys(config.vars ?? {}),
      ...(config.ratelimits ?? []).map((r) => r.name),
      ...(config.kv_namespaces ?? []).map((k) => k.binding),
      ...workerSecrets(),
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

  it("serves the feedback endpoint the site posts to", () => {
    const config = wrangler();
    const url = new URL(REPORT_ENDPOINT);
    expect(config.workers_dev, "workers_dev serves the *.workers.dev address").toBe(true);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toMatch(new RegExp(`^${config.name}\\.[\\w-]+\\.workers\\.dev$`));
    expect(url.pathname).toBe("/report");
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
  /** Variables the deployed site does without, and what it does instead. */
  const OPTIONAL_ENV: Record<string, string> = {
    VITE_REPORT_URL: "feedback goes to REPORT_ENDPOINT; this only points a dev build elsewhere",
  };

  it("gets every VITE_ variable the app reads", () => {
    const source = [...readAll("src", ".ts").values()].join("\n");
    const used = [
      ...new Set([...source.matchAll(/import\.meta\.env\.(VITE_\w+)/g)].map((m) => m[1])),
    ];
    expect(used).not.toEqual([]);
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

  it("passes the Cloudflare Web Analytics token into the pages build", () => {
    expect(workflow("daily.yml")).toMatch(
      /^\s+VITE_CF_BEACON_TOKEN:\s+\$\{\{ secrets\.CF_BEACON_TOKEN \}\}$/m,
    );
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

describe("Actions secrets and variables", () => {
  it("are all handed to the dependency tests, which use them", () => {
    const others = [...readAll(".github/workflows", ".yml")]
      .filter(([path]) => !path.endsWith("/dependencies.yml"))
      .map(([, text]) => text)
      .join("\n");
    const used = [...others.matchAll(/\b(secrets|vars)\.([A-Z][A-Z0-9_]*)/g)]
      .map((m) => `${m[1]}.${m[2]}`)
      .filter((name) => name !== "secrets.GITHUB_TOKEN");
    const deps = workflow("dependencies.yml");
    expect(
      [...new Set(used)].filter((name) => !deps.includes(name)),
      "not passed to npm run test:deps in dependencies.yml",
    ).toEqual([]);
  });
});
