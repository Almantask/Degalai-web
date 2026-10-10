import { describe, expect, it, vi } from "vitest";
import {
  CONTACT_TTL_SECONDS,
  codeBlock,
  handleReport,
  isHoneypotFilled,
  issueFromReport,
  issueTitle,
  parseReport,
  storeContact,
  type ContactStore,
  type RateLimiter,
  type ReportEnv,
} from "../worker/src/report.ts";

const ORIGIN = "https://almantask.github.io";

const env = (extra: Partial<ReportEnv> = {}): ReportEnv => ({
  GITHUB_TOKEN: "test-token",
  GITHUB_REPO: "Almantask/Degalai-web",
  REPORT_ORIGINS: `${ORIGIN}, http://127.0.0.1:4173`,
  ...extra,
});

const form = {
  category: "bug",
  email: "vardas@pastas.lt",
  description: "Neste on Ukmergės g. shows 1.45 but the pump says 1.52",
  website: "",
  page: "https://almantask.github.io/Degalai-web/?fuel=diesel",
  locale: "lt",
  fuel: "D",
  dataDate: "2026-10-07T08:17:00Z",
  userAgent: "Mozilla/5.0",
  viewport: "390×844",
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://kur-degalai-cron.example.workers.dev/report", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function github(status = 201) {
  return vi.fn(async () =>
    status < 300
      ? Response.json(
          { number: 42, html_url: "https://github.com/Almantask/Degalai-web/issues/42" },
          { status },
        )
      : new Response("Bad credentials", { status }),
  );
}

const limiter = (success: boolean): RateLimiter => ({ limit: async () => ({ success }) });

describe("parseReport", () => {
  it("keeps the category, description and the known context fields only", () => {
    const report = parseReport({ ...form, extra: "dropped" });
    expect(report).toEqual({
      category: "bug",
      description: form.description,
      email: "vardas@pastas.lt",
      page: form.page,
      locale: "lt",
      fuel: "D",
      dataDate: form.dataDate,
      userAgent: "Mozilla/5.0",
      viewport: "390×844",
    });
  });

  it("takes bugs and feature ideas, and a missing category as a bug", () => {
    expect(parseReport({ ...form, category: "feature" })?.category).toBe("feature");
    const { category: _category, ...older } = form;
    expect(parseReport(older)?.category).toBe("bug");
    expect(parseReport({ ...form, category: "question" })).toBeNull();
    expect(parseReport({ ...form, category: 1 })).toBeNull();
  });

  it("rejects a missing, too short or too long description", () => {
    expect(parseReport({ email: form.email, page: "x" })).toBeNull();
    expect(parseReport({ ...form, description: "   broken  " })).toBeNull();
    expect(parseReport({ ...form, description: "x".repeat(2001) })).toBeNull();
    expect(parseReport(null)).toBeNull();
    expect(parseReport("text")).toBeNull();
  });

  it("requires a real email address and trims it", () => {
    const { email: _email, ...noEmail } = form;
    expect(parseReport(noEmail)).toBeNull();
    for (const bad of ["", "vardas", "vardas@pastas", "@pastas.lt", "va rdas@pastas.lt", 42]) {
      expect(parseReport({ ...form, email: bad })).toBeNull();
    }
    expect(parseReport({ ...form, email: `${"a".repeat(250)}@pastas.lt` })).toBeNull();
    expect(parseReport({ ...form, email: "  Vardas@Pastas.lt " })?.email).toBe("Vardas@Pastas.lt");
  });

  it("strips control characters and squeezes context onto one short line", () => {
    const report = parseReport({
      email: form.email,
      description: "Line one\r\nline two\u0007 here",
      userAgent: `Agent\n${"a".repeat(400)}`,
      fuel: 95,
    });
    expect(report?.description).toBe("Line one\nline two here");
    expect(report?.userAgent).toHaveLength(300);
    expect(report?.userAgent.startsWith("Agent a")).toBe(true);
    expect(report?.fuel).toBe("");
  });
});

describe("issueFromReport", () => {
  it("puts the visitor's text inside code blocks and labels the issue", () => {
    const issue = issueFromReport(parseReport(form)!);
    expect(issue.labels).toEqual(["bug", "user-report"]);
    expect(issue.title).toBe(`[bug] ${form.description}`);
    expect(issue.body).toContain(`\`\`\`text\n${form.description}\n\`\`\``);
    expect(issue.body).toContain("Page:     https://almantask.github.io/Degalai-web/?fuel=diesel");
    expect(issue.body).toContain("Screen:   390×844");
  });

  it("never puts the email address in the issue, only where to find it", () => {
    const report = parseReport(form)!;
    const stored = issueFromReport(report, { contactKey: "key-123" });
    expect(stored.body).not.toContain(form.email);
    expect(stored.body).toContain("### Contact");
    expect(stored.body).toContain("`kur-degalai-report-contacts`, key `key-123`");
    const lost = issueFromReport(report, { contactKey: null });
    expect(lost.body).not.toContain(form.email);
    expect(lost.body).toContain("_The sender left an email address, but it could not be stored._");
    expect(issueFromReport(report).body).not.toContain("### Contact");
  });

  it("files a feature idea as an enhancement", () => {
    const issue = issueFromReport(parseReport({ ...form, category: "feature" })!);
    expect(issue.labels).toEqual(["enhancement", "user-report"]);
    expect(issue.title).toBe(`[feature] ${form.description}`);
    expect(issue.body.startsWith("### Idea\n")).toBe(true);
  });

  it("cannot be broken out of with backticks", () => {
    expect(codeBlock("a ``` b")).toBe("````text\na ``` b\n````");
    expect(codeBlock("plain")).toBe("```text\nplain\n```");
  });

  it("titles with the first line, shortened, mentions and references broken", () => {
    expect(issueTitle("Ping @someone about owner/repo#1\nmore")).toBe(
      "Ping @\u200bsomeone about owner/repo#\u200b1",
    );
    const long = issueTitle("word ".repeat(40));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("storeContact", () => {
  it("keeps the address for a year under a random key", async () => {
    const puts: [string, string, number | undefined][] = [];
    const store: ContactStore = {
      put: async (key, value, options) => {
        puts.push([key, value, options?.expirationTtl]);
      },
    };
    const key = await storeContact(store, "vardas@pastas.lt");
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(puts).toEqual([[key, "vardas@pastas.lt", CONTACT_TTL_SECONDS]]);
  });

  it("gives no key when KV fails or is not bound", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing: ContactStore = {
      put: async () => {
        throw new Error("KV write limit");
      },
    };
    expect(await storeContact(failing, "vardas@pastas.lt")).toBeNull();
    expect(await storeContact(undefined, "vardas@pastas.lt")).toBeNull();
    error.mockRestore();
  });
});

describe("isHoneypotFilled", () => {
  it("ignores a value that is not an object", () => {
    expect(isHoneypotFilled(null)).toBe(false);
    expect(isHoneypotFilled(undefined)).toBe(false);
    expect(isHoneypotFilled(42)).toBe(false);
    expect(isHoneypotFilled("https://spam.example")).toBe(false);
    expect(isHoneypotFilled({ website: 42 })).toBe(false);
    expect(isHoneypotFilled({ website: "  " })).toBe(false);
  });
});

describe("handleReport", () => {
  it("files an issue and returns its number and link", async () => {
    const fetchImpl = github();
    const res = await handleReport(post(form), env(), fetchImpl);
    expect(res.status).toBe(201);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(await res.json()).toEqual({
      ok: true,
      number: 42,
      url: "https://github.com/Almantask/Degalai-web/issues/42",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/Almantask/Degalai-web/issues");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    const sent = JSON.parse(init.body as string) as { title: string; labels: string[] };
    expect(sent.title.startsWith("[bug] Neste")).toBe(true);
    expect(sent.labels).toEqual(["bug", "user-report"]);
  });

  it("stores the email privately and sends GitHub only its key", async () => {
    const stored = new Map<string, string>();
    const contacts: ContactStore = {
      put: async (key, value) => {
        stored.set(key, value);
      },
    };
    const fetchImpl = github();
    await handleReport(post(form), env({ REPORT_CONTACTS: contacts }), fetchImpl);
    const [[key, email]] = [...stored];
    expect(email).toBe("vardas@pastas.lt");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body as string).not.toContain("vardas@pastas.lt");
    expect(init.body as string).toContain(`key \`${key}\``);
  });

  it("refuses a report without a valid email before calling GitHub", async () => {
    const fetchImpl = github();
    const res = await handleReport(post({ ...form, email: "not-an-email" }), env(), fetchImpl);
    expect(res.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers the CORS preflight for the site only", async () => {
    const ok = await handleReport(
      new Request("https://w.dev/report", { method: "OPTIONS", headers: { Origin: ORIGIN } }),
      env(),
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    const other = await handleReport(
      new Request("https://w.dev/report", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
      env(),
    );
    expect(other.status).toBe(403);
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("refuses other origins and methods without calling GitHub", async () => {
    const fetchImpl = github();
    const foreign = await handleReport(
      post(form, { Origin: "https://evil.example" }),
      env(),
      fetchImpl,
    );
    expect(foreign.status).toBe(403);
    const get = await handleReport(
      new Request("https://w.dev/report", { headers: { Origin: ORIGIN } }),
      env(),
      fetchImpl,
    );
    expect(get.status).toBe(405);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns 429 when either rate limit is spent", async () => {
    const fetchImpl = github();
    const perIp = await handleReport(
      post(form),
      env({ REPORT_IP_LIMITER: limiter(false), REPORT_ALL_LIMITER: limiter(true) }),
      fetchImpl,
    );
    expect(perIp.status).toBe(429);
    const all = await handleReport(
      post(form),
      env({ REPORT_IP_LIMITER: limiter(true), REPORT_ALL_LIMITER: limiter(false) }),
      fetchImpl,
    );
    expect(all.status).toBe(429);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("limits per visitor IP", async () => {
    const keys: string[] = [];
    const spy: RateLimiter = {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: true };
      },
    };
    await handleReport(
      post(form, { "CF-Connecting-IP": "203.0.113.7" }),
      env({ REPORT_IP_LIMITER: spy }),
      github(),
    );
    expect(keys).toEqual(["203.0.113.7"]);
  });

  it("rejects bad JSON, invalid reports and oversized bodies", async () => {
    const fetchImpl = github();
    expect((await handleReport(post("{nope"), env(), fetchImpl)).status).toBe(400);
    expect((await handleReport(post({ description: "short" }), env(), fetchImpl)).status).toBe(400);
    const huge = { ...form, userAgent: "x".repeat(2_200_000) };
    expect((await handleReport(post(huge), env(), fetchImpl)).status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("pretends to accept a filled honeypot but files nothing", async () => {
    const fetchImpl = github();
    const res = await handleReport(
      post({ ...form, website: "https://spam.example" }),
      env(),
      fetchImpl,
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a missing Content-Length as zero", async () => {
    const req = post(form);
    expect(req.headers.get("Content-Length")).toBeNull();
    const res = await handleReport(req, env(), github());
    expect(res.status).toBe(201);
  });

  it("rejects a body that is bigger than its Content-Length claims", async () => {
    const fetchImpl = github();
    const claimed = new Request("https://w.dev/report", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json", "Content-Length": "8" },
      body: "x".repeat(2_100_001),
    });
    expect((await handleReport(claimed, env(), fetchImpl)).status).toBe(413);
    const header = new Request("https://w.dev/report", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "Content-Type": "application/json",
        "Content-Length": String(2_100_001),
      },
      body: JSON.stringify(form),
    });
    expect((await handleReport(header, env(), fetchImpl)).status).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats a missing Origin header as not allowed", async () => {
    const fetchImpl = github();
    const res = await handleReport(
      new Request("https://w.dev/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      }),
      env(),
      fetchImpl,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects every origin when the allow-list is unset", async () => {
    const fetchImpl = github();
    const res = await handleReport(
      post(form),
      { ...env(), REPORT_ORIGINS: undefined as unknown as string },
      fetchImpl,
    );
    expect(res.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a GitHub failure as 502", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handleReport(post(form), env(), github(401));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "github" });
    error.mockRestore();
  });
});
