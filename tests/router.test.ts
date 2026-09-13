import { describe, expect, it } from "vitest";
import { hrefFor } from "../src/router.ts";
import type { FuelType } from "../src/types.ts";

describe("hrefFor", () => {
  it("emits only allow-listed fuel query values", () => {
    expect(hrefFor("map", "lt", "D")).toMatch(/[?&]fuel=diesel$/);
    expect(hrefFor("map", "en", "LPG")).toMatch(/[?&]fuel=gas$/);
    expect(hrefFor("map", "lt", "95")).toMatch(/[?&]fuel=95$/);
  });

  it("ignores unknown fuel values instead of interpolating them", () => {
    const href = hrefFor("map", "lt", `" onclick="alert(1)` as unknown as FuelType);
    expect(href).not.toMatch(/onclick/i);
    expect(href).not.toContain("fuel=");
  });
});
