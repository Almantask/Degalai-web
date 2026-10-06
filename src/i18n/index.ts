import lt from "./lt.json";
import en from "./en.json";
import type { FuelGroup, FuelType, Station } from "../types.ts";

export type Locale = "lt" | "en";
export type MessageKey = keyof typeof lt;

const catalogs: Record<Locale, Record<MessageKey, string>> = {
  lt,
  en: en as Record<MessageKey, string>,
};

let current: Locale = "lt";

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s = catalogs[current][key] ?? catalogs.lt[key] ?? String(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

export function intlLocale(locale: Locale = current): string {
  return locale === "lt" ? "lt-LT" : "en-GB";
}

/** Lithuanian: 1 / 21 → one; 2–9 (except 12–19) → few; else other. English: 1 → one, else other. */
export function pluralCategory(n: number, locale: Locale = current): "one" | "few" | "other" {
  const abs = Math.abs(Math.trunc(n));
  if (locale === "en") return abs === 1 ? "one" : "other";
  const n10 = abs % 10;
  const n100 = abs % 100;
  if (n10 === 1 && n100 !== 11) return "one";
  if (n10 >= 2 && n10 <= 9 && (n100 < 10 || n100 >= 20)) return "few";
  return "other";
}

export function tPlural(base: "stations" | "chargers", n: number): string {
  const cat = pluralCategory(n);
  const key = `plural.${base}.${cat}` as MessageKey;
  return t(key, { n });
}

export function hasBrandLabel(brand: string): boolean {
  const key = `brand.${brand}`;
  return key in catalogs[current] || key in catalogs.lt;
}

/**
 * A charger's provider: a known brand's name, else its network as the operator writes it. A small
 * network filed under "Kita" in the filter still shows its own name here.
 */
export function chargerBrandLabel(s: Pick<Station, "brand" | "ev">): string {
  const network = s.ev?.network;
  if (!network || (s.brand !== "independent" && hasBrandLabel(s.brand))) return brandLabel(s.brand);
  return network;
}

/** Display name per provider id among chargers, for the EV provider filter. */
export function networkLabels(stations: Pick<Station, "brand" | "ev">[]): Map<string, string> {
  const seen = new Map<string, Map<string, number>>();
  for (const s of stations) {
    if (hasBrandLabel(s.brand) || !s.ev?.network) continue;
    const names = seen.get(s.brand) ?? new Map<string, number>();
    names.set(s.ev.network, (names.get(s.ev.network) ?? 0) + 1);
    seen.set(s.brand, names);
  }
  const out = new Map<string, string>();
  for (const [brand, names] of seen) {
    // The most common spelling wins; ties go to the alphabetically first for stable output.
    const best = [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) out.set(brand, best[0]);
  }
  return out;
}

export function brandLabel(brand: string): string {
  const key = `brand.${brand}` as MessageKey;
  if (key in catalogs[current] || key in catalogs.lt) return t(key);
  return brand
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function fuelGroupOf(fuel: FuelType): FuelGroup {
  if (fuel === "D") return "diesel";
  if (fuel === "LPG") return "gas";
  if (fuel === "EV") return "ev";
  return "petrol";
}

export const FUEL_BY_GROUP: Record<FuelGroup, FuelType[]> = {
  diesel: ["D"],
  petrol: ["95", "98"],
  gas: ["LPG"],
  ev: ["EV"],
};
