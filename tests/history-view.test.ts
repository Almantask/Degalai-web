import { describe, expect, it } from "vitest";
import {
  filterHistory,
  historyRangeStart,
  historySeries,
  latestHistoryPoint,
} from "../src/history-view.ts";
import type { HistoryPoint } from "../src/types.ts";

function point(date: string, min = 1.5, median = 1.6): HistoryPoint {
  return {
    date,
    byFuel: { D: { min, median, max: 1.8, minStationId: "s1", byBrand: {} } },
  };
}

describe("historyRangeStart", () => {
  const now = new Date("2026-09-14T12:00:00Z");

  it("returns null for the all-time range", () => {
    expect(historyRangeStart("all", now)).toBeNull();
  });

  it("steps back one, three, and twelve months", () => {
    expect(historyRangeStart("1m", now)).toBe("2026-08-14");
    expect(historyRangeStart("3m", now)).toBe("2026-06-14");
    expect(historyRangeStart("1y", now)).toBe("2025-09-14");
  });
});

describe("filterHistory", () => {
  const points = [point("2026-01-01"), point("2026-08-20"), point("2026-09-10")];

  it("keeps only points on or after the range start", () => {
    expect(
      filterHistory(points, "1m", new Date("2026-09-14T12:00:00Z")).map((p) => p.date),
    ).toEqual(["2026-08-20", "2026-09-10"]);
  });

  it("keeps every point for all-time", () => {
    expect(filterHistory(points, "all")).toEqual(points);
  });
});

describe("historySeries", () => {
  it("skips days without the selected fuel", () => {
    const points: HistoryPoint[] = [
      point("2026-09-01"),
      {
        date: "2026-09-02",
        byFuel: { "95": { min: 1.2, median: 1.3, max: 1.4, minStationId: "x", byBrand: {} } },
      },
      point("2026-09-03", 1.4, 1.5),
    ];
    const [xs, mins, meds] = historySeries(points, "D");
    expect(xs).toHaveLength(2);
    expect(mins).toEqual([1.5, 1.4]);
    expect(meds).toEqual([1.6, 1.5]);
  });
});

describe("latestHistoryPoint", () => {
  it("returns the newest day that has the fuel", () => {
    const points = [point("2026-09-01"), { date: "2026-09-02", byFuel: {} }, point("2026-09-03")];
    expect(latestHistoryPoint(points, "D")?.date).toBe("2026-09-03");
  });
});
