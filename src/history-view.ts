import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { CheapHourRange, FuelType, HistoryFile, HistoryHourSeries } from "./types.ts";
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
  cheapRanges: CheapHourRange[] = [],
): { destroy: () => void } | null {
  if (!series) return null;
  const brands = Object.entries(series.brands)
    .map(([id, values]) => ({ id, values }))
    .filter((b) => b.values.some((v) => v != null))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (brands.length === 0) return null;
  const hours = series.hours;
  const data: uPlot.AlignedData = [hours, ...brands.map((b) => b.values)];
  const size = chartSize(el);
  const plot = new uPlot(
    {
      width: size.width,
      height: size.height,
      padding: [8, 8, 0, 0],
      cursor: { focus: { prox: 24 }, show: size.width >= 480 },
      legend: { live: size.width >= 640 },
      scales: { x: { time: false, range: [0, 23] } },
      axes: [
        {
          stroke: "#5c6f64",
          size: 28,
          grid: { stroke: "rgb(16 32 24 / 8%)" },
          values: (_u, vals) => vals.map((v) => (v == null ? "" : hourTickLabel(Number(v)))),
        },
        {
          stroke: "#5c6f64",
          size: 40,
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
      hooks: {
        draw: [
          (u) => {
            if (cheapRanges.length === 0) return;
            const { ctx } = u;
            ctx.save();
            ctx.fillStyle = "rgb(15 138 75 / 12%)";
            for (const range of cheapRanges) {
              for (const [from, to] of hourBands(range)) {
                const x0 = u.valToPos(from, "x", true);
                const x1 = u.valToPos(to, "x", true);
                const top = u.bbox.top;
                ctx.fillRect(x0, top, Math.max(1, x1 - x0), u.bbox.height);
              }
            }
            ctx.restore();
          },
        ],
      },
    },
    data,
    el,
  );
  const ro = new ResizeObserver(() => {
    const next = chartSize(el);
    plot.setSize({ width: next.width, height: next.height });
  });
  ro.observe(el);
  return {
    destroy() {
      ro.disconnect();
      plot.destroy();
    },
  };
}

function chartSize(el: HTMLElement): { width: number; height: number } {
  const width = Math.max(160, Math.floor(el.clientWidth) || 280);
  const minH = width < 520 ? 140 : 180;
  const height = Math.max(minH, Math.min(360, Math.floor(el.clientHeight) || minH + 40));
  return { width, height };
}

function hourBands(range: CheapHourRange): Array<[number, number]> {
  if (range.start <= range.end) return [[range.start - 0.45, range.end + 0.45]];
  return [
    [range.start - 0.45, 23.45],
    [-0.45, range.end + 0.45],
  ];
}
