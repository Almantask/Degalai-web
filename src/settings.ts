import { DEFAULT_SETTINGS, type FuelType, type UserSettings } from "./types.ts";
import type { Locale } from "./i18n/index.ts";

const KEY = "kur-degalai-settings";

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: UserSettings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
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
