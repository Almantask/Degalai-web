import { describe, expect, it } from "vitest";
import { leaObservedAt } from "../scripts/adapters/lea.ts";

describe("leaObservedAt", () => {
  it("stamps working-day snapshots at 10:00 Vilnius time", () => {
    expect(leaObservedAt("2026-09-16")).toBe("2026-09-16T10:00:00+03:00");
  });
});
