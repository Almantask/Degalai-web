import { getLocale, intlLocale, t } from "./i18n/index.ts";

export function formatPrice(price: number): string {
  const n = new Intl.NumberFormat(intlLocale(), {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(price);
  return t("units.eurPerL", { price: n });
}

export function formatMoney(amount: number): string {
  const sign = amount < 0 ? "−" : "";
  const n = new Intl.NumberFormat(intlLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));
  return getLocale() === "lt" ? `${sign}${n} €` : `${sign}€${n}`;
}

export function formatKm(km: number): string {
  const n = new Intl.NumberFormat(intlLocale(), {
    minimumFractionDigits: km < 10 ? 1 : 0,
    maximumFractionDigits: km < 10 ? 1 : 0,
  }).format(km);
  return `${n} km`;
}

const STREET_ABBR: Array<[string, string]> = [
  ["gatv[eė]s?", "g."],
  ["prospektas", "pr."],
  ["alėja", "al."],
  ["plentas", "pl."],
  ["aikšt[eė]", "a."],
  ["skersgatvis", "skg."],
  ["kelias", "kel."],
];

/** Compact a station address for list rows; the popup still shows the original. */
export function shortAddress(address: string): string {
  let s = address.replace(/\b\d{5}\b/g, "");
  for (const [from, to] of STREET_ABBR) {
    s = s.replace(new RegExp(`(?<!\\p{L})${from}(?!\\p{L})`, "giu"), to);
  }
  return s.replace(/\s+,/g, ",").replace(/,\s*$/g, "").replace(/\s+/g, " ").trim();
}

export function formatDuration(minutes: number): string {
  if (minutes < 0.5) return t("units.underMin");
  const m = Math.max(1, Math.round(minutes));
  if (m < 60) return t("units.min", { n: m });
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return t("units.hour", { h });
  return t("units.hourMin", { h, m: rem });
}

export function formatDate(isoDate: string): string {
  const d = new Date(isoDate.includes("T") ? isoDate : `${isoDate}T12:00:00Z`);
  return new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: "medium",
  }).format(d);
}

/** Compact calendar day for chart ticks; `YYYY-MM-DD` is shown as-is in Vilnius. */
export function formatChartDate(isoDate: string): string {
  const day = isoDate.slice(0, 10);
  return new Intl.DateTimeFormat(intlLocale(), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Vilnius",
  }).format(new Date(iso));
}

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
