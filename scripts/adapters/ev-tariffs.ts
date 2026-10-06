import { existsSync, readFileSync } from "node:fs";
import { normalizeBrand } from "../../src/brands.ts";
import type { DailyPrices, Station } from "../../src/types.ts";
import { PRICE_RANGE } from "../validate.ts";
import { VIA_LIETUVA_SOURCE } from "./via-lietuva.ts";

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
 * EV price sources, most trustworthy first:
 * 1. `via-lietuva`: the charger's ad hoc price as its operator reported it to the national register;
 * 2. `ev-tariff`: the network's published AC/DC list price, copied by a maintainer;
 * 3. `osm-charge`: a price a volunteer tagged on the charger in OpenStreetMap.
 * Each charger takes the first source that has a price for it this run.
 */
export const EV_SOURCE_ORDER = [VIA_LIETUVA_SOURCE, EV_TARIFF_SOURCE, OSM_CHARGE_SOURCE] as const;
export type EvSource = (typeof EV_SOURCE_ORDER)[number];

interface Candidate {
  source: EvSource;
  price: number;
  /** Set when the source dates its own price (tariffs); otherwise first seen at this price. */
  observedAt?: string;
}

function candidates(s: Station, tariff: EvTariff | undefined): Candidate[] {
  const out: Candidate[] = [];
  const ev = s.ev;
  if (ev?.registerPrice != null) out.push({ source: VIA_LIETUVA_SOURCE, price: ev.registerPrice });
  if (tariff) {
    const price = isDcCharger(s) ? (tariff.dc ?? tariff.ac) : (tariff.ac ?? tariff.dc);
    if (price != null) out.push({ source: EV_TARIFF_SOURCE, price, observedAt: tariff.observedAt });
  }
  if (ev?.chargeTag != null) out.push({ source: OSM_CHARGE_SOURCE, price: ev.chargeTag });
  return out.filter((c) => inRange(c.price));
}

/**
 * One €/kWh price per charger from the most trustworthy source that has one (`EV_SOURCE_ORDER`).
 * Chargers no source covers stay unpriced. A price that has not changed keeps its first
 * `observedAt` from `previous`, so hourly runs do not rewrite the snapshot (and move "last
 * updated") when nothing changed.
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
    const best = candidates(s, byBrand.get(s.brand)).sort(
      (a, b) => EV_SOURCE_ORDER.indexOf(a.source) - EV_SOURCE_ORDER.indexOf(b.source),
    )[0];
    if (!best) continue;
    const prev = previous?.prices[s.id]?.EV;
    const same = prev?.source === best.source && prev.price === best.price;
    const observedAt = best.observedAt ?? (same ? prev.observedAt : now.toISOString());
    out[s.id] = { EV: { price: best.price, source: best.source, observedAt } };
  }
  return out;
}

/** Priced chargers per source, for the run log. */
export function countBySource(prices: DailyPrices["prices"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const fuels of Object.values(prices)) {
    const source = fuels.EV?.source;
    if (source) out[source] = (out[source] ?? 0) + 1;
  }
  return out;
}

/** Adds charger prices to a snapshot; pump fuels at the same id are left alone. */
export function mergeChargerPrices(daily: DailyPrices, prices: DailyPrices["prices"]): DailyPrices {
  for (const [id, fuels] of Object.entries(prices)) {
    daily.prices[id] = { ...daily.prices[id], ...fuels };
  }
  return daily;
}
