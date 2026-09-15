import type { HistoryHourSeries } from "./types.ts";

const BRAND_COLORS: Record<string, string> = {
  "circle-k": "#c81e1e",
  viada: "#15803d",
  orlen: "#b91c1c",
  neste: "#1d4ed8",
  "baltic-petroleum": "#0f766e",
  alausa: "#a16207",
  emsi: "#7c3aed",
  jozita: "#c2410c",
  stateta: "#0369a1",
  ecoil: "#4d7c0f",
  kvistija: "#be185d",
  independent: "#6b7280",
};

const FALLBACK_COLORS = ["#ea580c", "#2563eb", "#9333ea", "#0d9488", "#ca8a04", "#e11d48"];

export function brandColor(brand: string, index: number): string {
  return BRAND_COLORS[brand] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export function chartBrands(
  series: HistoryHourSeries | undefined,
): Array<{ id: string; values: Array<number | null> }> {
  if (!series) return [];
  return Object.entries(series.brands)
    .map(([id, values]) => ({ id, values }))
    .filter((b) => b.values.some((v) => v != null))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function isHistoryBrandOn(hidden: ReadonlySet<string>, id: string): boolean {
  return !hidden.has(id);
}

export function allHistoryBrandsOn(hidden: ReadonlySet<string>, ids: readonly string[]): boolean {
  return ids.every((id) => !hidden.has(id));
}

export function toggleHistoryBrand(hidden: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(hidden);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Hide every listed brand when all are on; otherwise turn all of them on. */
export function toggleAllHistoryBrands(
  hidden: ReadonlySet<string>,
  ids: readonly string[],
): Set<string> {
  if (ids.length === 0) return new Set(hidden);
  return allHistoryBrandsOn(hidden, ids) ? new Set(ids) : new Set();
}
