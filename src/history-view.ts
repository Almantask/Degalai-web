import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { FuelType, HistoryFile, HistoryHourSeries } from "./types.ts";
import { formatPrice } from "./format.ts";
import { brandLabel, t } from "./i18n/index.ts";

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

export function providerSeries(
  file: HistoryFile | null,
  fuel: FuelType,
): { hours: number[]; brands: Array<{ id: string; values: Array<number | null> }> } {
  const series = file?.byFuel[fuel];
  if (!series) return { hours: [...Array(24).keys()], brands: [] };
  return {
    hours: series.hours,
    brands: Object.entries(series.brands)
      .map(([id, values]) => ({ id, values }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function brandColor(brand: string, index: number): string {
  return BRAND_COLORS[brand] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export function hourTickLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function mountHistoryChart(
  el: HTMLElement,
  series: HistoryHourSeries | undefined,
): uPlot | null {
  if (!series) return null;
  const brands = Object.entries(series.brands)
    .map(([id, values]) => ({ id, values }))
    .filter((b) => b.values.some((v) => v != null))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (brands.length === 0) return null;
  const hours = series.hours;
  const data: uPlot.AlignedData = [hours, ...brands.map((b) => b.values)];
  const width = Math.max(280, Math.floor(el.clientWidth) || 320);
  const height = Math.max(220, Math.min(380, Math.floor(el.clientHeight) || 300));
  return new uPlot(
    {
      width,
      height,
      cursor: { focus: { prox: 24 } },
      legend: { live: true },
      scales: { x: { time: false, range: [0, 23] } },
      axes: [
        {
          stroke: "#5c6f64",
          grid: { stroke: "rgb(16 32 24 / 8%)" },
          values: (_u, vals) => vals.map((v) => (v == null ? "" : hourTickLabel(Number(v)))),
        },
        {
          stroke: "#5c6f64",
          grid: { stroke: "rgb(16 32 24 / 8%)" },
          values: (_u, vals) => vals.map((v) => (v == null ? "" : Number(v).toFixed(2))),
        },
      ],
      series: [
        { label: t("history.hour") },
        ...brands.map((b, i) => ({
          label: brandLabel(b.id),
          stroke: brandColor(b.id, i),
          width: 2,
          spanGaps: true,
          value: (_u: uPlot, v: number | null) => (v == null ? "—" : formatPrice(v)),
        })),
      ],
    },
    data,
    el,
  );
}
