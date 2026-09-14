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
