import type { FuelType } from "./types.ts";
import { persistLocale } from "./settings.ts";
import { getLocale, setLocale, type Locale } from "./i18n/index.ts";

export type View = "map";

export interface RouteState {
  view: View;
  locale: Locale;
  fuelQuery: string | null;
}

const LT_PATHS: Record<View, string> = {
  map: "/",
};

const EN_PATHS: Record<View, string> = {
  map: "/en/",
};

export function basePath(): string {
  const b = import.meta.env.BASE_URL || "/";
  return b.endsWith("/") ? b.slice(0, -1) : b;
}

export function stripBase(pathname: string): string {
  const base = basePath();
  if (base && pathname.startsWith(base)) return pathname.slice(base.length) || "/";
  return pathname;
}

export function parsePath(pathname = window.location.pathname): RouteState {
  const path = stripBase(pathname).replace(/\/+$/, "") || "/";
  const locale: Locale = path === "/en" || path.startsWith("/en/") ? "en" : "lt";
  const fuelQuery = new URLSearchParams(window.location.search).get("fuel");
  return { view: "map", locale, fuelQuery };
}

export function pathFor(view: View, locale: Locale = getLocale()): string {
  const paths = locale === "en" ? EN_PATHS : LT_PATHS;
  return `${basePath()}${paths[view]}`;
}

function fuelQueryParam(fuel: FuelType): string | null {
  if (fuel === "D") return "diesel";
  if (fuel === "LPG") return "gas";
  if (fuel === "95" || fuel === "98") return fuel;
  return null;
}

export function hrefFor(view: View, locale: Locale, fuel?: FuelType): string {
  const path = pathFor(view, locale);
  if (!fuel) return path;
  const q = fuelQueryParam(fuel);
  if (!q) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}fuel=${q}`;
}

export function navigate(view: View, locale: Locale, fuel?: FuelType, replace = false): void {
  const path = pathFor(view, locale);
  const url = new URL(path, window.location.origin);
  const q = fuel ? fuelQueryParam(fuel) : null;
  if (q) url.searchParams.set("fuel", q);
  if (replace) history.replaceState({ view, locale }, "", url);
  else history.pushState({ view, locale }, "", url);
  setLocale(locale);
  persistLocale(locale);
}

export function detectInitialLocale(saved?: Locale): Locale {
  const fromPath = parsePath();
  const path = stripBase(window.location.pathname);
  if (path === "/en" || path.startsWith("/en/")) return "en";
  if (path === "/" && saved) return saved;
  if (path === "/" && !saved) {
    return navigator.language.toLowerCase().startsWith("lt") ? "lt" : "en";
  }
  return fromPath.locale;
}
