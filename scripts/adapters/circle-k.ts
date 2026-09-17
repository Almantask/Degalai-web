import type { FuelType, Observation } from "../../src/types.ts";
import { dateInVilnius } from "../history.ts";
import { vilniusOffsetAt } from "../vilnius-time.ts";
import { FETCH_UA, parsePrice } from "./types.ts";

export const CIRCLE_K_PRICES_URL = "https://www.circlek.lt/privatiems/degalu-kainos";

/** Genitive month names as used in "Kainos atnaujintos rugsėjo 17-ą dieną". */
const LT_MONTHS = [
  "sausio",
  "vasario",
  "kovo",
  "balandžio",
  "gegužės",
  "birželio",
  "liepos",
  "rugpjūčio",
  "rugsėjo",
  "spalio",
  "lapkričio",
  "gruodžio",
];

/**
 * Card image file names identify the product; alt text does not (the plain diesel card is
 * labelled "miles+ Diesel"). Premium grades, XTL and AdBlue have no app fuel type.
 */
const IMAGE_FUELS: Array<[RegExp, FuelType | null]> = [
  [/milesplus_95/, null],
  [/milesplus_98/, "98"],
  [/milesplus_d/, null],
  [/miles_95/, "95"],
  [/miles_d/, "D"],
  [/lpg/, "LPG"],
  [/xtl|adblue/, null],
];

const ALT_FUELS: Array<[RegExp, FuelType | null]> = [
  [/\+|xtl|adblue/, null],
  [/95/, "95"],
  [/98/, "98"],
  [/diesel|dyzel/, "D"],
  [/lpg|dujos|snd/, "LPG"],
];

/** `null` for a known product the app does not show; `undefined` when the card is unrecognised. */
export function circleKFuel(imageSrc: string, alt: string): FuelType | null | undefined {
  const file = safeDecode(imageSrc.split("?")[0].split("/").at(-1) ?? "").toLowerCase();
  for (const [re, fuel] of IMAGE_FUELS) if (re.test(file)) return fuel;
  const label = alt.trim().toLowerCase();
  for (const [re, fuel] of ALT_FUELS) if (re.test(label)) return fuel;
  return undefined;
}

export function circleKSourceId(city: string, address: string): string {
  const raw = `${city}|${address}`.toLowerCase().replace(/\xa0/g, " ");
  const tokens = raw.match(/[0-9a-ząčęėįšųūž]+/gi) ?? [];
  return `circle-k:${tokens.sort().join("-")}`;
}

/** Page date as `YYYY-MM-DD`; the year comes from `now` in Vilnius, rolling back over New Year. */
export function parseCircleKDate(html: string, now = new Date()): string | null {
  const iso = html.match(/Kainos atnaujintos\s+(\d{4}-\d{2}-\d{2})/i);
  if (iso) return iso[1];
  const m = html.match(/Kainos atnaujintos\s+([a-ząčęėįšųūž]+)\s+(\d{1,2})\s*-/i);
  if (!m) return null;
  const month = LT_MONTHS.indexOf(m[1].toLowerCase()) + 1;
  const day = Number(m[2]);
  if (month === 0 || day < 1 || day > 31) return null;
  const today = dateInVilnius(now.toISOString());
  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));
  const year = month > currentMonth ? currentYear - 1 : currentYear;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Network-lowest price per product, each with the station that has it. */
export function parseCircleKPage(html: string, now = new Date()): Observation[] {
  const date = parseCircleKDate(html, now);
  if (!date) throw new Error("Circle K price date not found");
  const observedAt = `${date}T00:00:00${vilniusOffsetAt(date)}`;

  const out: Observation[] = [];
  for (const card of html.split(/class="atom-card\b/).slice(1)) {
    const img = card.match(/<img\b[^>]*>/)?.[0] ?? "";
    const fuel = circleKFuel(attr(img, "src"), attr(img, "alt"));
    if (fuel === undefined) {
      console.warn(`Circle K: unrecognised product card (${attr(img, "src") || "no image"})`);
      continue;
    }
    if (fuel === null) continue;
    const heading = card.match(/class="uk-heading-large"[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "";
    const price = parsePrice(textOf(heading));
    const lines = (card.match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? "")
      .split(/<br\s*\/?>/i)
      .map(textOf)
      .filter(Boolean);
    if (price == null || lines.length < 3) continue;
    const [name, address, city] = lines;
    out.push({
      sourceStationId: circleKSourceId(city, address),
      brand: "circle-k",
      name,
      address,
      city,
      fuel,
      price,
      observedAt,
      source: "circle-k",
    });
  }
  if (out.length === 0) throw new Error("Circle K page parsed 0 prices");
  return out;
}

export async function fetchCircleK(
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
): Promise<Observation[]> {
  const res = await fetchImpl(CIRCLE_K_PRICES_URL, { headers: { "User-Agent": FETCH_UA } });
  if (!res.ok) throw new Error(`Circle K prices HTTP ${res.status}`);
  return parseCircleKPage(await res.text(), now);
}

function attr(tag: string, name: string): string {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? "";
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
