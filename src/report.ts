/** Feedback, a bug or a feature idea: posted to worker/src/report.ts, which files an issue. */

/** The cron worker's endpoint, which files the issue with the maintainer's token. */
export const REPORT_ENDPOINT = "https://kur-degalai-cron.almantusk.workers.dev/report";
/** Where reports land, newest first; offered when the worker has not answered in time. */
export const REPORTS_LIST_URL =
  "https://github.com/Almantask/Degalai-web/issues?q=is%3Aissue+label%3Auser-report";
/** How long the form waits for the issue's number; the form tells the visitor so. */
export const REPORT_TIMEOUT_MS = 60_000;
/** Same bounds as the worker; shorter text is rejected before sending. */
export const MIN_REPORT_CHARS = 10;
export const MAX_REPORT_CHARS = 2000;
export const MAX_EMAIL_CHARS = 254;
/** The worker's rule (worker/src/report.ts): something@somewhere.tld, no spaces. */
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/;
export const REPORT_CATEGORIES = ["bug", "feature"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** What the visitor filled in. */
export interface ReportForm {
  category: ReportCategory;
  description: string;
  /** For the maintainer's reply; the worker keeps it out of the public issue. */
  email: string;
  /** The hidden honeypot field; people leave it empty. */
  website: string;
  /** An attached picture as a data URL (see report-image.ts). */
  image?: string;
}

/** What the page knew when the report was written, so a maintainer can reproduce it. */
export interface ReportContext {
  page: string;
  locale: string;
  fuel: string;
  dataDate: string;
  userAgent: string;
  viewport: string;
}

export type ReportResult =
  | {
      ok: true;
      number?: number;
      url?: string;
      /** `false` when a picture was sent but the worker could not store it. */
      imageSaved?: boolean;
    }
  /** `timeout`: no answer in time, though the issue may well have been filed. */
  | { ok: false; reason: "rate" | "failed" | "timeout" };

export async function sendReport(
  endpoint: string,
  form: ReportForm,
  context: ReportContext,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = REPORT_TIMEOUT_MS,
): Promise<ReportResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result: ReportResult = { ok: false, reason: "failed" };
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, ...context }),
      signal: controller.signal,
    });
    if (res.status === 429) result = { ok: false, reason: "rate" };
    else if (!res.ok) result = { ok: false, reason: "failed" };
    else {
      const body = (await res.json()) as { number?: unknown; url?: unknown; imageSaved?: unknown };
      result = {
        ok: true,
        number: typeof body.number === "number" ? body.number : undefined,
        url: typeof body.url === "string" && body.url.startsWith("https://") ? body.url : undefined,
        imageSaved: typeof body.imageSaved === "boolean" ? body.imageSaved : undefined,
      };
    }
  } catch {
    result = { ok: false, reason: controller.signal.aborted ? "timeout" : "failed" };
  } finally {
    clearTimeout(timer);
  }
  return result;
}

export function isEmail(value: string): boolean {
  return value.length <= MAX_EMAIL_CHARS && EMAIL.test(value);
}
