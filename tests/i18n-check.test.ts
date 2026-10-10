import { describe, expect, it, vi } from "vitest";
import {
  checkBundledCatalogs,
  compareCatalogs,
  exitIfMismatch,
  reportCatalogDiff,
  runI18nCheck,
} from "../scripts/i18n-check.ts";

describe("compareCatalogs", () => {
  it("lists keys missing in each catalog", () => {
    expect(compareCatalogs({ a: "lt", onlyLt: "x" }, { a: "en", onlyEn: "y" })).toEqual({
      keyCount: 2,
      missingInEn: ["onlyLt"],
      missingInLt: ["onlyEn"],
    });
  });

  it("reports no gaps when the keys match", () => {
    expect(compareCatalogs({ a: "lt", b: "lt" }, { b: "en", a: "en" })).toEqual({
      keyCount: 2,
      missingInEn: [],
      missingInLt: [],
    });
  });
});

describe("reportCatalogDiff", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 1 when English is missing keys", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = reportCatalogDiff({ keyCount: 2, missingInEn: ["onlyLt"], missingInLt: [] });
    expect(status).toBe(1);
    expect(error).toHaveBeenCalledWith("Missing in en.json:", "onlyLt");
  });

  it("returns 1 when Lithuanian is missing keys", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = reportCatalogDiff({ keyCount: 1, missingInEn: [], missingInLt: ["onlyEn"] });
    expect(status).toBe(1);
    expect(error).toHaveBeenCalledWith("Missing in lt.json:", "onlyEn");
  });

  it("returns 0 when the catalogs match", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const status = reportCatalogDiff({ keyCount: 4, missingInEn: [], missingInLt: [] });
    expect(status).toBe(0);
    expect(log).toHaveBeenCalledWith("i18n OK: 4 keys");
  });
});

describe("checkBundledCatalogs", () => {
  it("accepts the catalogs shipped with the site", () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(checkBundledCatalogs()).toBe(0);
  });
});

describe("exitIfMismatch", () => {
  it("leaves a matching catalog running", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    exitIfMismatch(0);
    expect(exit).not.toHaveBeenCalled();
  });

  it("exits when the catalogs differ", () => {
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
      throw new Error(`exit ${code}`);
    });
    expect(() => exitIfMismatch(2)).toThrow("exit 2");
  });
});

describe("runI18nCheck", () => {
  it("checks the bundled catalogs without exiting", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    runI18nCheck();
    expect(exit).not.toHaveBeenCalled();
  });
});
