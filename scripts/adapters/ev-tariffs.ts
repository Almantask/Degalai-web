import { existsSync, readFileSync } from "node:fs";
import { normalizeBrand } from "../../src/brands.ts";
import type { DailyPrices, PriceEntry, Station } from "../../src/types.ts";
import { PRICE_RANGE } from "../validate.ts";

/** Charging network list price in €/kWh, copied by a maintainer from the network's own page. */
export interface EvTariff {
  /** Network as people write it (`Ignitis ON`); matched like OSM `network` / `operator`. */
  network: string;
  /** AC (Type 2) price. */
  ac?: number;
  /** DC (CCS / CHAdeMO) price. */
  dc?: number;
  /** When the price was read from the network's page. */
  observedAt: string;
  /** Page the price was copied from. */
  url?: string;
  note?: string;
}

export const EV_TARIFF_SOURCE = "ev-tariff";
export const OSM_CHARGE_SOURCE = "osm-charge";
/** A charger this powerful, or with a CCS / CHAdeMO socket, is priced at the DC tariff. */
export const DC_MIN_KW = 50;
const DC_SOCKETS = new Set(["type2_combo", "chademo", "tesla_supercharger"]);

export function loadEvTariffs(path: string): EvTariff[] {
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isTariff);
}

function isTariff(value: unknown): value is EvTariff {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.network !== "string" || !v.network.trim()) return false;
  if (typeof v.observedAt !== "string" || !Number.isFinite(Date.parse(v.observedAt))) return false;
  const priceOk = (p: unknown) => p === undefined || (typeof p === "number" && Number.isFinite(p));
  return priceOk(v.ac) && priceOk(v.dc) && (v.ac !== undefined || v.dc !== undefined);
}

export function isDcCharger(s: Station): boolean {
  if (s.ev?.maxKw != null && s.ev.maxKw >= DC_MIN_KW) return true;
  return Boolean(s.ev?.sockets.some((k) => DC_SOCKETS.has(k)));
}

function inRange(price: number): boolean {
  return price >= PRICE_RANGE.EV.min && price <= PRICE_RANGE.EV.max;
}

/**
 * One €/kWh price per charger. A price in the charger's own OSM `charge` tag wins; otherwise the
 * network tariff applies (DC for fast chargers, AC for the rest). Chargers of unknown networks
 * stay unpriced. An unchanged tag price keeps its first `observedAt` from `previous`, so hourly
 * runs do not rewrite the snapshot (and move "last updated") when nothing changed.
 */
export function chargerPrices(
  chargers: Station[],
  tariffs: EvTariff[],
  now = new Date(),
  previous: DailyPrices | null = null,
): DailyPrices["prices"] {
  const byBrand = new Map<string, EvTariff>();
  for (const t of tariffs) {
    const brand = normalizeBrand(t.network);
    if (brand === "independent") continue;
    const prev = byBrand.get(brand);
    if (!prev || t.observedAt > prev.observedAt) byBrand.set(brand, t);
  }
  const out: DailyPrices["prices"] = {};
  for (const s of chargers) {
    const entry = chargerEntry(s, byBrand.get(s.brand), now, previous?.prices[s.id]?.EV);
    if (entry) out[s.id] = { EV: entry };
  }
  return out;
}

function chargerEntry(
  s: Station,
  tariff: EvTariff | undefined,
  now: Date,
  prev: PriceEntry | undefined,
): PriceEntry | null {
  const tagged = s.ev?.chargeTag;
  if (tagged != null && inRange(tagged)) {
    const same = prev?.source === OSM_CHARGE_SOURCE && prev.price === tagged;
    return {
      price: tagged,
      source: OSM_CHARGE_SOURCE,
      observedAt: same ? prev.observedAt : now.toISOString(),
    };
  }
  if (!tariff) return null;
  const price = isDcCharger(s) ? (tariff.dc ?? tariff.ac) : (tariff.ac ?? tariff.dc);
  if (price == null || !inRange(price)) return null;
  return { price, source: EV_TARIFF_SOURCE, observedAt: tariff.observedAt };
}

/** Adds charger prices to a snapshot; pump fuels at the same id are left alone. */
export function mergeChargerPrices(daily: DailyPrices, prices: DailyPrices["prices"]): DailyPrices {
  for (const [id, fuels] of Object.entries(prices)) {
    daily.prices[id] = { ...daily.prices[id], ...fuels };
  }
  return daily;
}
