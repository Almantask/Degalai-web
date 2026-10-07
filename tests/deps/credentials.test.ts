import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi, type TestContext } from "vitest";
import { fetchRoute } from "../../src/routing.ts";
import { dispatchWorkflow } from "../../worker/src/dispatch.ts";
import { createIssue } from "../../worker/src/report.ts";
import { ROOT, workerSecrets, workerVar, wrangler } from "./repo.ts";

// Live: the repository's Actions secrets and variables work, used by the code that uses them.
// The Dependencies workflow passes them in, and there a missing one fails; locally its test skips.

/** A secret or variable from the environment. */
function setting(ctx: TestContext, name: string, { optional = false } = {}): string {
  const value = process.env[name];
  if (value) return value;
  if (process.env.CI && !optional) {
    throw new Error(`${name} is empty: set it in Settings → Secrets and variables → Actions`);
  }
  return ctx.skip(`${name} is not set`);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("WORKFLOW_DISPATCH_TOKEN (the cron worker's GITHUB_TOKEN)", () => {
  // Each request is one GitHub refuses only after accepting the token, so nothing starts and
  // nothing is filed. A bad or expired token gets 401; one without the permission, 403 or 404.
  const env = (ctx: TestContext) => ({
    GITHUB_TOKEN: setting(ctx, "WORKFLOW_DISPATCH_TOKEN"),
    GITHUB_REPO: workerVar("GITHUB_REPO"),
    GITHUB_WORKFLOW: workerVar("GITHUB_WORKFLOW"),
    GITHUB_REF: workerVar("GITHUB_REF"),
  });

  it("may start the hourly workflow (Actions: write)", async (ctx) => {
    const run = dispatchWorkflow({ ...env(ctx), GITHUB_REF: "dependency-test-no-such-ref" });
    await expect(run).rejects.toThrow(/^workflow_dispatch failed: 422 [\s\S]*No ref found/);
  });

  it("may file issues (Issues: write)", async (ctx) => {
    const res = await createIssue(env(ctx), { title: "", body: "", labels: [] });
    const text = await res.text();
    expect(res.status, text).toBe(422);
    expect(text).toMatch(/title/);
  });
});

describe("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (deploying the cron worker)", () => {
  /** Runs the worker's wrangler, as worker.yml does, and parses the JSON list it prints. */
  function wranglerList<T>(ctx: TestContext, args: string[]): T[] {
    const env = {
      ...process.env,
      CLOUDFLARE_API_TOKEN: setting(ctx, "CLOUDFLARE_API_TOKEN"),
      CLOUDFLARE_ACCOUNT_ID: setting(ctx, "CLOUDFLARE_ACCOUNT_ID"),
      NO_COLOR: "1",
    };
    let out: string;
    try {
      out = execFileSync(join(ROOT, "worker/node_modules/.bin/wrangler"), args, {
        cwd: join(ROOT, "worker"),
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr;
      throw new Error(`wrangler ${args.join(" ")} failed:\n${stderr || String(e)}`);
    }
    const start = out.indexOf("[");
    if (start < 0) throw new Error(`wrangler ${args.join(" ")} printed no list:\n${out}`);
    return JSON.parse(out.slice(start, out.lastIndexOf("]") + 1)) as T[];
  }

  it("reach the worker's KV namespaces", (ctx) => {
    const namespaces = wranglerList<{ id: string }>(ctx, ["kv", "namespace", "list"]);
    const bound = (wrangler().kv_namespaces ?? []).map((k) => k.id);
    expect(namespaces.map((n) => n.id)).toEqual(expect.arrayContaining(bound));
  });

  it("see the deployed worker with its secrets", (ctx) => {
    const secrets = wranglerList<{ name: string }>(ctx, ["secret", "list", "--format", "json"]);
    expect(secrets.map((s) => s.name)).toEqual(expect.arrayContaining(workerSecrets()));
  });
});

describe("ORS_KEY (VITE_ORS_KEY, OpenRouteService)", () => {
  it("routes with the key", async (ctx) => {
    vi.stubEnv("VITE_ORS_KEY", setting(ctx, "VITE_ORS_KEY", { optional: true }));
    const vilnius = { lat: 54.6872, lon: 25.2797 };
    const kaunas = { lat: 54.8985, lon: 23.9036 };
    // OSRM, the fallback, would answer "fastest".
    expect((await fetchRoute(vilnius, kaunas, "shortest"))?.profile).toBe("shortest");
  });
});
