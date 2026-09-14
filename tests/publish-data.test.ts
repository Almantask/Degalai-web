import { describe, expect, it } from "vitest";
import { includePublishedDataFile } from "../scripts/publish-data.ts";

describe("includePublishedDataFile", () => {
  it("ships only the latest daily snapshot", () => {
    expect(includePublishedDataFile("", "2026-09-14")).toBe(true);
    expect(includePublishedDataFile("prices", "2026-09-14")).toBe(true);
    expect(includePublishedDataFile("prices/2026-09-14.json", "2026-09-14")).toBe(true);
    expect(includePublishedDataFile("prices/2026-09-07.json", "2026-09-14")).toBe(false);
    expect(includePublishedDataFile("prices/.gitkeep", "2026-09-14")).toBe(false);
  });

  it("keeps compact history and stations, skips caches", () => {
    expect(includePublishedDataFile("history.json", "2026-09-14")).toBe(true);
    expect(includePublishedDataFile("stations.json", "2026-09-14")).toBe(true);
    expect(includePublishedDataFile("cache/geocode.json", "2026-09-14")).toBe(false);
    expect(includePublishedDataFile("downloads/lea.xlsx", "2026-09-14")).toBe(false);
  });
});
