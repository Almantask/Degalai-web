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

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(intlLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
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
