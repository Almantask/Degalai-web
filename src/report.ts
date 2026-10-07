/** "Report a problem": posts to the Cloudflare Worker (worker/src/report.ts), which files an issue. */

export const ISSUES_NEW_URL = "https://github.com/Almantask/Degalai-web/issues/new";
/** Same bounds as the worker; shorter text is rejected before sending. */
export const MIN_REPORT_CHARS = 10;
export const MAX_REPORT_CHARS = 2000;

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
  { ok: true; number?: number; url?: string } | { ok: false; reason: "rate" | "failed" };

export async function sendReport(
  endpoint: string,
  description: string,
  context: ReportContext,
  /** The hidden honeypot field; people leave it empty. */
  website: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ReportResult> {
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, website, ...context }),
    });
    if (res.status === 429) return { ok: false, reason: "rate" };
    if (!res.ok) return { ok: false, reason: "failed" };
    const body = (await res.json()) as { number?: unknown; url?: unknown };
    return {
      ok: true,
      number: typeof body.number === "number" ? body.number : undefined,
      url: typeof body.url === "string" && body.url.startsWith("https://") ? body.url : undefined,
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** A prefilled "new issue" page, for when the worker is not set up or cannot be reached. */
export function githubIssueLink(description: string, context: ReportContext): string {
  const body = [
    description.trim(),
    "",
    "---",
    `Page: ${context.page}`,
    `Language: ${context.locale}`,
    `Fuel: ${context.fuel}`,
    `Data: ${context.dataDate}`,
    `Browser: ${context.userAgent}`,
    `Screen: ${context.viewport}`,
  ].join("\n");
  const firstLine = description.trim().split("\n", 1)[0].slice(0, 80);
  const params = new URLSearchParams({ title: `[bug] ${firstLine}`, body, labels: "bug" });
  return `${ISSUES_NEW_URL}?${params}`;
}
