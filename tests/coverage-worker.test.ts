import { afterEach, describe, expect, it, vi } from "vitest";
import { REPORT_ENDPOINT } from "../src/report.ts";
import { serveCoverageBadge } from "../worker/src/coverage.ts";
import worker from "../worker/src/index.ts";

const WORKER = "https://kur-degalai-cron.example.workers.dev";
const RELEASE = "https://github.com/Almantask/Degalai-web/releases/download/coverage-badges";

const env = {
  GITHUB_TOKEN: "token",
  GITHUB_REPO: "Almantask/Degalai-web",
  GITHUB_WORKFLOW: "daily.yml",
  GITHUB_REF: "main",
  REPORT_ORIGINS: "https://almantask.github.io",
};

const badge = {
  schemaVersion: 1,
  label: "unit coverage",
  message: "46.6%",
  color: "red",
  cacheSeconds: 300,
  logo: "ignored",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("coverage badge proxy", () => {
  it("returns the release JSON for the two badge paths", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${RELEASE}/unit.json`);
      expect(init?.redirect).toBe("follow");
      const headers = new Headers(init?.headers);
      expect(headers.get("User-Agent")).toBe("kur-degalai-cron");
      return Response.json(badge);
    });
    const res = await serveCoverageBadge(
      new Request(`${WORKER}/coverage/unit.json?cache=1`),
      fetchImpl,
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res?.json()).toEqual({
      schemaVersion: 1,
      label: "unit coverage",
      message: "46.6%",
      color: "red",
      cacheSeconds: 300,
    });
  });

  it("serves that route from the worker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe(`${RELEASE}/e2e.json`);
        return Response.json({ ...badge, label: "e2e coverage", message: "80%", color: "green" });
      }),
    );
    const res = await worker.fetch(new Request(`${WORKER}/coverage/e2e.json`), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ label: "e2e coverage", message: "80%" });
    expect(new URL(REPORT_ENDPOINT).hostname).toBe("kur-degalai-cron.almantusk.workers.dev");
  });

  it("answers with a grey badge when the release asset is missing or not a badge", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: Array<Response | Error> = [
      new Response("missing", { status: 404 }),
      new Response("not json", { status: 200 }),
      new Response("x".repeat(8193), { status: 200 }),
      Response.json({ schemaVersion: 2, label: "unit coverage", message: "1%", color: "red" }),
      Response.json({
        schemaVersion: 1,
        label: "unit coverage",
        message: "1%",
        color: "Not a colour",
      }),
      new Error("network"),
    ];
    for (const result of cases) {
      const fetchImpl = vi.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
      });
      const res = await serveCoverageBadge(new Request(`${WORKER}/coverage/unit.json`), fetchImpl);
      expect(await res?.json()).toEqual({
        schemaVersion: 1,
        label: "unit coverage",
        message: "unknown",
        color: "lightgrey",
        cacheSeconds: 300,
      });
    }
  });

  it("returns an unknown badge when the asset is not an object", async () => {
    for (const body of ["null", "1", "false"]) {
      const res = await serveCoverageBadge(
        new Request(`${WORKER}/coverage/unit.json`),
        vi.fn(async () => new Response(body, { status: 200 })),
      );
      expect(await res?.json()).toEqual({
        schemaVersion: 1,
        label: "unit coverage",
        message: "unknown",
        color: "lightgrey",
        cacheSeconds: 300,
      });
    }
  });

  it("keeps a short cache hint and refuses other methods and paths", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`${RELEASE}/e2e.json`);
      return Response.json({ ...badge, label: "e2e coverage", cacheSeconds: 60 });
    });
    const res = await serveCoverageBadge(new Request(`${WORKER}/coverage/e2e.json`), fetchImpl);
    expect(await res?.json()).toMatchObject({ cacheSeconds: 60, label: "e2e coverage" });

    const uncached = await serveCoverageBadge(
      new Request(`${WORKER}/coverage/unit.json`),
      vi.fn(async () => Response.json({ ...badge, cacheSeconds: 100_000 })),
    );
    expect(await uncached?.json()).toMatchObject({ cacheSeconds: 300 });

    const posted = await serveCoverageBadge(
      new Request(`${WORKER}/coverage/unit.json`, { method: "POST" }),
      fetchImpl,
    );
    expect(posted?.status).toBe(405);
    expect(fetchImpl).toHaveBeenCalledOnce();

    expect(await serveCoverageBadge(new Request(`${WORKER}/coverage/other.json`), fetchImpl)).toBe(
      null,
    );
    expect(
      await serveCoverageBadge(new Request(`${WORKER}/coverage/../unit.json`), fetchImpl),
    ).toBe(null);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const missing = await worker.fetch(new Request(`${WORKER}/nope`), env);
    expect(missing.status).toBe(404);
  });
});
