/** The site's "Report a problem" form: each POST /report becomes a GitHub issue. */

/** Workers rate limit binding (`ratelimits` in wrangler.jsonc). */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ReportEnv {
  GITHUB_TOKEN: string;
  GITHUB_REPO: string;
  /** Comma-separated origins allowed to post, e.g. "https://almantask.github.io". */
  REPORT_ORIGINS: string;
  /** Per visitor IP. */
  REPORT_IP_LIMITER?: RateLimiter;
  /** All visitors together, so a botnet cannot flood the issue tracker either. */
  REPORT_ALL_LIMITER?: RateLimiter;
}

export interface BugReport {
  description: string;
  page: string;
  locale: string;
  fuel: string;
  dataDate: string;
  userAgent: string;
  viewport: string;
}

export interface Issue {
  title: string;
  body: string;
  labels: string[];
}

export const MIN_DESCRIPTION = 10;
export const MAX_DESCRIPTION = 2000;
const MAX_FIELD = 300;
const MAX_BODY_BYTES = 8_000;
const TITLE_CHARS = 80;
export const REPORT_LABELS = ["bug", "user-report"];

/** Form fields the site sends besides the description. Anything else in the JSON is ignored. */
const CONTEXT_FIELDS = ["page", "locale", "fuel", "dataDate", "userAgent", "viewport"] as const;

/** A valid report, or `null`. Context fields are optional and cut to {@link MAX_FIELD}. */
export function parseReport(value: unknown): BugReport | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.description !== "string") return null;
  const description = cleanText(raw.description).trim();
  if (description.length < MIN_DESCRIPTION || description.length > MAX_DESCRIPTION) return null;
  const report = { description } as BugReport;
  for (const key of CONTEXT_FIELDS) {
    const v = raw[key];
    report[key] = typeof v === "string" ? cleanLine(v).slice(0, MAX_FIELD) : "";
  }
  return report;
}

/** People never see the hidden `website` field, so only bots fill it in. */
export function isHoneypotFilled(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const website = (value as Record<string, unknown>).website;
  return typeof website === "string" && website.trim() !== "";
}

/**
 * Issue text with everything the visitor typed inside code blocks: no @mentions that would ping
 * people, no `owner/repo#1` references that would show up in other repositories, no HTML.
 */
export function issueFromReport(report: BugReport): Issue {
  const context = [
    `Page:     ${report.page || "-"}`,
    `Language: ${report.locale || "-"}`,
    `Fuel:     ${report.fuel || "-"}`,
    `Data:     ${report.dataDate || "-"}`,
    `Browser:  ${report.userAgent || "-"}`,
    `Screen:   ${report.viewport || "-"}`,
  ].join("\n");
  return {
    title: `[bug] ${issueTitle(report.description)}`,
    body: [
      "### Description",
      "",
      codeBlock(report.description),
      "",
      "### Context",
      "",
      codeBlock(context),
      "",
      "_Sent anonymously from the site's “Report a problem” form; the reporter will not see replies here._",
    ].join("\n"),
    labels: REPORT_LABELS,
  };
}

/** First line of the description, shortened, with mentions and issue references broken up. */
export function issueTitle(description: string): string {
  const line = description.split("\n", 1)[0].replace(/\s+/g, " ").trim();
  const short = line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1).trimEnd()}…` : line;
  return short.replace(/[@#]/g, (c) => `${c}​`);
}

/** A fenced block one backtick longer than any run inside, so the text cannot close it. */
export function codeBlock(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

export async function handleReport(
  request: Request,
  env: ReportEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = allowedOrigins(env).includes(origin);
  const cors: Record<string, string> = allowed
    ? {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : { Vary: "Origin" };
  const reply = (status: number, body?: Record<string, unknown>) =>
    body
      ? Response.json(body, { status, headers: cors })
      : new Response(null, { status, headers: cors });

  if (request.method === "OPTIONS") return reply(allowed ? 204 : 403);
  if (request.method !== "POST") return reply(405, { ok: false, error: "method" });
  // Only the site's own pages may post; a script elsewhere could still forge the header, which
  // is what the rate limits are for.
  if (!allowed) return reply(403, { ok: false, error: "origin" });

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await underLimit(env.REPORT_IP_LIMITER, ip))) {
    return reply(429, { ok: false, error: "rate" });
  }
  if (!(await underLimit(env.REPORT_ALL_LIMITER, "all"))) {
    return reply(429, { ok: false, error: "rate" });
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return reply(413, { ok: false, error: "size" });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return reply(400, { ok: false, error: "json" });
  }
  // Tell the bot it worked so it does not retry with the field empty.
  if (isHoneypotFilled(json)) return reply(201, { ok: true });
  const report = parseReport(json);
  if (!report) return reply(400, { ok: false, error: "invalid" });

  const res = await fetchImpl(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "kur-degalai-report",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(issueFromReport(report)),
  });
  if (!res.ok) {
    console.error(`Creating the issue failed: ${res.status} ${await res.text()}`);
    return reply(502, { ok: false, error: "github" });
  }
  const issue = (await res.json()) as { number: number; html_url: string };
  console.log(`Filed report #${issue.number}`);
  return reply(201, { ok: true, number: issue.number, url: issue.html_url });
}

function allowedOrigins(env: ReportEnv): string[] {
  return (env.REPORT_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

async function underLimit(limiter: RateLimiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key });
  return success;
}

/** Drops control characters other than newline and tab; normalises line endings. */
function cleanText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

function cleanLine(s: string): string {
  return cleanText(s).replace(/\s+/g, " ").trim();
}
