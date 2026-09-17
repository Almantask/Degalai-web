import { describe, expect, it } from "vitest";
import { vilniusLocalToIso, vilniusOffsetAt } from "../scripts/vilnius-time.ts";

describe("vilniusLocalToIso", () => {
  it("stamps September as EEST", () => {
    expect(vilniusOffsetAt("2026-09-17")).toBe("+03:00");
    expect(vilniusLocalToIso("2026-09-17 09:45:16")).toBe("2026-09-17T09:45:16+03:00");
  });

  it("stamps January as EET", () => {
    expect(vilniusOffsetAt("2026-01-15")).toBe("+02:00");
    expect(vilniusLocalToIso("2026-01-15 10:00:00")).toBe("2026-01-15T10:00:00+02:00");
  });
});
