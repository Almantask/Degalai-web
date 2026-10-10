import { createFileCoverage } from "istanbul-lib-coverage";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mem = vi.hoisted(() => {
  const store = new Map<string, string>();
  const dirs = new Set<string>();
  const writeFileSync = vi.fn((path: string, data: string) => {
    store.set(String(path), String(data));
  });
  return {
    store,
    dirs,
    writeFileSync,
    mkdirSync: vi.fn((path: string) => {
      dirs.add(String(path));
    }),
    readFileSync: vi.fn((path: string) => {
      const value = store.get(String(path));
      if (value === undefined) {
        const error = new Error(`ENOENT ${path}`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return value;
    }),
    readdirSync: vi.fn((path: string) => {
      const dir = String(path).replace(/\/$/, "");
      const prefix = `${dir}/`;
      const known = dirs.has(dir) || [...store.keys()].some((key) => key.startsWith(prefix));
      if (!known) {
        const error = new Error(`ENOENT ${path}`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      const names = new Set<string>();
      for (const key of store.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest.includes("/")) names.add(rest);
      }
      return [...names];
    }),
  };
});

vi.mock("node:fs", () => ({
  mkdirSync: (path: string) => mem.mkdirSync(path),
  readFileSync: (path: string) => mem.readFileSync(path),
  writeFileSync: (path: string, data: string) => mem.writeFileSync(path, data),
  readdirSync: (path: string) => mem.readdirSync(path),
}));

import { coverageInstrumentPlugin } from "../scripts/coverage-instrument.ts";
import {
  E2E_RAW_DIR,
  E2E_SUMMARY,
  summarizeCoverage,
  writeE2eCoverageSummary,
} from "../scripts/e2e-coverage.ts";
import { publishArgvBadge, publishCoverageBadge } from "../scripts/publish-coverage-badge.ts";

function summary(pct: number): string {
  return JSON.stringify({ total: { lines: { pct } } });
}

function fileCoverage(path: string, hits: number[]) {
  const statementMap: Record<
    string,
    { start: { line: number; column: number }; end: { line: number; column: number } }
  > = {};
  const s: Record<string, number> = {};
  hits.forEach((hit, index) => {
    const id = String(index);
    statementMap[id] = {
      start: { line: index + 1, column: 0 },
      end: { line: index + 1, column: 1 },
    };
    s[id] = hit;
  });
  return createFileCoverage({ path, statementMap, fnMap: {}, branchMap: {}, s, f: {}, b: {} });
}

afterEach(() => {
  mem.store.clear();
  mem.dirs.clear();
  mem.writeFileSync.mockClear();
  vi.restoreAllMocks();
  delete process.env.CI;
});

describe("publishCoverageBadge", () => {
  it("writes the unit badge", () => {
    mem.store.set("coverage/unit/coverage-summary.json", summary(91.2));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    publishCoverageBadge("unit");
    expect(JSON.parse(mem.store.get("coverage/unit.json") ?? "")).toMatchObject({
      message: "91.2%",
      label: "unit coverage",
    });
    expect(log).toHaveBeenCalledWith("unit coverage: 91.2%");
  });

  it("writes the e2e badge", () => {
    mem.store.set("coverage/e2e/coverage-summary.json", summary(80));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    publishCoverageBadge("e2e");
    expect(JSON.parse(mem.store.get("coverage/e2e.json") ?? "")).toMatchObject({
      message: "80%",
      label: "e2e coverage",
    });
    expect(log).toHaveBeenCalledWith("e2e coverage: 80%");
  });

  it("exits when the kind is neither unit nor e2e", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit ${code}`);
    });
    expect(() => publishCoverageBadge("usage")).toThrow(/exit 1/);
    expect(error).toHaveBeenCalledWith("usage: publish-coverage-badge.ts unit|e2e");
  });

  it("publishes the kind it is given", () => {
    mem.store.set("coverage/unit/coverage-summary.json", summary(91));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    publishArgvBadge("unit");
    expect(mem.store.has("coverage/unit.json")).toBe(true);
  });

  it("reads the kind from argv", () => {
    const prev = process.argv;
    process.argv = ["node", "publish-coverage-badge.ts", "e2e"];
    mem.store.set("coverage/e2e/coverage-summary.json", summary(80));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      publishArgvBadge();
    } finally {
      process.argv = prev;
    }
    expect(JSON.parse(mem.store.get("coverage/e2e.json") ?? "").label).toBe("e2e coverage");
  });

  it("rejects an argv that names no kind", () => {
    const prev = process.argv;
    process.argv = ["node", "publish-coverage-badge.ts"];
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit ${code}`);
    });
    try {
      expect(() => publishArgvBadge()).toThrow(/exit 1/);
    } finally {
      process.argv = prev;
    }
  });
});

describe("summarizeCoverage", () => {
  it("throws when the map has no src lines", () => {
    expect(() => summarizeCoverage({})).toThrow(/did not include any src file/);
  });
});

describe("writeE2eCoverageSummary", () => {
  const src = resolve("src/a.ts");
  const other = resolve("scripts/pipeline.ts");

  it("ignores a missing raw directory", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    writeE2eCoverageSummary();
    expect(log).toHaveBeenCalledWith("e2e coverage did not include any src file");
  });

  it("ignores an empty raw directory", () => {
    mem.dirs.add(E2E_RAW_DIR);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    writeE2eCoverageSummary();
    expect(log).toHaveBeenCalledWith("e2e coverage did not include any src file");
  });

  it("writes the merged src summary", () => {
    mem.dirs.add(E2E_RAW_DIR);
    mem.store.set(
      `${E2E_RAW_DIR}/one.json`,
      JSON.stringify({
        [src]: fileCoverage(src, [1, 0]),
        [other]: fileCoverage(other, [1]),
      }),
    );
    mem.store.set(`${E2E_RAW_DIR}/notes.txt`, "skip");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    writeE2eCoverageSummary();
    const written = JSON.parse(mem.store.get(E2E_SUMMARY) ?? "");
    expect(written.total.lines).toMatchObject({ total: 2, covered: 1, pct: 50 });
    expect(log).toHaveBeenCalledWith("e2e coverage: 50% of lines (1/2)");
  });

  it("rethrows in CI", () => {
    process.env.CI = "true";
    expect(() => writeE2eCoverageSummary()).toThrow(/did not include any src file/);
  });

  it("logs a non-error failure outside CI", () => {
    mem.dirs.add(E2E_RAW_DIR);
    mem.store.set(`${E2E_RAW_DIR}/one.json`, JSON.stringify({ [src]: fileCoverage(src, [1]) }));
    mem.writeFileSync.mockImplementationOnce(() => {
      throw "disk";
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    writeE2eCoverageSummary();
    expect(log).toHaveBeenCalledWith("disk");
  });
});

describe("coverageInstrumentPlugin", () => {
  it("is a post build plugin and skips files outside src", () => {
    const plugin = coverageInstrumentPlugin();
    expect(plugin.apply).toBe("build");
    expect(plugin.enforce).toBe("post");
    const transform = plugin.transform;
    if (typeof transform !== "function") throw new Error("transform missing");
    expect(
      transform.call(undefined as never, "const x = 1;\n", resolve("scripts/pipeline.ts")),
    ).toBe(null);
  });

  it("instruments a src TypeScript module", () => {
    const plugin = coverageInstrumentPlugin();
    const transform = plugin.transform;
    if (typeof transform !== "function") throw new Error("transform missing");
    const result = transform.call(
      undefined as never,
      "export const n = 1;\n",
      resolve("src/probe.ts"),
    );
    expect(result).toMatchObject({ code: expect.stringContaining("coverage") });
  });
});
