import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotPoint } from "../scripts/adapters/nordpool.ts";
import type { SourceContext } from "../scripts/sources.ts";
import type { DailyPrices, Observation, Station } from "../src/types.ts";

const mocks = vi.hoisted(() => ({
  fetchOsmStations: vi.fn(),
  fetchOsmChargers: vi.fn(),
  fetchRegister: vi.fn(),
  fetchSpot: vi.fn(),
  runProviders: vi.fn(),
  geocodePhoton: vi.fn(),
  sleep: vi.fn(async () => undefined),
}));

vi.mock("../scripts/osm.ts", async () => {
  const actual = await vi.importActual<typeof import("../scripts/osm.ts")>("../scripts/osm.ts");
  return {
    ...actual,
    fetchOsmStations: mocks.fetchOsmStations,
    fetchOsmChargers: mocks.fetchOsmChargers,
  };
});

vi.mock("../scripts/adapters/via-lietuva.ts", async () => {
  const actual = await vi.importActual<typeof import("../scripts/adapters/via-lietuva.ts")>(
    "../scripts/adapters/via-lietuva.ts",
  );
  return { ...actual, fetchRegister: mocks.fetchRegister };
});

vi.mock("../scripts/adapters/nordpool.ts", async () => {
  const actual = await vi.importActual<typeof import("../scripts/adapters/nordpool.ts")>(
    "../scripts/adapters/nordpool.ts",
  );
  return { ...actual, fetchSpot: mocks.fetchSpot };
});

vi.mock("../scripts/sources.ts", async () => {
  const actual =
    await vi.importActual<typeof import("../scripts/sources.ts")>("../scripts/sources.ts");
  return { ...actual, runProviders: mocks.runProviders };
});

vi.mock("../scripts/geocode.ts", async () => {
  const actual =
    await vi.importActual<typeof import("../scripts/geocode.ts")>("../scripts/geocode.ts");
  return { ...actual, geocodePhoton: mocks.geocodePhoton, sleep: mocks.sleep };
});

import {
  cliMain,
  enrichCoords,
  latestPriceDate,
  loadOsm,
  loadOsmChargers,
  loadRegister,
  loadSpot,
  logRanking,
  logRun,
  main,
  pipelineRoot,
  readJson,
  todayVilnius,
  writeJson,
} from "../scripts/pipeline.ts";

const roots: string[] = [];
const actions = process.env.GITHUB_ACTIONS;

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "pipeline-"));
  roots.push(dir);
  return dir;
}

function station(id: string, over: Partial<Station> = {}): Station {
  return {
    id,
    name: id,
    brand: "circle-k",
    lat: 54.7,
    lon: 25.3,
    fuels: ["D"],
    sourceIds: {},
    ...over,
  };
}

function osmStations(): Station[] {
  const rows = Array.from({ length: 500 }, (_, i) => station(`osm:${i}`));
  rows[0] = station("osm:0", {
    name: "Circle K",
    address: "Oslo g. 12",
    city: "Vilnius",
  });
  return rows;
}

function evChargers(count = 100): Station[] {
  return Array.from({ length: count }, (_, i) =>
    station(`ev:${i}`, { fuels: ["EV"], brand: "ionity" }),
  );
}

function obs(id: string, over: Partial<Observation> = {}): Observation {
  return {
    sourceStationId: id,
    brand: "circle-k",
    fuel: "D",
    price: 1.5,
    observedAt: "2026-10-08T08:00:00.000Z",
    source: "circle-k",
    lat: 54.7,
    lon: 25.3,
    ...over,
  };
}

function providers(rows: Observation[], fill?: (ctx: SourceContext) => void): void {
  mocks.runProviders.mockImplementation(async (ctx: SourceContext) => {
    fill?.(ctx);
    return {
      byProvider: rows.length ? { "circle-k": rows } : {},
      runs: rows.length
        ? [
            {
              name: "circle-k",
              at: "2026-10-10T00:00:00.000Z",
              ok: true,
              rows: rows.length,
              ms: 4,
              newestObservedAt: "2026-10-08T08:00:00.000Z",
            },
          ]
        : [],
    };
  });
}

async function withArgv(args: string[], run: () => Promise<void>): Promise<void> {
  const prev = process.argv;
  process.argv = ["node", "pipeline.ts", ...args];
  try {
    await run();
  } finally {
    process.argv = prev;
  }
}

function read(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

beforeEach(() => {
  mocks.fetchOsmStations.mockReset();
  mocks.fetchOsmStations.mockResolvedValue(osmStations());
  mocks.fetchOsmChargers.mockReset();
  mocks.fetchOsmChargers.mockResolvedValue(evChargers());
  mocks.fetchRegister.mockReset();
  mocks.fetchRegister.mockResolvedValue({ reportUrl: "https://ev.example/r", chargers: [] });
  mocks.fetchSpot.mockReset();
  mocks.fetchSpot.mockResolvedValue([{ at: "2026-10-10T10:00:00.000Z", price: 0.12 }]);
  mocks.geocodePhoton.mockReset();
  mocks.geocodePhoton.mockResolvedValue(null);
  providers([]);
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.PIPELINE_ROOT;
  if (actions === undefined) delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS = actions;
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
  roots.length = 0;
});

describe("pipelineRoot", () => {
  it("uses the checkout when PIPELINE_ROOT is unset", () => {
    delete process.env.PIPELINE_ROOT;
    expect(pipelineRoot()).toBe(join(import.meta.dirname, ".."));
  });

  it("uses PIPELINE_ROOT when it is set", () => {
    process.env.PIPELINE_ROOT = "/tmp/pipeline-root";
    expect(pipelineRoot()).toBe("/tmp/pipeline-root");
  });
});

describe("todayVilnius", () => {
  it("formats the Vilnius calendar day", () => {
    expect(todayVilnius()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("readJson", () => {
  it("returns the fallback when the file is missing", () => {
    expect(readJson(join(tempRoot(), "missing.json"), [])).toEqual([]);
  });

  it("parses a file that exists", () => {
    const path = join(tempRoot(), "n.json");
    writeJson(path, { n: 1 });
    expect(readJson(path, {})).toEqual({ n: 1 });
  });
});

describe("writeJson", () => {
  it("pretty-prints a file that is not a daily price", () => {
    const path = join(tempRoot(), "meta.json");
    writeJson(path, { n: 1 });
    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify({ n: 1 }, null, 2)}\n`);
  });

  it("writes a daily price file on one line", () => {
    const path = join(tempRoot(), "prices", "2026-10-01.json");
    writeJson(path, { n: 1 });
    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify({ n: 1 })}\n`);
  });
});

describe("latestPriceDate", () => {
  it("returns null when the prices directory is missing", () => {
    expect(latestPriceDate(tempRoot())).toBeNull();
  });

  it("returns null when the directory has no price files", () => {
    const root = tempRoot();
    mkdirSync(join(root, "data", "prices"), { recursive: true });
    expect(latestPriceDate(root)).toBeNull();
  });

  it("returns the newest price date and ignores other files", () => {
    const root = tempRoot();
    writeJson(join(root, "data", "prices", "2026-10-01.json"), {});
    writeJson(join(root, "data", "prices", "2026-10-03.json"), {});
    writeJson(join(root, "data", "prices", "notes.json"), {});
    expect(latestPriceDate(root)).toBe("2026-10-03");
  });
});

describe("enrichCoords", () => {
  it("keeps observations that already have coordinates", async () => {
    const rows = await enrichCoords(
      [obs("a", { lat: 1, lon: 2 }), obs("a", { lat: 1, lon: 2, fuel: "95", price: 1.4 })],
      tempRoot(),
    );
    expect(rows).toHaveLength(2);
    expect(mocks.geocodePhoton).not.toHaveBeenCalled();
  });

  it("copies a cached hit onto every row of the station", async () => {
    const root = tempRoot();
    const key = "Gedimino pr. 1, Vilnius, Lietuva";
    writeJson(join(root, "data", "cache", "geocode.json"), {
      [key]: { lat: 54.68, lon: 25.28, label: "Gedimino" },
    });
    const rows = await enrichCoords(
      [
        obs("lea:1", {
          lat: undefined,
          lon: undefined,
          address: "Gedimino pr. 1",
          city: "Vilnius",
        }),
        obs("lea:1", {
          lat: undefined,
          lon: undefined,
          address: "Gedimino pr. 1",
          city: "Vilnius",
          fuel: "95",
          price: 1.4,
        }),
      ],
      root,
    );
    expect(rows.map((row) => row.lat)).toEqual([54.68, 54.68]);
    expect(mocks.geocodePhoton).not.toHaveBeenCalled();
  });

  it("leaves rows unchanged when the cache remembers a miss", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "cache", "geocode.json"), { Lietuva: null });
    const rows = await enrichCoords([obs("lea:1", { lat: undefined, lon: undefined })], root);
    expect(rows[0].lat).toBeUndefined();
    expect(mocks.geocodePhoton).not.toHaveBeenCalled();
  });

  it("does not ask Photon for a query that is only the country", async () => {
    const rows = await enrichCoords(
      [obs("lea:1", { lat: undefined, lon: undefined, address: undefined, city: undefined })],
      tempRoot(),
    );
    expect(rows[0].lat).toBeUndefined();
    expect(mocks.geocodePhoton).not.toHaveBeenCalled();
  });

  it("stores a Photon hit", async () => {
    mocks.geocodePhoton.mockResolvedValue({ lat: 55, lon: 24, label: "Kaunas" });
    const rows = await enrichCoords(
      [
        obs("lea:1", {
          lat: undefined,
          lon: undefined,
          address: "Savanoriu pr. 1",
          city: "Kaunas",
        }),
      ],
      tempRoot(),
    );
    expect(rows[0]).toMatchObject({ lat: 55, lon: 24 });
  });

  it("keeps the row when Photon throws", async () => {
    mocks.geocodePhoton.mockRejectedValue(new Error("down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rows = await enrichCoords(
      [
        obs("lea:1", {
          lat: undefined,
          lon: undefined,
          address: "Savanoriu pr. 1",
          city: "Kaunas",
        }),
      ],
      tempRoot(),
    );
    expect(rows[0].lat).toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("stops looking up once 400 new addresses are cached", async () => {
    const pending = Array.from({ length: 401 }, (_, i) =>
      obs(`lea:${i}`, {
        lat: undefined,
        lon: undefined,
        address: `Street ${i} very long`,
        city: "Vilnius",
      }),
    );
    await enrichCoords(pending, tempRoot());
    expect(mocks.geocodePhoton).toHaveBeenCalledTimes(400);
  });
});

describe("loadOsm", () => {
  it("reuses cached stations on a weekday", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "stations.json"), [station("osm:1"), station("other:1")]);
    const got = await loadOsm(false, root);
    expect(got.map((s) => s.id)).toEqual(["osm:1"]);
    expect(mocks.fetchOsmStations).not.toHaveBeenCalled();
  });

  it("fetches when the cache is empty", async () => {
    const got = await loadOsm(false, tempRoot());
    expect(got).toHaveLength(500);
  });

  it("fetches when forced even if a cache exists", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "stations.json"), [station("osm:1")]);
    const got = await loadOsm(true, root);
    expect(got).toHaveLength(500);
  });

  it("fetches on Sunday", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    const root = tempRoot();
    writeJson(join(root, "data", "stations.json"), [station("osm:1")]);
    const got = await loadOsm(false, root);
    expect(got).toHaveLength(500);
  });

  it("keeps the cache when the fetch returns too few stations", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "stations.json"), [station("osm:1")]);
    mocks.fetchOsmStations.mockResolvedValue([]);
    const got = await loadOsm(true, root);
    expect(got.map((s) => s.id)).toEqual(["osm:1"]);
  });

  it("keeps the cache when the fetch throws", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "stations.json"), [station("osm:9")]);
    mocks.fetchOsmStations.mockRejectedValue(new Error("down"));
    const got = await loadOsm(true, root);
    expect(got.map((s) => s.id)).toEqual(["osm:9"]);
  });

  it("throws when the fetch fails and there is no cache", async () => {
    mocks.fetchOsmStations.mockRejectedValue(new Error("down"));
    await expect(loadOsm(true, tempRoot())).rejects.toThrow("down");
  });
});

describe("loadOsmChargers", () => {
  it("reuses a charger cache on a weekday", async () => {
    const root = tempRoot();
    const path = join(root, "data", "cache", "osm-chargers.json");
    writeJson(path, [station("ev:1")]);
    const before = readFileSync(path, "utf8");
    const got = await loadOsmChargers(false, root);
    expect(got.map((s) => s.id)).toEqual(["ev:1"]);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(mocks.fetchOsmChargers).not.toHaveBeenCalled();
  });

  it("copies chargers.json into the cache the first time", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "chargers.json"), [station("ev:2"), station("osm:2")]);
    const got = await loadOsmChargers(false, root);
    expect(got.map((s) => s.id)).toEqual(["ev:2"]);
    expect(existsSync(join(root, "data", "cache", "osm-chargers.json"))).toBe(true);
  });

  it("fetches when forced", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "cache", "osm-chargers.json"), [station("ev:1")]);
    const got = await loadOsmChargers(true, root);
    expect(got).toHaveLength(100);
  });

  it("fetches on Sunday", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
    const root = tempRoot();
    writeJson(join(root, "data", "cache", "osm-chargers.json"), [station("ev:1")]);
    const got = await loadOsmChargers(false, root);
    expect(got).toHaveLength(100);
  });

  it("fetches when nothing is cached", async () => {
    const got = await loadOsmChargers(false, tempRoot());
    expect(got).toHaveLength(100);
  });

  it("writes the fetched chargers", async () => {
    const root = tempRoot();
    await loadOsmChargers(true, root);
    const saved = read(join(root, "data", "cache", "osm-chargers.json")) as Station[];
    expect(saved).toHaveLength(100);
  });

  it("writes the old chargers when the fetch fails and the cache file is missing", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "chargers.json"), [station("ev:3")]);
    mocks.fetchOsmChargers.mockRejectedValue(new Error("down"));
    const got = await loadOsmChargers(true, root);
    expect(got.map((s) => s.id)).toEqual(["ev:3"]);
    expect(existsSync(join(root, "data", "cache", "osm-chargers.json"))).toBe(true);
  });

  it("keeps an existing cache file when the fetch fails", async () => {
    const root = tempRoot();
    const path = join(root, "data", "cache", "osm-chargers.json");
    writeJson(path, [station("ev:4")]);
    const before = readFileSync(path, "utf8");
    mocks.fetchOsmChargers.mockRejectedValue(new Error("down"));
    const got = await loadOsmChargers(true, root);
    expect(got.map((s) => s.id)).toEqual(["ev:4"]);
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("returns nothing when the fetch fails and no chargers were cached", async () => {
    mocks.fetchOsmChargers.mockRejectedValue(new Error("down"));
    await expect(loadOsmChargers(true, tempRoot())).resolves.toEqual([]);
  });

  it("warns GitHub Actions when the charger fetch fails", async () => {
    process.env.GITHUB_ACTIONS = "true";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.fetchOsmChargers.mockRejectedValue(new Error("down"));
    await loadOsmChargers(true, tempRoot());
    expect(log.mock.calls.some((call) => String(call[0]).includes("::warning::OSM chargers"))).toBe(
      true,
    );
  });

  it("does not warn outside GitHub Actions", async () => {
    delete process.env.GITHUB_ACTIONS;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.fetchOsmChargers.mockRejectedValue(new Error("down"));
    await loadOsmChargers(true, tempRoot());
    expect(log.mock.calls.some((call) => String(call[0]).includes("::warning::"))).toBe(false);
  });
});

describe("loadRegister", () => {
  it("stores a downloaded register", async () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const chargers = [station("vl:1")];
    mocks.fetchRegister.mockResolvedValue({ reportUrl: "https://ev.example/r", chargers });
    const root = tempRoot();
    const got = await loadRegister(now, root);
    expect(got).toEqual(chargers);
    expect(read(join(root, "data", "cache", "via-lietuva.json"))).toMatchObject({
      fetchedAt: now.toISOString(),
      reportUrl: "https://ev.example/r",
    });
  });

  it("uses a recent cache when the download fails", async () => {
    const now = new Date("2026-10-10T12:00:00Z");
    const root = tempRoot();
    writeJson(join(root, "data", "cache", "via-lietuva.json"), {
      fetchedAt: now.toISOString(),
      reportUrl: "https://ev.example/old",
      chargers: [station("vl:9")],
    });
    mocks.fetchRegister.mockRejectedValue(new Error("down"));
    const got = await loadRegister(now, root);
    expect(got.map((s) => s.id)).toEqual(["vl:9"]);
  });

  it("returns nothing when the download fails and no cache is usable", async () => {
    mocks.fetchRegister.mockRejectedValue(new Error("down"));
    await expect(loadRegister(new Date(), tempRoot())).resolves.toEqual([]);
  });

  it("warns GitHub Actions when the register download fails", async () => {
    process.env.GITHUB_ACTIONS = "true";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.fetchRegister.mockRejectedValue(new Error("down"));
    await loadRegister(new Date(), tempRoot());
    expect(log.mock.calls.some((call) => String(call[0]).includes("::warning::Via Lietuva"))).toBe(
      true,
    );
  });

  it("does not warn outside GitHub Actions", async () => {
    delete process.env.GITHUB_ACTIONS;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.fetchRegister.mockRejectedValue(new Error("down"));
    await loadRegister(new Date(), tempRoot());
    expect(log.mock.calls.some((call) => String(call[0]).includes("::warning::"))).toBe(false);
  });
});

describe("loadSpot", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const point: SpotPoint = { at: "2026-10-10T10:00:00.000Z", price: 0.2 };

  it("merges a fresh fetch into the cache", async () => {
    mocks.fetchSpot.mockResolvedValue([point]);
    const root = tempRoot();
    const got = await loadSpot(now, root);
    expect(got.fetchedAt).toBe(now.toISOString());
    expect(got.points).toEqual([point]);
  });

  it("merges a fresh fetch with hours already cached", async () => {
    const root = tempRoot();
    const older: SpotPoint = { at: "2026-10-09T10:00:00.000Z", price: 0.1 };
    writeJson(join(root, "data", "cache", "spot.json"), {
      fetchedAt: "2026-10-09T12:00:00.000Z",
      points: [older],
    });
    mocks.fetchSpot.mockResolvedValue([point]);
    const got = await loadSpot(now, root);
    expect(got.points).toEqual([older, point]);
  });

  it("keeps cached hours when the fetch fails", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "cache", "spot.json"), {
      fetchedAt: "2026-10-10T09:00:00.000Z",
      points: [point],
    });
    mocks.fetchSpot.mockRejectedValue(new Error("down"));
    const got = await loadSpot(now, root);
    expect(got.points).toEqual([point]);
    expect(got.fetchedAt).toBe("2026-10-10T09:00:00.000Z");
  });

  it("returns no timestamp when the fetch fails and nothing was cached", async () => {
    mocks.fetchSpot.mockRejectedValue(new Error("down"));
    const got = await loadSpot(now, tempRoot());
    expect(got.points).toEqual([]);
    expect(got.fetchedAt).toBeUndefined();
  });

  it("warns GitHub Actions when the spot fetch fails", async () => {
    process.env.GITHUB_ACTIONS = "true";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.fetchSpot.mockRejectedValue(new Error("down"));
    await loadSpot(now, tempRoot());
    expect(log.mock.calls.some((call) => String(call[0]).includes("::warning::Spot price"))).toBe(
      true,
    );
  });

  it("does not warn outside GitHub Actions", async () => {
    delete process.env.GITHUB_ACTIONS;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.fetchSpot.mockRejectedValue(new Error("down"));
    await loadSpot(now, tempRoot());
    expect(log.mock.calls.some((call) => String(call[0]).includes("::warning::"))).toBe(false);
  });
});

describe("logRun", () => {
  it("logs a successful run and its newest observation", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logRun({
      name: "circle-k",
      at: "t",
      ok: true,
      rows: 3,
      ms: 9,
      newestObservedAt: "2026-10-10T08:00:00.000Z",
    });
    expect(log).toHaveBeenCalledWith("  circle-k: 3 rows in 9 ms, newest 2026-10-10T08:00:00.000Z");
  });

  it("logs a successful run without a newest observation", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logRun({ name: "circle-k", at: "t", ok: true, rows: 0, ms: 2 });
    expect(log).toHaveBeenCalledWith("  circle-k: 0 rows in 2 ms");
  });

  it("logs a failed run", () => {
    delete process.env.GITHUB_ACTIONS;
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logRun({ name: "lea", at: "t", ok: false, rows: 0, ms: 5, error: "down" });
    expect(error).toHaveBeenCalledWith("  lea failed after 5 ms: down");
    expect(log).not.toHaveBeenCalled();
  });

  it("warns GitHub Actions when a source fails", () => {
    process.env.GITHUB_ACTIONS = "true";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logRun({ name: "lea", at: "t", ok: false, rows: 0, ms: 5, error: "down" });
    expect(log).toHaveBeenCalledWith("::warning::Source lea failed: down");
  });
});

describe("logRanking", () => {
  it("logs an ok run beside the prices it supplied", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logRanking(
      [{ name: "circle-k", score: 0.9, seedScore: 0.5, runs: 4 }],
      [{ name: "circle-k", score: 0.9, ok: true, rows: 2, chosen: 1 }],
      [{ name: "circle-k", at: "t", ok: true, rows: 2, ms: 1 }],
    );
    expect(log.mock.calls.map((call) => call[0]).join("\n")).toContain("this run ok");
    expect(log.mock.calls.map((call) => call[0]).join("\n")).toContain("chosen 1");
  });

  it("logs a failed run and a source that did not run", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logRanking(
      [
        { name: "lea", score: 0.4, seedScore: 0.5, runs: 2 },
        { name: "circle-k", score: 0.2, seedScore: 0.5, runs: 1 },
      ],
      [],
      [{ name: "lea", at: "t", ok: false, rows: 0, ms: 1, error: "down" }],
    );
    const text = log.mock.calls.map((call) => call[0]).join("\n");
    expect(text).toContain("this run failed");
    expect(text).toContain("chosen 0");
  });
});

describe("main", () => {
  it("writes stations and stops when only OSM was requested", async () => {
    const root = tempRoot();
    await withArgv(["--osm-only", "--osm"], () => main(root));
    expect(read(join(root, "data", "stations.json"))).toHaveLength(500);
    expect(mocks.runProviders).not.toHaveBeenCalled();
  });

  it("writes empty overrides and a snapshot when nothing was observed", async () => {
    mocks.fetchSpot.mockRejectedValue(new Error("down"));
    const root = tempRoot();
    await withArgv([], () => main(root));
    expect(read(join(root, "data", "overrides", "stations.json"))).toEqual([]);
    const meta = read(join(root, "data", "meta.json")) as {
      spotUpdatedAt?: string;
      observedAt?: string;
    };
    expect(meta.spotUpdatedAt).toBeUndefined();
    expect(meta.observedAt).toBeUndefined();
  });

  it("prices a station that already has coordinates", async () => {
    providers([
      obs("osm:0", { lat: undefined, lon: undefined }),
      obs("osm:0", { fuel: "95", price: 1.4 }),
    ]);
    const root = tempRoot();
    await withArgv([], () => main(root));
    const daily = read(join(root, "data", "prices", `${todayVilnius()}.json`)) as DailyPrices;
    expect(daily.prices["osm:0"]?.D?.price).toBe(1.5);
    expect(mocks.geocodePhoton).not.toHaveBeenCalled();
  });

  it("prices a station found by its address", async () => {
    providers([
      obs("lea:oslo", {
        lat: undefined,
        lon: undefined,
        brand: "Circle K",
        address: "Oslo g. 12",
        city: "Vilnius",
      }),
    ]);
    const root = tempRoot();
    await withArgv([], () => main(root));
    const daily = read(join(root, "data", "prices", `${todayVilnius()}.json`)) as DailyPrices;
    expect(daily.prices["osm:0"]?.D?.price).toBe(1.5);
    expect(mocks.geocodePhoton).not.toHaveBeenCalled();
  });

  it("geocodes a station the address match misses", async () => {
    mocks.geocodePhoton.mockResolvedValue({ lat: 55.1, lon: 21.1, label: "Taikos" });
    providers([
      obs("lea:far", {
        lat: undefined,
        lon: undefined,
        address: "Taikos pr. 1",
        city: "Klaipeda",
      }),
    ]);
    const root = tempRoot();
    await withArgv([], () => main(root));
    const stations = read(join(root, "data", "stations.json")) as Station[];
    expect(stations.some((s) => s.id === "lea:far" && s.lat === 55.1)).toBe(true);
  });

  it("builds the snapshot for --date", async () => {
    const root = tempRoot();
    await withArgv(["--date", "2026-10-01"], () => main(root));
    expect(existsSync(join(root, "data", "prices", "2026-10-01.json"))).toBe(true);
  });

  it("leaves override files that already exist", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "overrides", "stations.json"), [{ keep: true }]);
    writeJson(join(root, "data", "overrides", "prices.json"), [{ keep: true }]);
    writeJson(join(root, "data", "overrides", "ev-tariffs.json"), [{ keep: true }]);
    await withArgv([], () => main(root));
    expect(read(join(root, "data", "overrides", "stations.json"))).toEqual([{ keep: true }]);
  });

  it("reads the previous price file and drops one older than the window", async () => {
    const root = tempRoot();
    const previous: DailyPrices = {
      date: "2020-01-01",
      generatedAt: "2020-01-01T00:00:00.000Z",
      prices: {},
    };
    writeJson(join(root, "data", "prices", "2020-01-01.json"), previous);
    await withArgv(["--date", "2026-10-08"], () => main(root));
    expect(existsSync(join(root, "data", "prices", "2020-01-01.json"))).toBe(false);
    expect(existsSync(join(root, "data", "prices", "2026-10-08.json"))).toBe(true);
  });

  it("keeps computing from a history file", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "history.json"), {
      generatedAt: "2026-10-09T00:00:00.000Z",
      keepDays: 7,
      samples: [],
      byFuel: {},
    });
    await withArgv([], () => main(root));
    expect(existsSync(join(root, "data", "history.json"))).toBe(true);
  });

  it("ignores a history file that is not one", async () => {
    const root = tempRoot();
    writeJson(join(root, "data", "history.json"), { nope: true });
    await withArgv([], () => main(root));
    const history = read(join(root, "data", "history.json")) as { byFuel?: unknown };
    expect(history.byFuel).toBeTypeOf("object");
  });

  it("records when the spot price was fetched", async () => {
    const root = tempRoot();
    await withArgv([], () => main(root));
    const meta = read(join(root, "data", "meta.json")) as { spotUpdatedAt?: string };
    expect(meta.spotUpdatedAt).toEqual(expect.any(String));
  });

  it("logs workbook days without backfilling when the flag is off", async () => {
    providers([], (ctx) => {
      ctx.leaByDate.set("2026-10-07", [obs("osm:0")]);
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const root = tempRoot();
    await withArgv(["--date", "2026-10-08"], () => main(root));
    expect(log.mock.calls.some((call) => String(call[0]).includes("days in LEA workbook"))).toBe(
      true,
    );
    expect(existsSync(join(root, "data", "prices", "2026-10-07.json"))).toBe(false);
  });

  it("does not backfill when the workbook has no other day", async () => {
    providers([], (ctx) => {
      ctx.leaByDate.set("2026-10-08", [obs("osm:0")]);
    });
    const root = tempRoot();
    await withArgv(["--date", "2026-10-08", "--backfill"], () => main(root));
    expect(existsSync(join(root, "data", "prices", "2026-10-07.json"))).toBe(false);
  });

  it("does not backfill when no source row was matched", async () => {
    providers(
      [obs("lea:nowhere", { lat: undefined, lon: undefined, address: "Nope", city: "Nowhere" })],
      (ctx) => {
        ctx.leaByDate.set("2026-10-07", [obs("osm:0")]);
      },
    );
    const root = tempRoot();
    await withArgv(["--date", "2026-10-08", "--backfill"], () => main(root));
    expect(existsSync(join(root, "data", "prices", "2026-10-07.json"))).toBe(false);
  });

  it("backfills another workbook day and skips a row with no station", async () => {
    providers([obs("osm:0")], (ctx) => {
      ctx.leaByDate.set("2026-10-07", [
        obs("osm:0"),
        obs("lea:missing", { lat: undefined, lon: undefined }),
      ]);
    });
    const root = tempRoot();
    await withArgv(["--date", "2026-10-08", "--backfill"], () => main(root));
    const daily = read(join(root, "data", "prices", "2026-10-07.json")) as DailyPrices;
    expect(Object.keys(daily.prices)).toEqual(["osm:0"]);
  });
});

describe("cliMain", () => {
  it("runs the pipeline in PIPELINE_ROOT", async () => {
    const root = tempRoot();
    process.env.PIPELINE_ROOT = root;
    const prev = process.argv;
    process.argv = ["node", "pipeline.ts", "--osm-only"];
    try {
      await cliMain();
    } finally {
      process.argv = prev;
    }
    expect(existsSync(join(root, "data", "stations.json"))).toBe(true);
  });
});
