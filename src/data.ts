import type { DailyPrices, DataMeta, HistoryFile, Station } from "./types.ts";

const dataUrl = (file: string): string => {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}data/${file}`;
};

export interface AppData {
  stations: Station[];
  prices: DailyPrices | null;
  meta: DataMeta | null;
}

/** Last time published prices changed. Unchanged source checks do not move this. */
export function lastUpdatedAt(data: Pick<AppData, "prices" | "meta">): string | undefined {
  return data.prices?.generatedAt ?? data.meta?.generatedAt ?? undefined;
}

/** Newest source observation (Excel 10:00, live submit, or report). Distinct from last updated. */
export function pricesObservedAt(data: Pick<AppData, "prices" | "meta">): string | undefined {
  const observed = data.meta?.observedAt;
  if (!observed) return undefined;
  const updated = lastUpdatedAt(data);
  if (updated && Math.abs(Date.parse(observed) - Date.parse(updated)) < 60_000) return undefined;
  return observed;
}

export type SourceLabel = "lea" | "circle-k" | "report";

/** Attribution for the list footer. Both LEA feeds read as one source; LEA when unknown. */
export function sourceLabels(meta: DataMeta | null | undefined): SourceLabel[] {
  const out: SourceLabel[] = [];
  for (const source of meta?.sources ?? []) {
    const label: SourceLabel | null =
      source === "lea" || source === "lea-live"
        ? "lea"
        : source === "circle-k" || source === "report"
          ? source
          : null;
    if (label && !out.includes(label)) out.push(label);
  }
  return out.length ? out : ["lea"];
}

export async function loadAppData(): Promise<AppData> {
  const [stations, meta] = await Promise.all([
    fetchJson<Station[]>(dataUrl("stations.json"), []),
    fetchJson<DataMeta | null>(dataUrl("meta.json"), null),
  ]);
  let prices: DailyPrices | null = null;
  if (meta?.date) {
    prices = await fetchJson<DailyPrices | null>(dataUrl(`prices/${meta.date}.json`), null);
  }
  return { stations, prices, meta };
}

/** Loaded only when the history view opens so map search stays light. */
export async function loadHistory(): Promise<HistoryFile | null> {
  const raw = await fetchJson<unknown>(dataUrl("history.json"), null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("byFuel" in raw)) return null;
  return raw as HistoryFile;
}

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}
