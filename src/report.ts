/** Feedback, a bug or a feature idea: posted to worker/src/report.ts, which files an issue. */

export const ISSUES_NEW_URL = "https://github.com/Almantask/Degalai-web/issues/new";
/** Same bounds as the worker; shorter text is rejected before sending. */
export const MIN_REPORT_CHARS = 10;
export const MAX_REPORT_CHARS = 2000;
export const REPORT_CATEGORIES = ["bug", "feature"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** What the visitor filled in. */
export interface ReportForm {
  category: ReportCategory;
  description: string;
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
  | { ok: false; reason: "rate" | "failed" };

export async function sendReport(
  endpoint: string,
  form: ReportForm,
  context: ReportContext,
  fetchImpl: typeof fetch = fetch,
): Promise<ReportResult> {
  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, ...context }),
    });
    if (res.status === 429) return { ok: false, reason: "rate" };
    if (!res.ok) return { ok: false, reason: "failed" };
    const body = (await res.json()) as { number?: unknown; url?: unknown; imageSaved?: unknown };
    return {
      ok: true,
      number: typeof body.number === "number" ? body.number : undefined,
      url: typeof body.url === "string" && body.url.startsWith("https://") ? body.url : undefined,
      imageSaved: typeof body.imageSaved === "boolean" ? body.imageSaved : undefined,
    };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/** A prefilled "new issue" page, for when the worker is not set up or cannot be reached. */
export function githubIssueLink(
  { category, description }: Pick<ReportForm, "category" | "description">,
  context: ReportContext,
): string {
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
  const params = new URLSearchParams({
    title: `[${category}] ${firstLine}`,
    body,
    labels: category === "feature" ? "enhancement" : "bug",
  });
  return `${ISSUES_NEW_URL}?${params}`;
}
