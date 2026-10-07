import { describe, expect, it, vi } from "vitest";
import {
  githubIssueLink,
  ISSUES_NEW_URL,
  sendReport,
  type ReportContext,
  type ReportForm,
} from "../src/report.ts";

const context: ReportContext = {
  page: "https://almantask.github.io/Degalai-web/en/?fuel=ev",
  locale: "en",
  fuel: "EV",
  dataDate: "2026-10-07T08:17:00Z",
  userAgent: "Mozilla/5.0",
  viewport: "1280×800",
};

const ENDPOINT = "https://kur-degalai-cron.example.workers.dev/report";
const bug: ReportForm = { category: "bug", description: "Map does not load", website: "" };

describe("sendReport", () => {
  it("posts the category, description, honeypot and context as JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { ok: true, number: 7, url: "https://github.com/Almantask/Degalai-web/issues/7" },
        { status: 201 },
      ),
    );
    const result = await sendReport(ENDPOINT, bug, context, fetchImpl);
    expect(result).toEqual({
      ok: true,
      number: 7,
      url: "https://github.com/Almantask/Degalai-web/issues/7",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      category: "bug",
      description: "Map does not load",
      website: "",
      ...context,
    });
  });

  it("accepts a reply without an issue link", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }, { status: 201 }));
    expect(await sendReport(ENDPOINT, bug, context, fetchImpl)).toEqual({
      ok: true,
      number: undefined,
      url: undefined,
    });
  });

  it("tells a rate limit apart from other failures", async () => {
    const limited = vi.fn(async () => new Response(null, { status: 429 }));
    expect(await sendReport(ENDPOINT, bug, context, limited)).toEqual({
      ok: false,
      reason: "rate",
    });
    const broken = vi.fn(async () => new Response(null, { status: 502 }));
    expect(await sendReport(ENDPOINT, bug, context, broken)).toEqual({
      ok: false,
      reason: "failed",
    });
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await sendReport(ENDPOINT, bug, context, offline)).toEqual({
      ok: false,
      reason: "failed",
    });
  });
});

describe("githubIssueLink", () => {
  it("prefills a new issue with the text and context", () => {
    const link = new URL(
      githubIssueLink({ category: "bug", description: "  Wrong price\nat Viada  " }, context),
    );
    expect(`${link.origin}${link.pathname}`).toBe(ISSUES_NEW_URL);
    expect(link.searchParams.get("title")).toBe("[bug] Wrong price");
    expect(link.searchParams.get("labels")).toBe("bug");
    const body = link.searchParams.get("body")!;
    expect(body.startsWith("Wrong price\nat Viada\n")).toBe(true);
    expect(body).toContain(`Page: ${context.page}`);
    expect(body).toContain("Screen: 1280×800");
  });

  it("labels a feature idea as an enhancement", () => {
    const link = new URL(
      githubIssueLink({ category: "feature", description: "Show a price alert" }, context),
    );
    expect(link.searchParams.get("title")).toBe("[feature] Show a price alert");
    expect(link.searchParams.get("labels")).toBe("enhancement");
  });
});
