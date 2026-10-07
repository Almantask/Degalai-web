import { describe, expect, it, vi } from "vitest";
import {
  isEmail,
  REPORT_ENDPOINT,
  REPORT_TIMEOUT_MS,
  sendReport,
  type ReportContext,
  type ReportForm,
} from "../src/report.ts";
import { fitWithin } from "../src/report-image.ts";

const context: ReportContext = {
  page: "https://almantask.github.io/Degalai-web/en/?fuel=ev",
  locale: "en",
  fuel: "EV",
  dataDate: "2026-10-07T08:17:00Z",
  userAgent: "Mozilla/5.0",
  viewport: "1280×800",
};

const ENDPOINT = "https://kur-degalai-cron.example.workers.dev/report";
const bug: ReportForm = {
  category: "bug",
  description: "Map does not load",
  email: "vardas@pastas.lt",
  website: "",
};

describe("sendReport", () => {
  it("posts the category, description, email, honeypot and context as JSON", async () => {
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
      email: "vardas@pastas.lt",
      website: "",
      ...context,
    });
  });

  it("sends an attached picture and passes on whether it was saved", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, number: 8, url: "https://x.test/8", imageSaved: false }),
    );
    const image = "data:image/webp;base64,UklGRg==";
    const result = await sendReport(ENDPOINT, { ...bug, image }, context, fetchImpl);
    expect(result).toMatchObject({ ok: true, number: 8, imageSaved: false });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((JSON.parse(init.body as string) as { image: string }).image).toBe(image);
  });

  it("accepts a reply without an issue link", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ok: true }, { status: 201 }));
    expect(await sendReport(ENDPOINT, bug, context, fetchImpl)).toEqual({
      ok: true,
      number: undefined,
      url: undefined,
    });
  });

  it("gives up after the time limit and says so, rather than calling it a failure", async () => {
    const hanging = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    expect(await sendReport(ENDPOINT, bug, context, hanging, 20)).toEqual({
      ok: false,
      reason: "timeout",
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

describe("isEmail", () => {
  it("takes ordinary addresses", () => {
    expect(isEmail("vardas@pastas.lt")).toBe(true);
    expect(isEmail("first.last+degalai@mail.example.co.uk")).toBe(true);
  });

  it("refuses text that is not an address", () => {
    for (const bad of [
      "",
      "vardas",
      "vardas@",
      "@pastas.lt",
      "vardas@pastas",
      "va rdas@pastas.lt",
    ]) {
      expect(isEmail(bad)).toBe(false);
    }
    expect(isEmail("a@b.c")).toBe(false);
    expect(isEmail("x<y>@pastas.lt")).toBe(false);
    expect(isEmail(`${"a".repeat(250)}@pastas.lt`)).toBe(false);
  });
});

describe("REPORT_ENDPOINT", () => {
  it("is the worker's report route over HTTPS", () => {
    const url = new URL(REPORT_ENDPOINT);
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toBe("/report");
  });

  it("waits a minute, as the form promises", () => {
    expect(REPORT_TIMEOUT_MS).toBe(60_000);
  });
});

describe("fitWithin", () => {
  it("scales the longer side down to the limit and keeps the shape", () => {
    expect(fitWithin(3200, 1800, 1600)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(1080, 2400, 1600)).toEqual({ width: 720, height: 1600 });
  });

  it("never scales a small picture up", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});
