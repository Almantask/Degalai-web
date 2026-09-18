import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { FuelType, HistoryFile, HistoryHourSeries } from "./types.ts";
import { formatChartDate, formatPrice } from "./format.ts";
import { brandColor, chartBrands, isHistoryBrandOn } from "./history-series.ts";
import { formatHourClock } from "./cheap-hours.ts";
import { brandLabel, t } from "./i18n/index.ts";

export { brandColor, chartBrands } from "./history-series.ts";

/** CSS pixels per sample so date+time labels stay readable and the chart can scroll. */
export const HISTORY_HOUR_MIN_PX = 64;
export const HISTORY_Y_AXIS_PX = 36;
export const HISTORY_X_PAD_PX = 36;
const HISTORY_X_TICK_PX = 4;
const HISTORY_X_GAP_PX = 4;
/** uPlot's default axis font size. */
const HISTORY_AXIS_FONT_PX = 12;
const HISTORY_AXIS_LINE_GAP = 1.25;
/** Room for glyph descenders plus a phone's overlay scrollbar under the tick labels. */
const HISTORY_X_BOTTOM_PX = 12;

/** Height that fits `lines` of tick text so the date line is never clipped or covered. */
export function historyXAxisSize(lines: number): number {
  const text = HISTORY_AXIS_FONT_PX * (1 + HISTORY_AXIS_LINE_GAP * Math.max(0, lines - 1));
  return Math.ceil(HISTORY_X_TICK_PX + HISTORY_X_GAP_PX + text + HISTORY_X_BOTTOM_PX);
}

export const HISTORY_X_AXIS_PX = historyXAxisSize(2);
/** Smallest chart that still shows a readable plot above the two-line date/time ticks. */
export const HISTORY_CHART_MIN_PX = HISTORY_X_AXIS_PX + 64;

export function providerSeries(
  file: HistoryFile | null,
  fuel: FuelType,
): { hours: number[]; brands: Array<{ id: string; values: Array<number | null> }> } {
  const series = file?.byFuel[fuel];
  if (!series) return { hours: [], brands: [] };
  return {
    hours: series.hours,
    brands: Object.entries(series.brands)
      .map(([id, values]) => ({ id, values }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function hourTickLabel(hour: number): string {
  return formatHourClock(hour);
}

/** Two-line tick: time, then the calendar day when a date is known. */
export function historyTickLabel(date: string | undefined, hour: number): string {
  const time = formatHourClock(hour);
  if (!date) return time;
  return `${time}\n${formatChartDate(date)}`;
}

export function historyChartWidth(viewportWidth: number, hourCount: number): number {
  const viewport = Math.max(120, Math.floor(viewportWidth) || 280);
  const hours = Math.max(1, hourCount);
  return Math.max(viewport, hours * HISTORY_HOUR_MIN_PX + HISTORY_Y_AXIS_PX + HISTORY_X_PAD_PX);
}

/** Horizontal wheel/trackpad pan; Shift+wheel also pans when the device only reports deltaY. */
export function historyChartWheelDelta(deltaX: number, deltaY: number, shiftKey: boolean): number {
  if (deltaX !== 0) return deltaX;
  return shiftKey ? deltaY : 0;
}

export function historyChartInitialHour(
  hours: number[],
  valuesByBrand: Array<Array<number | null>>,
): number {
  for (let i = 0; i < hours.length; i++) {
    if (valuesByBrand.some((vals) => vals[i] != null)) return i;
  }
  return 0;
}

export function historyChartScrollLeft(
  viewportWidth: number,
  plotWidth: number,
  hour: number,
): number {
  const max = Math.max(0, plotWidth - viewportWidth);
  if (max <= 0) return 0;
  return Math.max(0, Math.min(max, Math.max(0, hour) * HISTORY_HOUR_MIN_PX));
}

export type HistoryPlot = {
  destroy: () => void;
  setHidden: (hidden: ReadonlySet<string>) => void;
};

export function mountHistoryChart(
  el: HTMLElement,
  series: HistoryHourSeries | undefined,
  hiddenBrands: ReadonlySet<string> = new Set(),
): HistoryPlot | null {
  if (!series) return null;
  const brands = chartBrands(series);
  if (brands.length === 0) return null;
  const xs = series.hours.map((_, i) => i);
  const lastX = Math.max(0, xs.length - 1);
  const data: uPlot.AlignedData = [xs, ...brands.map((b) => b.values)];

  el.replaceChildren();
  const scroll = document.createElement("div");
  scroll.className = "history-chart-scroll";
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", t("history.scroll"));
  const plotEl = document.createElement("div");
  plotEl.className = "history-chart-plot";
  scroll.append(plotEl);
  const yAxis = document.createElement("canvas");
  yAxis.className = "history-chart-yaxis";
  yAxis.setAttribute("aria-hidden", "true");
  el.append(scroll, yAxis);
  // Layout CSS around the chart (legend, pinned €/l axis) needs the same sizes.
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--history-x-axis", `${HISTORY_X_AXIS_PX}px`);
  rootStyle.setProperty("--history-chart-min", `${HISTORY_CHART_MIN_PX}px`);

  const size = chartSize(scroll, xs.length);
  const initialHour = historyChartInitialHour(
    xs,
    brands.map((b) => b.values),
  );
  const plot = new uPlot(
    {
      width: size.width,
      height: size.height,
      padding: [4, HISTORY_X_PAD_PX, 0, 0],
      cursor: {
        focus: { prox: 24 },
        show: scroll.clientWidth >= 480,
        drag: { x: false, y: false, setScale: false },
      },
      legend: { show: false },
      scales: { x: { time: false, range: [0, lastX] } },
      axes: [
        {
          stroke: "#5c6f64",
          size: HISTORY_X_AXIS_PX,
          ticks: { size: HISTORY_X_TICK_PX },
          gap: HISTORY_X_GAP_PX,
          lineGap: HISTORY_AXIS_LINE_GAP,
          grid: { stroke: "rgb(16 32 24 / 8%)" },
          values: (_u, vals) =>
            vals.map((v) => {
              if (v == null) return "";
              const i = Math.round(Number(v));
              if (Math.abs(i - Number(v)) > 0.05) return "";
              const hour = series.hours[i];
              if (hour == null) return "";
              return historyTickLabel(series.dates?.[i], hour);
            }),
        },
        {
          stroke: "#5c6f64",
          size: HISTORY_Y_AXIS_PX,
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
          show: isHistoryBrandOn(hiddenBrands, b.id),
          value: (_u: uPlot, v: number | null) => (v == null ? "—" : formatPrice(v)),
        })),
      ],
      hooks: {
        draw: [
          (u) => {
            syncYAxisOverlay(u, yAxis);
          },
        ],
      },
    },
    data,
    plotEl,
  );

  let didInitScroll = false;
  const applySize = (): void => {
    const next = chartSize(scroll, xs.length);
    if (next.width !== plot.width || next.height !== plot.height) {
      plot.setSize({ width: next.width, height: next.height });
    }
    if (!didInitScroll && scroll.clientWidth > 0) {
      didInitScroll = true;
      scroll.scrollLeft = historyChartScrollLeft(scroll.clientWidth, next.width, initialHour);
    }
  };

  const ro = new ResizeObserver(applySize);
  ro.observe(scroll);
  const raf = requestAnimationFrame(applySize);
  const onWheel = (e: WheelEvent): void => {
    const dx = historyChartWheelDelta(e.deltaX, e.deltaY, e.shiftKey);
    if (dx === 0) return;
    const max = scroll.scrollWidth - scroll.clientWidth;
    if (max <= 0) return;
    const next = Math.min(max, Math.max(0, scroll.scrollLeft + dx));
    if (next === scroll.scrollLeft) return;
    e.preventDefault();
    scroll.scrollLeft = next;
  };
  scroll.addEventListener("wheel", onWheel, { passive: false, capture: true });
  return {
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scroll.removeEventListener("wheel", onWheel, { capture: true });
      plot.destroy();
      el.replaceChildren();
    },
    setHidden(hidden: ReadonlySet<string>) {
      brands.forEach((b, i) => {
        const seriesIdx = i + 1;
        const show = !hidden.has(b.id);
        if (plot.series[seriesIdx]?.show !== show) plot.setSeries(seriesIdx, { show });
      });
    },
  };
}

function chartSize(viewport: HTMLElement, hourCount: number): { width: number; height: number } {
  const viewportWidth = Math.max(120, Math.floor(viewport.clientWidth) || 280);
  const width = historyChartWidth(viewportWidth, hourCount);
  const available = Math.floor(viewport.clientHeight);
  const height = Math.max(HISTORY_CHART_MIN_PX, available || (viewportWidth < 520 ? 140 : 180));
  return { width, height };
}

function syncYAxisOverlay(plot: uPlot, overlay: HTMLCanvasElement): void {
  const src = plot.ctx.canvas;
  const dpr = src.width / Math.max(1, plot.width);
  const slice = Math.max(1, Math.ceil(plot.bbox.left));
  // Keep the x-axis date/time labels free so they can scroll; pin only the €/l ticks.
  const sliceH = Math.min(src.height, Math.ceil(plot.bbox.top + plot.bbox.height + 2));
  const cssW = Math.ceil(slice / dpr);
  const cssH = sliceH / dpr;
  if (overlay.width !== slice || overlay.height !== sliceH) {
    overlay.width = slice;
    overlay.height = sliceH;
  }
  overlay.style.width = `${cssW}px`;
  overlay.style.height = `${cssH}px`;
  const ctx = overlay.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.drawImage(src, 0, 0, slice, sliceH, 0, 0, slice, sliceH);
}

