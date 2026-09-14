import {
  DEFAULT_SETTINGS,
  FUEL_TYPES,
  type FuelType,
  type Station,
  type UserSettings,
} from "./types.ts";
import type { Locale } from "./i18n/index.ts";

const KEY = "kur-degalai-settings";

export const AROUND_RADIUS_KM = [5, 15, 30] as const;
export type AroundRadiusKm = (typeof AROUND_RADIUS_KM)[number];

const FUEL_SET = new Set<string>(FUEL_TYPES);
const LOCALE_SET = new Set<string>(["lt", "en"]);
const PREFERENCE_SET = new Set<string>(["shortest", "fastest"]);
const RADIUS_SET = new Set<number>(AROUND_RADIUS_KM);

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  let n = Number.NaN;
  if (typeof value === "number") n = value;
  else if (typeof value === "string") n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Rebuild settings from untrusted JSON (localStorage) with allow-listed fields only. */
export function sanitizeSettings(raw: unknown): UserSettings {
  const parsed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fuel = FUEL_SET.has(parsed.fuel as string)
    ? (parsed.fuel as FuelType)
    : DEFAULT_SETTINGS.fuel;
  const routePreference = PREFERENCE_SET.has(parsed.routePreference as string)
    ? (parsed.routePreference as UserSettings["routePreference"])
    : DEFAULT_SETTINGS.routePreference;
  const radius = Number(parsed.aroundRadiusKm);
  const aroundRadiusKm = RADIUS_SET.has(radius) ? radius : DEFAULT_SETTINGS.aroundRadiusKm;
  const locale = LOCALE_SET.has(parsed.locale as string) ? (parsed.locale as Locale) : undefined;

  return {
    fuel,
    routePreference,
    consumption: clampNumber(parsed.consumption, DEFAULT_SETTINGS.consumption, 3, 20),
    litres: clampNumber(parsed.litres, DEFAULT_SETTINGS.litres, 5, 80),
    timeValue: clampNumber(parsed.timeValue, DEFAULT_SETTINGS.timeValue, 0, 50),
    roadFactor: clampNumber(parsed.roadFactor, DEFAULT_SETTINGS.roadFactor, 1, 2),
    aroundRadiusKm,
    aroundReturn: asBoolean(parsed.aroundReturn, DEFAULT_SETTINGS.aroundReturn),
    routeDetourKm: clampNumber(parsed.routeDetourKm, DEFAULT_SETTINGS.routeDetourKm, 1, 15),
    hideUnpriced: asBoolean(parsed.hideUnpriced, DEFAULT_SETTINGS.hideUnpriced),
    excludedBrands: sanitizeExcludedBrands(parsed.excludedBrands),
    ...(locale ? { locale } : {}),
  };
}

const BRAND_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sanitizeExcludedBrands(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !BRAND_ID.test(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
    if (out.length >= 40) break;
  }
  return out.sort();
}

export function isBrandIncluded(brand: string, excluded: readonly string[]): boolean {
  return !excluded.includes(brand);
}

export function uniqueBrands(stations: Station[]): string[] {
  return [...new Set(stations.map((s) => s.brand || "independent"))];
}

function copyDefaults(): UserSettings {
  return { ...DEFAULT_SETTINGS, excludedBrands: [] };
}

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return copyDefaults();
    return sanitizeSettings(JSON.parse(raw) as unknown);
  } catch {
    return copyDefaults();
  }
}

export function saveSettings(settings: UserSettings): void {
  localStorage.setItem(KEY, JSON.stringify(sanitizeSettings(settings)));
}

export function persistLocale(locale: Locale): void {
  const s = loadSettings();
  s.locale = locale;
  saveSettings(s);
}

export function fuelFromUrl(search: string): FuelType | null {
  const v = new URLSearchParams(search).get("fuel");
  if (v === "diesel" || v === "D") return "D";
  if (v === "petrol" || v === "95") return "95";
  if (v === "98") return "98";
  if (v === "gas" || v === "lpg" || v === "LPG") return "LPG";
  return null;
}

export function fuelToUrl(fuel: FuelType): string {
  if (fuel === "D") return "diesel";
  if (fuel === "LPG") return "gas";
  return fuel;
}
