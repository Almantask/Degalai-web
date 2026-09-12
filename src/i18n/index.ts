import lt from "./lt.json";
import en from "./en.json";
import type { FuelType } from "../types.ts";

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

export function tPlural(base: "stations", n: number): string {
  const cat = pluralCategory(n);
  const key = `plural.${base}.${cat}` as MessageKey;
  return t(key, { n });
}

export function brandLabel(brand: string): string {
  const key = `brand.${brand}` as MessageKey;
  if (key in catalogs[current] || key in catalogs.lt) return t(key);
  return brand
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function fuelGroupOf(fuel: FuelType): "diesel" | "petrol" | "gas" {
  if (fuel === "D") return "diesel";
  if (fuel === "LPG") return "gas";
  return "petrol";
}

export const FUEL_BY_GROUP = {
  diesel: ["D"] as FuelType[],
  petrol: ["95", "98"] as FuelType[],
  gas: ["LPG"] as FuelType[],
};
