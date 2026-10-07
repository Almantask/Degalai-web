import type { FuelType } from "./types.ts";
import { persistLocale } from "./settings.ts";
import { getLocale, setLocale, type Locale } from "./i18n/index.ts";

export type View = "map" | "history";

export interface RouteState {
  view: View;
  locale: Locale;
  fuelQuery: string | null;
}

const LT_PATHS: Record<View, string> = {
  map: "/",
  history: "/istorija",
};

const EN_PATHS: Record<View, string> = {
  map: "/en/",
  history: "/en/history",
};

export function viewFromPath(pathname: string): { view: View; locale: Locale } {
  const path = pathname.replace(/\/+$/, "") || "/";
  const locale: Locale = path === "/en" || path.startsWith("/en/") ? "en" : "lt";
  const view: View = path === "/istorija" || path === "/en/history" ? "history" : "map";
  return { view, locale };
}

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
  const { view, locale } = viewFromPath(stripBase(pathname));
  const fuelQuery = new URLSearchParams(window.location.search).get("fuel");
  return { view, locale, fuelQuery };
}

export function pathFor(view: View, locale: Locale = getLocale()): string {
  const paths = locale === "en" ? EN_PATHS : LT_PATHS;
  return `${basePath()}${paths[view]}`;
}

function fuelQueryParam(fuel: FuelType): string | null {
  if (fuel === "D") return "diesel";
  if (fuel === "LPG") return "gas";
  if (fuel === "EV") return "ev";
  if (fuel === "95" || fuel === "98") return fuel;
  return null;
}

/** `fuel=…`, plus `kw=…` for an EV power preset. */
function searchParams(fuel: FuelType | undefined, minKw: number): URLSearchParams {
  const params = new URLSearchParams();
  const q = fuel ? fuelQueryParam(fuel) : null;
  if (q) params.set("fuel", q);
  if (fuel === "EV" && (minKw === 50 || minKw === 150)) params.set("kw", String(minKw));
  return params;
}

export function hrefFor(view: View, locale: Locale, fuel?: FuelType, minKw = 0): string {
  const path = pathFor(view, locale);
  const q = searchParams(fuel, minKw).toString();
  if (!q) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${q}`;
}

export function navigate(
  view: View,
  locale: Locale,
  fuel?: FuelType,
  replace = false,
  minKw = 0,
): void {
  const path = pathFor(view, locale);
  const url = new URL(path, window.location.origin);
  url.search = searchParams(fuel, minKw).toString();
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
