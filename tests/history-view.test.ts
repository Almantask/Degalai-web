// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n/index.ts";
import { formatChartDate } from "../src/format.ts";
import {
  HISTORY_HOUR_MIN_PX,
  HISTORY_X_PAD_PX,
  HISTORY_CHART_MIN_PX,
  HISTORY_X_AXIS_PX,
  HISTORY_Y_AXIS_PX,
  brandColor,
  historyChartInitialHour,
  historyChartScrollLeft,
  historyChartWheelDelta,
  historyChartWidth,
  historyNowIndex,
  historySeriesLabel,
  historyTickLabel,
  historyXAxisSize,
  hourTickLabel,
  mountHistoryChart,
  providerSeries,
} from "../src/history-view.ts";
import {
  allHistoryBrandsOn,
  chartBrands,
  seriesForStat,
  toggleAllHistoryBrands,
  toggleHistoryBrand,
} from "../src/history-series.ts";
import { SPOT_SERIES, type HistoryFile, type HistoryHourSeries } from "../src/types.ts";

interface FakePlot {
  opts: {
    width: number;
    height: number;
    cursor: { show: boolean };
    axes: Array<{
      values?: (u: unknown, vals: Array<number | null>) => string[];
    }>;
    series: Array<{
      show?: boolean;
      value?: (u: unknown, v: number | null) => string;
    }>;
    hooks: { draw: Array<(u: FakePlot) => void> };
  };
  width: number;
  height: number;
  series: Array<{ show?: boolean }>;
  ctx: {
    canvas: { width: number; height: number };
    save: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    beginPath: ReturnType<typeof vi.fn>;
    moveTo: ReturnType<typeof vi.fn>;
    lineTo: ReturnType<typeof vi.fn>;
    stroke: ReturnType<typeof vi.fn>;
    setLineDash: ReturnType<typeof vi.fn>;
    strokeStyle: string;
    lineWidth: number;
  };
  bbox: { top: number; height: number; left: number };
  valToPos: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  setSeries: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

const chartMock = vi.hoisted(() => ({
  plots: [] as FakePlot[],
  observers: [] as ResizeObserverCallback[],
  ros: [] as Array<{ disconnect: ReturnType<typeof vi.fn> }>,
  raf: null as FrameRequestCallback | null,
  cancel: vi.fn(),
}));

const viewBox = { w: 800, h: 0 };
const drawState: { ctx: CanvasRenderingContext2D | null } = { ctx: null };

vi.mock("uplot", () => {
  class UPlot {
    opts: FakePlot["opts"];
    width: number;
    height: number;
    series: Array<{ show?: boolean }>;
    ctx: FakePlot["ctx"];
    bbox = { top: 8, height: 40, left: 36 };
    valToPos = vi.fn(() => 12);
    setSize: ReturnType<typeof vi.fn>;
    setSeries: ReturnType<typeof vi.fn>;
    destroy = vi.fn();
    constructor(opts: FakePlot["opts"], _data: unknown, _el: HTMLElement) {
      this.opts = opts;
      this.width = opts.width;
      this.height = opts.height;
      this.series = opts.series.map((series) => ({ show: series.show }));
      this.ctx = {
        canvas: { width: 200, height: 100 },
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        setLineDash: vi.fn(),
        strokeStyle: "",
        lineWidth: 1,
      };
      const plot = this as unknown as FakePlot;
      this.setSize = vi.fn((size: { width: number; height: number }) => {
        plot.width = size.width;
        plot.height = size.height;
      });
      this.setSeries = vi.fn((idx: number, next: { show?: boolean }) => {
        plot.series[idx] = { ...plot.series[idx], ...next };
      });
      chartMock.plots.push(plot);
      for (const draw of opts.hooks.draw) draw(plot);
    }
  }
  return { default: UPlot };
});

function canvasCtx(): CanvasRenderingContext2D {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  chartMock.plots.length = 0;
  chartMock.observers.length = 0;
  chartMock.ros.length = 0;
  chartMock.raf = null;
  chartMock.cancel = vi.fn();
  viewBox.w = 800;
  viewBox.h = 0;
  drawState.ctx = canvasCtx();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      constructor(cb: ResizeObserverCallback) {
        chartMock.observers.push(cb);
        chartMock.ros.push(this);
      }
      observe() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    chartMock.raf = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", chartMock.cancel);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => viewBox.w);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => viewBox.h);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => drawState.ctx as never,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const file: HistoryFile = {
  generatedAt: "2026-09-14T12:00:00Z",
  keepDays: 7,
  samples: [],
  byFuel: {
    D: {
      dates: Array.from({ length: 24 }, () => "2026-09-14"),
      hours: [...Array(24).keys()],
      brands: {
        "circle-k": Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.55 : null)),
        viada: Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.52 : null)),
      },
    },
  },
};

describe("providerSeries", () => {
  it("lists brands alphabetically for the selected fuel", () => {
    const { brands } = providerSeries(file, "D");
    expect(brands.map((b) => b.id)).toEqual(["circle-k", "viada"]);
    expect(brands[1].values[8]).toBe(1.52);
  });

  it("returns no brands when the fuel is missing", () => {
    expect(providerSeries(file, "LPG").brands).toEqual([]);
    expect(providerSeries(null, "D").brands).toEqual([]);
  });
});

describe("hourTickLabel", () => {
  it("pads hours", () => {
    expect(hourTickLabel(0)).toBe("00:00");
    expect(hourTickLabel(9)).toBe("09:00");
    expect(hourTickLabel(15)).toBe("15:00");
  });
});

describe("historyTickLabel", () => {
  it("pairs time with the calendar day", () => {
    setLocale("en");
    expect(historyTickLabel("2026-09-15", 7)).toBe(`07:00\n${formatChartDate("2026-09-15")}`);
    expect(historyTickLabel(undefined, 9)).toBe("09:00");
  });
});

describe("historyXAxisSize", () => {
  it("leaves room for both tick lines, descenders and an overlay scrollbar", () => {
    // uPlot draws a tick, a gap, then 12px lines; the date line would clip at the old 40px.
    expect(HISTORY_X_AXIS_PX).toBe(historyXAxisSize(2));
    expect(HISTORY_X_AXIS_PX).toBeGreaterThanOrEqual(4 + 4 + 12 * 1.25 + 12 + 10);
    expect(historyXAxisSize(2)).toBeGreaterThan(historyXAxisSize(1));
    expect(HISTORY_CHART_MIN_PX).toBeGreaterThan(HISTORY_X_AXIS_PX + 40);
  });
});

describe("historyChartWidth", () => {
  it("is wider than a phone viewport so several days can scroll", () => {
    const min = 24 * HISTORY_HOUR_MIN_PX + HISTORY_Y_AXIS_PX + HISTORY_X_PAD_PX;
    expect(historyChartWidth(320, 24)).toBe(min);
    expect(min).toBeGreaterThan(320);
  });

  it("uses the viewport when it already fits every sample", () => {
    expect(historyChartWidth(1600, 9)).toBe(1600);
  });

  it("falls back when the viewport width is zero", () => {
    expect(historyChartWidth(0, 1)).toBe(280);
  });
});

describe("historyChartWheelDelta", () => {
  it("pans from deltaX, or from shift+wheel when only deltaY is set", () => {
    expect(historyChartWheelDelta(40, 12, false)).toBe(40);
    expect(historyChartWheelDelta(0, 40, true)).toBe(40);
    expect(historyChartWheelDelta(0, 40, false)).toBe(0);
  });
});

describe("historyChartInitialHour", () => {
  it("starts at the first sample with prices", () => {
    const hours = [...Array(24).keys()];
    const values = [Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.5 : null))];
    expect(historyChartInitialHour(hours, values)).toBe(8);
    expect(historyChartInitialHour(hours, [Array(24).fill(null)])).toBe(0);
  });
});

describe("historyChartScrollLeft", () => {
  it("clamps to the scrollable range and starts near the requested hour", () => {
    expect(historyChartScrollLeft(1600, 1196, 7)).toBe(0);
    expect(historyChartScrollLeft(320, 1196, 0)).toBe(0);
    expect(historyChartScrollLeft(320, 1196, 7)).toBe(7 * HISTORY_HOUR_MIN_PX);
    expect(historyChartScrollLeft(320, 1196, 23)).toBe(1196 - 320);
  });
});

describe("brandColor", () => {
  it("uses a stable color for known brands", () => {
    expect(brandColor("neste", 0)).toBe("#1d4ed8");
    expect(brandColor("unknown-brand", 0)).not.toBe(brandColor("unknown-brand", 1));
  });
});

describe("chartBrands", () => {
  it("drops brands that have no prices", () => {
    const series: HistoryHourSeries = {
      dates: Array.from({ length: 24 }, () => "2026-09-14"),
      hours: [...Array(24).keys()],
      brands: {
        viada: Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.52 : null)),
        neste: Array.from({ length: 24 }, () => null),
      },
    };
    expect(chartBrands(series).map((b) => b.id)).toEqual(["viada"]);
    expect(chartBrands(undefined)).toEqual([]);
  });
});

describe("seriesForStat", () => {
  it("swaps in min prices when that mode is selected", () => {
    const series: HistoryHourSeries = {
      dates: ["2026-09-15"],
      hours: [10],
      brands: { neste: [1.5] },
      stats: { min: { neste: [1.2] }, max: { neste: [1.8] } },
    };
    expect(seriesForStat(series, "avg")?.brands.neste).toEqual([1.5]);
    expect(seriesForStat(series, "min")?.brands.neste).toEqual([1.2]);
    expect(seriesForStat(series, "max")?.brands.neste).toEqual([1.8]);
    expect(seriesForStat(series, "median")?.brands.neste).toEqual([1.5]);
  });
});

describe("history series visibility", () => {
  const ids = ["circle-k", "viada", "neste"];

  it("starts with every provider on", () => {
    expect(allHistoryBrandsOn(new Set(), ids)).toBe(true);
  });

  it("hides only the clicked provider and leaves the others on", () => {
    const hidden = toggleHistoryBrand(new Set(), "viada");
    expect([...hidden]).toEqual(["viada"]);
    expect(allHistoryBrandsOn(hidden, ids)).toBe(false);
    const restored = toggleHistoryBrand(hidden, "viada");
    expect(restored.size).toBe(0);
  });

  it("toggles all selected providers on, then off", () => {
    const mixed = toggleHistoryBrand(new Set(), "viada");
    const allOn = toggleAllHistoryBrands(mixed, ids);
    expect(allOn.size).toBe(0);
    const allOff = toggleAllHistoryBrands(allOn, ids);
    expect([...allOff].sort()).toEqual([...ids].sort());
  });
});

const priced: HistoryHourSeries = {
  dates: ["2026-09-14", "2026-09-14"],
  hours: [8, 9],
  brands: { neste: [1.5, null] },
};

function mount(
  series: HistoryHourSeries | undefined,
  opts: { now?: string; fuel?: "D" | "EV"; labels?: ReadonlyMap<string, string> } = {},
) {
  const el = document.createElement("div");
  const plot = mountHistoryChart(el, series, new Set(), opts);
  return { el, plot, fake: chartMock.plots.at(-1) };
}

describe("historyNowIndex", () => {
  it("finds the first sample at or after now", () => {
    const series: HistoryHourSeries = {
      dates: ["2026-09-14", "2026-09-14"],
      hours: [8, 10],
      brands: {},
    };
    expect(historyNowIndex(series, "not-a-date")).toBe(-1);
    expect(historyNowIndex(series, "2026-09-14T04:00:00Z")).toBe(0);
    expect(historyNowIndex(series, "2026-09-14T07:00:00Z")).toBe(1);
    expect(historyNowIndex(series, "2026-09-15T12:00:00Z")).toBe(-1);
    expect(historyNowIndex({ hours: [Number.NaN], brands: {} }, "2026-09-14T07:00:00Z")).toBe(-1);
    expect(historyNowIndex({ hours: [10], brands: {} }, "2026-09-14T07:00:00Z")).toBe(-1);
  });
});

describe("historySeriesLabel", () => {
  it("names the spot price, a known brand, or a supplied label", () => {
    setLocale("en");
    expect(historySeriesLabel(SPOT_SERIES)).toBe("Nord Pool LT");
    expect(historySeriesLabel("neste")).toBe("Neste");
    expect(historySeriesLabel("neste", new Map([["other", "X"]]))).toBe("Neste");
    expect(historySeriesLabel("custom-net", new Map([["custom-net", "Mine"]]))).toBe("Mine");
  });
});

describe("mountHistoryChart", () => {
  it("returns nothing without a series or a priced brand", () => {
    expect(mountHistoryChart(document.createElement("div"), undefined)).toBeNull();
    expect(
      mountHistoryChart(document.createElement("div"), {
        hours: [1],
        brands: { neste: [null] },
      }),
    ).toBeNull();
  });

  it("uses a short plot on a narrow screen and a taller one on a wide screen", () => {
    viewBox.w = 400;
    viewBox.h = 0;
    const narrow = mount(priced);
    expect(narrow.fake?.opts.height).toBe(140);
    expect(narrow.fake?.opts.cursor.show).toBe(false);
    viewBox.w = 800;
    const wide = mount(priced);
    expect(wide.fake?.opts.height).toBe(180);
    expect(wide.fake?.opts.cursor.show).toBe(true);
    expect(wide.fake?.opts.width).toBe(historyChartWidth(800, priced.hours.length));
    viewBox.w = 0;
    const missing = mount(priced);
    expect(missing.fake?.opts.width).toBe(historyChartWidth(280, priced.hours.length));
    expect(missing.fake?.opts.height).toBe(140);
    viewBox.w = 800;
    viewBox.h = 250;
    const tall = mount(priced);
    expect(tall.fake?.opts.height).toBe(250);
  });

  it("formats axis ticks and series values", () => {
    setLocale("en");
    const dated = mount(priced, { fuel: "D" });
    const x = dated.fake!.opts.axes[0]?.values;
    expect(x?.(null, [null, 0.4, 0, 5])).toEqual([
      "",
      "",
      `08:00\n${formatChartDate("2026-09-14")}`,
      "",
    ]);
    const y = dated.fake!.opts.axes[1]?.values;
    expect(y?.(null, [null, 1.2])).toEqual(["", "1.20"]);
    const value = dated.fake!.opts.series[1]?.value;
    expect(value?.(null, null)).toBe("—");
    expect(value?.(null, 1.5)).toContain("1.500");
    const undated = mount({ hours: [8], brands: { neste: [1.1] } });
    expect(undated.fake!.opts.axes[0]?.values?.(null, [0])).toEqual(["08:00"]);
  });

  it("draws a now marker when the series reaches the present", () => {
    const series: HistoryHourSeries = {
      dates: Array.from({ length: 12 }, () => "2026-09-14"),
      hours: [...Array(12).keys()],
      brands: { neste: Array.from({ length: 12 }, () => 1.2) },
    };
    const { fake } = mount(series, { now: "2026-09-14T07:00:00Z" });
    expect(fake?.valToPos).toHaveBeenCalledWith(10, "x", true);
    expect(fake?.ctx.setLineDash).toHaveBeenCalledWith([4, 4]);
    expect(fake?.ctx.stroke).toHaveBeenCalled();
    const quiet = mount(priced);
    expect(quiet.fake?.valToPos).not.toHaveBeenCalled();
  });

  it("pins the price axis over the scrolling plot", () => {
    const { el, fake } = mount(priced);
    const yAxis = el.querySelector("canvas") as HTMLCanvasElement;
    const draw = fake!.opts.hooks.draw[0]!;
    draw(fake!);
    expect(yAxis.width).toBe(36);
    expect(drawState.ctx?.drawImage as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    yAxis.height = 1;
    draw(fake!);
    expect(yAxis.height).toBe(50);
    const calls = (drawState.ctx?.drawImage as ReturnType<typeof vi.fn>).mock.calls.length;
    draw(fake!);
    expect((drawState.ctx?.drawImage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(
      calls + 1,
    );
    expect(yAxis.style.width).not.toBe("");
  });

  it("skips the price axis when the canvas has no 2d context", () => {
    drawState.ctx = null;
    const { el } = mount(priced);
    const yAxis = el.querySelector("canvas") as HTMLCanvasElement;
    expect(yAxis.style.width).not.toBe("");
    expect(yAxis.getContext("2d")).toBeNull();
  });

  it("scrolls to the first priced hour once the chart has a width", () => {
    const series: HistoryHourSeries = {
      hours: [...Array(24).keys()],
      brands: { neste: Array.from({ length: 24 }, (_, h) => (h === 8 ? 1.5 : null)) },
    };
    viewBox.w = 0;
    const { el } = mount(series);
    const scroll = el.querySelector(".history-chart-scroll") as HTMLElement;
    let left = 0;
    Object.defineProperty(scroll, "scrollLeft", {
      configurable: true,
      get: () => left,
      set: (value: number) => {
        left = value;
      },
    });
    chartMock.raf?.(0);
    expect(left).toBe(0);
    viewBox.w = 320;
    chartMock.observers.at(-1)?.([], {} as ResizeObserver);
    expect(left).toBe(historyChartScrollLeft(320, historyChartWidth(320, 24), 8));
    left = 0;
    chartMock.observers.at(-1)?.([], {} as ResizeObserver);
    expect(left).toBe(0);
  });

  it("updates the size when the viewport changes", () => {
    const series: HistoryHourSeries = {
      hours: [...Array(24).keys()],
      brands: { neste: Array.from({ length: 24 }, () => 1) },
    };
    viewBox.w = 800;
    viewBox.h = 0;
    const { fake } = mount(series);
    chartMock.raf?.(0);
    expect(fake?.setSize).not.toHaveBeenCalled();
    viewBox.h = 300;
    chartMock.observers.at(-1)?.([], {} as ResizeObserver);
    expect(fake?.setSize).toHaveBeenCalledWith({
      width: historyChartWidth(800, 24),
      height: 300,
    });
    viewBox.w = 900;
    const short = mount(priced);
    viewBox.w = 1100;
    chartMock.observers.at(-1)?.([], {} as ResizeObserver);
    expect(short.fake?.width).toBe(historyChartWidth(1100, priced.hours.length));
  });

  it("ignores a wheel that does not move the chart", () => {
    viewBox.w = 400;
    const { el } = mount(priced);
    const scroll = el.querySelector(".history-chart-scroll") as HTMLElement;
    let left = 0;
    let width = 400;
    Object.defineProperty(scroll, "scrollLeft", {
      configurable: true,
      get: () => left,
      set: (value: number) => {
        left = value;
      },
    });
    Object.defineProperty(scroll, "scrollWidth", { configurable: true, get: () => width });
    const still = new WheelEvent("wheel", { deltaX: 0, deltaY: 30, cancelable: true });
    scroll.dispatchEvent(still);
    expect(still.defaultPrevented).toBe(false);
    expect(left).toBe(0);
    const blocked = new WheelEvent("wheel", { deltaX: 20, cancelable: true });
    scroll.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(false);
    width = 1000;
    left = 600;
    const atMax = new WheelEvent("wheel", { deltaX: 40, cancelable: true });
    scroll.dispatchEvent(atMax);
    expect(atMax.defaultPrevented).toBe(false);
    expect(left).toBe(600);
  });

  it("scrolls the chart on a horizontal wheel", () => {
    viewBox.w = 400;
    const { el } = mount(priced);
    const scroll = el.querySelector(".history-chart-scroll") as HTMLElement;
    let left = 0;
    Object.defineProperty(scroll, "scrollLeft", {
      configurable: true,
      get: () => left,
      set: (value: number) => {
        left = value;
      },
    });
    Object.defineProperty(scroll, "scrollWidth", { configurable: true, get: () => 1000 });
    const ev = new WheelEvent("wheel", { deltaX: 40, cancelable: true });
    scroll.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(left).toBe(40);
  });

  it("hides a brand only when its visibility changes", () => {
    const { plot, fake } = mount(priced);
    plot!.setHidden(new Set());
    expect(fake?.setSeries).not.toHaveBeenCalled();
    plot!.setHidden(new Set(["neste"]));
    expect(fake?.setSeries).toHaveBeenCalledWith(1, { show: false });
    plot!.setHidden(new Set(["neste"]));
    expect(fake?.setSeries).toHaveBeenCalledTimes(1);
    plot!.setHidden(new Set());
    expect(fake?.setSeries).toHaveBeenCalledWith(1, { show: true });
  });

  it("removes the chart", () => {
    const { el, plot, fake } = mount(priced);
    plot!.destroy();
    expect(chartMock.cancel).toHaveBeenCalledWith(1);
    expect(chartMock.ros.at(-1)?.disconnect).toHaveBeenCalled();
    expect(fake?.destroy).toHaveBeenCalled();
    expect(el.childElementCount).toBe(0);
  });
});
