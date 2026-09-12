import type { DailyPrices, DataMeta, HistoryPoint, Station } from "./types.ts";

const dataUrl = (file: string): string => {
  const base = import.meta.env.BASE_URL || "/";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return `${prefix}data/${file}`;
};

export interface AppData {
  stations: Station[];
  prices: DailyPrices | null;
  history: HistoryPoint[];
  meta: DataMeta | null;
}

export async function loadAppData(): Promise<AppData> {
  const [stations, meta, history] = await Promise.all([
    fetchJson<Station[]>(dataUrl("stations.json"), []),
    fetchJson<DataMeta | null>(dataUrl("meta.json"), null),
    fetchJson<HistoryPoint[]>(dataUrl("history.json"), []),
  ]);
  let prices: DailyPrices | null = null;
  if (meta?.date) {
    prices = await fetchJson<DailyPrices | null>(dataUrl(`prices/${meta.date}.json`), null);
  }
  return { stations, prices, history, meta };
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
