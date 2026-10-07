import { afterEach, describe, expect, it, vi } from "vitest";
import { detoursFromTable, fetchDetours } from "../src/routing.ts";

const start = { lat: 54.8987, lon: 23.9118 };
const end = { lat: 54.9045, lon: 23.9764 };

describe("detoursFromTable", () => {
  it("subtracts the direct trip from start → stop → end", () => {
    // Rows: start, stop 0, stop 1. Columns: stop 0, stop 1, end.
    const detours = detoursFromTable(
      {
        code: "Ok",
        distances: [
          [2100, 3000, 5500],
          [0, 0, 4200],
          [0, 0, 5900],
        ],
        durations: [
          [180, 270, 480],
          [0, 0, 330],
          [0, 0, 510],
        ],
      },
      2,
    );
    expect(detours?.[0]?.toKm).toBeCloseTo(2.1);
    expect(detours?.[0]?.extraKm).toBeCloseTo(0.8);
    expect(detours?.[0]?.extraMin).toBeCloseTo(0.5);
    expect(detours?.[1]?.toKm).toBeCloseTo(3);
    expect(detours?.[1]?.extraKm).toBeCloseTo(3.4);
    expect(detours?.[1]?.extraMin).toBeCloseTo(5);
  });

  it("marks an unreachable stop and never reports a negative detour", () => {
    const detours = detoursFromTable(
      {
        code: "Ok",
        distances: [
          [null, 2000, 5000],
          [0, 0, 4000],
          [0, 0, 2990],
        ],
        durations: [
          [null, 150, 400],
          [0, 0, 300],
          [0, 0, 249],
        ],
      },
      2,
    );
    expect(detours?.[0]).toBeNull();
    expect(detours?.[1]).toEqual({ toKm: 2, extraKm: 0, extraMin: 0 });
  });

  it("rejects an error or a table without distances", () => {
    expect(detoursFromTable({ code: "TooBig" }, 1)).toBeNull();
    expect(detoursFromTable({ code: "Ok", durations: [[1, 2]] }, 1)).toBeNull();
  });
});

describe("fetchDetours", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function tableFor(url: string): object {
    const n = new URL(url).searchParams.get("sources")!.split(";").length - 1;
    const row = (v: number) => Array.from({ length: n + 1 }, () => v);
    return {
      code: "Ok",
      distances: [row(1000), ...Array.from({ length: n }, () => row(1500))],
      durations: [row(60), ...Array.from({ length: n }, () => row(90))],
    };
  }

  it("asks for each stop on the driver's side, 50 stops per request", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify(tableFor(url)));
      }),
    );
    const stops = Array.from({ length: 51 }, (_, i) => ({ lat: 54.9, lon: 23.9 + i / 1000 }));
    const detours = await fetchDetours(start, end, stops);
    expect(detours).toHaveLength(51);
    expect(detours?.[50]).toEqual({ toKm: 1, extraKm: 1.5, extraMin: 1.5 });
    expect(urls).toHaveLength(2);
    const first = new URL(urls[0]);
    expect(first.pathname).toMatch(/^\/table\/v1\/driving\/23\.9118,54\.8987;/);
    expect(first.searchParams.get("sources")?.split(";")).toHaveLength(51);
    expect(first.searchParams.get("destinations")?.split(";")[0]).toBe("1");
    expect(first.searchParams.get("annotations")).toBe("duration,distance");
    const approaches = first.searchParams.get("approaches")?.split(";");
    expect(approaches).toHaveLength(52);
    expect(approaches?.[0]).toBe("unrestricted");
    expect(approaches?.[1]).toBe("curb");
    expect(approaches?.[51]).toBe("unrestricted");
    expect(new URL(urls[1]).searchParams.get("sources")).toBe("0;1");
  });

  it("returns null when the router fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429 })),
    );
    expect(await fetchDetours(start, end, [{ lat: 54.9, lon: 23.95 }])).toBeNull();
  });

  it("skips the request without stops", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchDetours(start, end, [])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
