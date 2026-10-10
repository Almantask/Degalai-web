import { describe, expect, it } from "vitest";
import { displayBrandName, networkSlug, normalizeBrand, osmFuels } from "../src/brands.ts";

describe("normalizeBrand", () => {
  it("skips empty parts and matches the longest alias", () => {
    expect(normalizeBrand(undefined, "Neste Lietuva")).toBe("neste");
    expect(normalizeBrand("", "Orlen")).toBe("orlen");
  });
});

describe("networkSlug", () => {
  it("strips legal forms and falls back when the name is empty", () => {
    expect(networkSlug(undefined)).toBe("independent");
    expect(networkSlug("")).toBe("independent");
    expect(networkSlug("In Balance grid, UAB")).toBe("inbalance-grid");
    expect(networkSlug("VšĮ Something")).toBe("something");
    expect(networkSlug("---")).toBe("independent");
  });
});

describe("displayBrandName", () => {
  it("names a known brand and leaves an unknown id as it is", () => {
    expect(displayBrandName("circle-k")).toBe("Circle K");
    expect(displayBrandName("custom-network")).toBe("custom-network");
  });
});

describe("osmFuels", () => {
  it("defaults when the tags have no fuel or no known fuel", () => {
    expect(osmFuels({ amenity: "fuel" })).toEqual(["95", "D"]);
    expect(osmFuels({ fuel: "hydrogen" })).toEqual(["95", "D"]);
    expect(
      osmFuels({
        "fuel:octane_95": "yes",
        "fuel:octane_98": "yes",
        "fuel:diesel": "yes",
        "fuel:lpg": "yes",
      }),
    ).toEqual(["95", "98", "D", "LPG"]);
    expect(osmFuels({ fuel: "diesel" })).toEqual(["D"]);
  });
});
