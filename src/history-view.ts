import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { FuelType, HistoryPoint } from "./types.ts";
import { formatPrice } from "./format.ts";
import { t } from "./i18n/index.ts";

export type HistoryRange = "1m" | "3m" | "1y" | "all";

export const HISTORY_RANGES: HistoryRange[] = ["1m", "3m", "1y", "all"];

export function historyRangeStart(range: HistoryRange, now = new Date()): string | null {
  if (range === "all") return null;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (range === "1m") d.setUTCMonth(d.getUTCMonth() - 1);
  else if (range === "3m") d.setUTCMonth(d.getUTCMonth() - 3);
  else d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

export function filterHistory(
  points: HistoryPoint[],
  range: HistoryRange,
  now = new Date(),
): HistoryPoint[] {
  const start = historyRangeStart(range, now);
  if (!start) return points;
  return points.filter((p) => p.date >= start);
}

export function historySeries(
  points: HistoryPoint[],
  fuel: FuelType,
): [number[], number[], number[]] {
  const xs: number[] = [];
  const mins: number[] = [];
  const meds: number[] = [];
  for (const p of points) {
    const s = p.byFuel[fuel];
    if (!s) continue;
    xs.push(Math.floor(Date.parse(`${p.date}T12:00:00Z`) / 1000));
    mins.push(s.min);
    meds.push(s.median);
  }
  return [xs, mins, meds];
}

export function latestHistoryPoint(
  points: HistoryPoint[],
  fuel: FuelType,
): HistoryPoint | undefined {
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].byFuel[fuel]) return points[i];
  }
  return undefined;
}

export function mountHistoryChart(
  el: HTMLElement,
  points: HistoryPoint[],
  fuel: FuelType,
): uPlot | null {
  const data = historySeries(points, fuel);
  if (data[0].length < 2) return null;
  const width = Math.max(280, Math.floor(el.clientWidth) || 320);
  const height = Math.max(200, Math.min(360, Math.floor(el.clientHeight) || 280));
  return new uPlot(
    {
      width,
      height,
      cursor: { focus: { prox: 24 } },
      legend: { live: true },
      scales: { x: { time: true } },
      axes: [
        {
          stroke: "#5c6f64",
          grid: { stroke: "rgb(16 32 24 / 8%)" },
        },
        {
          stroke: "#5c6f64",
          grid: { stroke: "rgb(16 32 24 / 8%)" },
          values: (_u, vals) => vals.map((v) => (v == null ? "" : Number(v).toFixed(2))),
        },
      ],
      series: [
        {},
        {
          label: t("history.min"),
          stroke: "#0f8a4b",
          width: 2,
          value: (_u, v) => (v == null ? "—" : formatPrice(v)),
        },
        {
          label: t("history.median"),
          stroke: "#ca8a04",
          width: 2,
          value: (_u, v) => (v == null ? "—" : formatPrice(v)),
        },
      ],
    },
    data,
    el,
  );
}
