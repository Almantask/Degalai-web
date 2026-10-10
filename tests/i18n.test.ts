import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  brandLabel,
  chargerBrandLabel,
  fuelGroupOf,
  hasBrandLabel,
  networkLabels,
  setLocale,
  t,
  tPlural,
  type MessageKey,
} from "../src/i18n/index.ts";

it("lt.json and en.json have the same keys", () => {
  const dir = join(import.meta.dirname, "..", "src", "i18n");
  const lt = JSON.parse(readFileSync(join(dir, "lt.json"), "utf8")) as Record<string, string>;
  const en = JSON.parse(readFileSync(join(dir, "en.json"), "utf8")) as Record<string, string>;
  expect(Object.keys(lt).sort()).toEqual(Object.keys(en).sort());
});

it("substitutes vars and falls back when the key is missing", () => {
  setLocale("lt");
  expect(t("units.free")).toBe("Nemokamai");
  expect(t("units.min", { n: 4 })).toBe("4 min");
  setLocale("en");
  expect(t("no.such" as MessageKey)).toBe("no.such");
  setLocale("lt");
});

it("picks the plural for stations and chargers", () => {
  setLocale("lt");
  expect(tPlural("stations", 1)).toBe("1 degalinė");
  expect(tPlural("stations", 2)).toBe("2 degalinės");
  expect(tPlural("chargers", 10)).toBe("10 stotelių");
  setLocale("en");
  expect(tPlural("stations", 1)).toBe("1 station");
  expect(tPlural("stations", 2)).toBe("2 stations");
  setLocale("lt");
});

it("knows which brand ids have a translated name", () => {
  expect(hasBrandLabel("neste")).toBe(true);
  expect(hasBrandLabel("not-a-brand")).toBe(false);
});

it("shows a known brand, otherwise the network name", () => {
  expect(chargerBrandLabel({ brand: "neste" })).toBe("Neste");
  expect(chargerBrandLabel({ brand: "neste", ev: { sockets: [], network: "Neste ON" } })).toBe(
    "Neste",
  );
  expect(chargerBrandLabel({ brand: "independent", ev: { sockets: [], network: "Yard" } })).toBe(
    "Yard",
  );
  expect(chargerBrandLabel({ brand: "small-yard", ev: { sockets: [], network: "Yard" } })).toBe(
    "Yard",
  );
});

it("counts the spelling each unknown network uses", () => {
  const labels = networkLabels([
    { brand: "neste", ev: { sockets: [], network: "Neste" } },
    { brand: "small-net" },
    { brand: "small-net", ev: { sockets: [] } },
    { brand: "small-net", ev: { sockets: [], network: "Beta" } },
    { brand: "small-net", ev: { sockets: [], network: "Beta" } },
    { brand: "small-net", ev: { sockets: [], network: "Alpha" } },
    { brand: "other-net", ev: { sockets: [], network: "Zed" } },
    { brand: "other-net", ev: { sockets: [], network: "Amy" } },
  ]);
  expect(labels.get("small-net")).toBe("Beta");
  expect(labels.get("other-net")).toBe("Amy");
  expect(labels.has("neste")).toBe(false);
});

it("title-cases an unknown brand id", () => {
  expect(brandLabel("neste")).toBe("Neste");
  expect(brandLabel("in-balance-grid")).toBe("In Balance Grid");
});

it("groups each fuel", () => {
  expect(fuelGroupOf("D")).toBe("diesel");
  expect(fuelGroupOf("LPG")).toBe("gas");
  expect(fuelGroupOf("EV")).toBe("ev");
  expect(fuelGroupOf("95")).toBe("petrol");
});
