/** The site's feedback form: each POST /report (a bug or a feature idea) becomes a GitHub issue. */

import { parseImage, storeImage, type ImageStore, type ReportImage } from "./report-image.ts";

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
  /** Workers KV for attached pictures. Without it, a picture is noted as lost in the issue. */
  REPORT_IMAGES?: ImageStore;
  /** Workers KV for senders' email addresses, which never go into the public issue. */
  REPORT_CONTACTS?: ContactStore;
}

/** The part of a Workers KV namespace binding used for contact addresses. */
export interface ContactStore {
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export type ReportCategory = "bug" | "feature";

export interface Report {
  category: ReportCategory;
  description: string;
  /** Where the maintainer can reply. Kept out of the issue. */
  email: string;
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
export const MAX_EMAIL = 254;
/** Something@somewhere.tld with no spaces or characters mail addresses cannot hold unquoted. */
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;
/** Contact addresses go after a year, like pictures. */
export const CONTACT_TTL_SECONDS = 365 * 24 * 60 * 60;
/** Text and context, plus a base64 picture of up to MAX_IMAGE_BYTES. */
const MAX_BODY_BYTES = 2_100_000;
const TITLE_CHARS = 80;
export const REPORT_LABELS: Record<ReportCategory, string[]> = {
  bug: ["bug", "user-report"],
  feature: ["enhancement", "user-report"],
};

/** Form fields the site sends besides the description. Anything else in the JSON is ignored. */
const CONTEXT_FIELDS = ["page", "locale", "fuel", "dataDate", "userAgent", "viewport"] as const;

/**
 * A valid report, or `null`. No category means a bug: pages cached before ideas existed send none.
 * The email address is required; context fields are optional and cut to {@link MAX_FIELD}.
 */
export function parseReport(value: unknown): Report | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const category = raw.category ?? "bug";
  if (category !== "bug" && category !== "feature") return null;
  if (typeof raw.description !== "string") return null;
  const description = cleanText(raw.description).trim();
  if (description.length < MIN_DESCRIPTION || description.length > MAX_DESCRIPTION) return null;
  if (typeof raw.email !== "string" || !isEmail(raw.email.trim())) return null;
  const report = { category, description, email: raw.email.trim() } as Report;
  for (const key of CONTEXT_FIELDS) {
    const v = raw[key];
    report[key] = typeof v === "string" ? cleanLine(v).slice(0, MAX_FIELD) : "";
  }
  return report;
}

export function isEmail(value: string): boolean {
  return value.length <= MAX_EMAIL && EMAIL.test(value);
}

/** Stores the sender's address under a new random key, or returns `null` if KV failed. */
export async function storeContact(
  store: ContactStore | undefined,
  email: string,
): Promise<string | null> {
  if (!store) return null;
  const key = crypto.randomUUID();
  try {
    await store.put(key, email, { expirationTtl: CONTACT_TTL_SECONDS });
  } catch (err) {
    console.error(`Storing the contact address failed: ${String(err)}`);
    return null;
  }
  return key;
}

/** People never see the hidden `website` field, so only bots fill it in. */
export function isHoneypotFilled(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const website = (value as Record<string, unknown>).website;
  return typeof website === "string" && website.trim() !== "";
}

/** The attached picture: its URL on this worker, or `null` when it could not be stored. */
export type IssueImage = { url: string | null } | undefined;

export interface IssueExtras {
  image?: IssueImage;
  /** KV key of the sender's address, `null` when it could not be stored, unset when not tried. */
  contactKey?: string | null;
}

/**
 * Issue text with everything the visitor typed inside code blocks: no @mentions that would ping
 * people, no `owner/repo#1` references that would show up in other repositories, no HTML. The
 * picture URL is the worker's own, never the visitor's, and the email address is never included.
 */
export function issueFromReport(report: Report, { image, contactKey }: IssueExtras = {}): Issue {
  const context = [
    `Page:     ${report.page || "-"}`,
    `Language: ${report.locale || "-"}`,
    `Fuel:     ${report.fuel || "-"}`,
    `Data:     ${report.dataDate || "-"}`,
    `Browser:  ${report.userAgent || "-"}`,
    `Screen:   ${report.viewport || "-"}`,
  ].join("\n");
  return {
    title: `[${report.category}] ${issueTitle(report.description)}`,
    body: [
      report.category === "feature" ? "### Idea" : "### Description",
      "",
      codeBlock(report.description),
      "",
      ...(image
        ? [
            "### Picture",
            "",
            image.url
              ? `![Picture from the reporter](${image.url})`
              : "_A picture was attached but could not be stored._",
            "",
          ]
        : []),
      "### Context",
      "",
      codeBlock(context),
      "",
      ...(contactKey === undefined
        ? []
        : [
            "### Contact",
            "",
            contactKey
              ? `The sender left an email address. It is not published: find it in Cloudflare KV namespace \`kur-degalai-report-contacts\`, key \`${contactKey}\`.`
              : "_The sender left an email address, but it could not be stored._",
            "",
          ]),
      "_Sent from the site's feedback form. The sender does not see replies here; write to them by email._",
    ].join("\n"),
    labels: REPORT_LABELS[report.category],
  };
}

/** First line of the description, shortened, with mentions and issue references broken up. */
export function issueTitle(description: string): string {
  const line = description.split("\n", 1)[0].replace(/\s+/g, " ").trim();
  const short = line.length > TITLE_CHARS ? `${line.slice(0, TITLE_CHARS - 1).trimEnd()}…` : line;
  return short.replace(/[@#]/g, (c) => `${c}\u200b`);
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

  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) {
    return reply(413, { ok: false, error: "size" });
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
  const rawImage = (json as Record<string, unknown>).image;
  let image: ReportImage | null = null;
  if (rawImage !== undefined && rawImage !== null && rawImage !== "") {
    image = parseImage(rawImage);
    if (!image) return reply(400, { ok: false, error: "image" });
  }
  // A failed store still files the report, saying the picture or address is missing.
  const issueImage: IssueImage = image
    ? { url: await storeImage(env.REPORT_IMAGES, image, new URL(request.url).origin) }
    : undefined;
  const contactKey = await storeContact(env.REPORT_CONTACTS, report.email);

  const res = await fetchImpl(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "kur-degalai-report",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(issueFromReport(report, { image: issueImage, contactKey })),
  });
  if (!res.ok) {
    console.error(`Creating the issue failed: ${res.status} ${await res.text()}`);
    return reply(502, { ok: false, error: "github" });
  }
  const issue = (await res.json()) as { number: number; html_url: string };
  console.log(`Filed report #${issue.number}`);
  return reply(201, {
    ok: true,
    number: issue.number,
    url: issue.html_url,
    ...(issueImage ? { imageSaved: issueImage.url !== null } : {}),
  });
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
