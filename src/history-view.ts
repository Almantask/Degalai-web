import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { CheapHourRange, FuelType, HistoryFile, HistoryHourSeries } from "./types.ts";
import { formatPrice } from "./format.ts";
import { brandColor, chartBrands, isHistoryBrandOn } from "./history-series.ts";
import { brandLabel, t } from "./i18n/index.ts";

export { brandColor, chartBrands } from "./history-series.ts";

/** CSS pixels per hour so 24h labels stay readable and the chart can scroll. */
export const HISTORY_HOUR_MIN_PX = 48;
export const HISTORY_Y_AXIS_PX = 36;
export const HISTORY_X_PAD_PX = 8;

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

export function hourTickLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
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
  cheapStart?: number,
): number {
  if (cheapStart != null && Number.isFinite(cheapStart)) return cheapStart;
  for (let i = 0; i < hours.length; i++) {
    if (valuesByBrand.some((vals) => vals[i] != null)) return hours[i] ?? i;
  }
  return hours[0] ?? 0;
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
  cheapRanges: CheapHourRange[] = [],
  hiddenBrands: ReadonlySet<string> = new Set(),
): HistoryPlot | null {
  if (!series) return null;
  const brands = chartBrands(series);
  if (brands.length === 0) return null;
  const hours = series.hours;
  const data: uPlot.AlignedData = [hours, ...brands.map((b) => b.values)];

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

  const size = chartSize(scroll, hours.length);
  const initialHour = historyChartInitialHour(
    hours,
    brands.map((b) => b.values),
    cheapRanges[0]?.start,
  );
  const plot = new uPlot(
    {
      width: size.width,
      height: size.height,
      padding: [4, 6, 0, 0],
      cursor: {
        focus: { prox: 24 },
        show: scroll.clientWidth >= 480,
        drag: { x: false, y: false, setScale: false },
      },
      legend: { show: false },
      scales: { x: { time: false, range: [0, 23] } },
      axes: [
        {
          stroke: "#5c6f64",
          size: 26,
          grid: { stroke: "rgb(16 32 24 / 8%)" },
          values: (_u, vals) => vals.map((v) => (v == null ? "" : hourTickLabel(Number(v)))),
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
            if (cheapRanges.length > 0) {
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
            }
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
    const next = chartSize(scroll, hours.length);
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
  const height = Math.max(72, available || (viewportWidth < 520 ? 140 : 180));
  return { width, height };
}

function syncYAxisOverlay(plot: uPlot, overlay: HTMLCanvasElement): void {
  const src = plot.ctx.canvas;
  const dpr = src.width / Math.max(1, plot.width);
  const slice = Math.max(1, Math.ceil(plot.bbox.left));
  // Keep the x-axis hour labels free so they can scroll; pin only the €/l ticks.
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

function hourBands(range: CheapHourRange): Array<[number, number]> {
  if (range.start <= range.end) return [[range.start - 0.45, range.end + 0.45]];
  return [
    [range.start - 0.45, 23.45],
    [-0.45, range.end + 0.45],
  ];
}
