import type { ChargerInfo, DailyPrices, EvMinKw, PlugGroup, PriceEntry, Station } from "./types.ts";

/** Plugs the car cannot take and the least power wanted, from the EV settings and chip row. */
export interface EvFilter {
  excludedPlugs: readonly PlugGroup[];
  minKw: EvMinKw;
}

/** The register prices AC and DC apart (`ChargerInfo.prices`); other sources give one price. */
const REGISTER_SOURCE = "via-lietuva";

const DC_SOCKETS = new Set(["type2_combo", "chademo", "tesla_supercharger", "type1_combo"]);

/** CCS, CHAdeMO and Tesla charge on DC; Type 2, Type 1, Schuko and CEE on AC. */
export function isDcSocket(socket: string): boolean {
  return DC_SOCKETS.has(socket);
}

export function plugGroup(socket: string): PlugGroup {
  if (socket === "type2" || socket === "type2_cable") return "type2";
  if (socket === "type2_combo") return "ccs";
  if (socket === "chademo") return "chademo";
  return "other";
}

export function isEvFilterOn(f: EvFilter): boolean {
  return f.excludedPlugs.length > 0 || f.minKw > 0;
}

/** Top kW of one socket kind at a site; a site with a single kind of socket gets its `maxKw`. */
export function socketKw(ev: ChargerInfo, socket: string): number | undefined {
  return ev.kwBySocket?.[socket] ?? (ev.sockets.length === 1 ? ev.maxKw : undefined);
}

/** Sockets at the site with an allowed plug and at least `minKw`; unknown power never passes. */
export function fittingSockets(ev: ChargerInfo | undefined, f: EvFilter): string[] {
  if (!ev) return [];
  return ev.sockets.filter((k) => {
    if (f.excludedPlugs.includes(plugGroup(k))) return false;
    if (f.minKw === 0) return true;
    const kw = socketKw(ev, k);
    return kw != null && kw >= f.minKw;
  });
}

/**
 * A charger stays when one of its sockets fits. One with no socket data fits only a power filter,
 * by its `maxKw`: with a plug turned off there is no telling whether the car can use it.
 */
export function chargerFits(s: Station, f: EvFilter): boolean {
  if (!isEvFilterOn(f)) return true;
  const ev = s.ev;
  if (!ev?.sockets.length) {
    return f.excludedPlugs.length === 0 && ev?.maxKw != null && ev.maxKw >= f.minKw;
  }
  return fittingSockets(ev, f).length > 0;
}

/**
 * €/kWh for the plugs and power the filter allows. The published price is the site's cheapest, AC
 * or DC; with a filter on only the current of the fitting sockets counts, so a fast-charge search
 * does not rank a site by its slow AC price. Undefined when the register prices only the other
 * current.
 */
export function fittingPrice(s: Station, entry: PriceEntry, f: EvFilter): number | undefined {
  const split = s.ev?.prices;
  if (!isEvFilterOn(f) || entry.source !== REGISTER_SOURCE || !split) return entry.price;
  const sockets = fittingSockets(s.ev, f);
  const current = (k: string): "ac" | "dc" => (isDcSocket(k) ? "dc" : "ac");
  const currents: Array<"ac" | "dc"> = sockets.length
    ? [...new Set(sockets.map(current))]
    : f.minKw >= 50
      ? ["dc"]
      : ["ac", "dc"];
  const prices = currents.map((c) => split[c]).filter((p): p is number => p != null);
  return prices.length ? Math.min(...prices) : undefined;
}

/** The snapshot with each charger's EV price swapped for its `fittingPrice`. */
export function evPricesFor(prices: DailyPrices, chargers: Station[], f: EvFilter): DailyPrices {
  if (!isEvFilterOn(f)) return prices;
  const out: DailyPrices["prices"] = { ...prices.prices };
  for (const s of chargers) {
    const entry = prices.prices[s.id]?.EV;
    if (!entry) continue;
    const price = fittingPrice(s, entry, f);
    if (price === entry.price) continue;
    const fuels = { ...prices.prices[s.id] };
    if (price == null) delete fuels.EV;
    else fuels.EV = { ...entry, price };
    out[s.id] = fuels;
  }
  return { ...prices, prices: out };
}

/** Raises a socket kind's kW at a site to `kw`; the map is replaced, so a copied site never shares it. */
export function addSocketKw(ev: ChargerInfo, socket: string, kw: number): void {
  const prev = ev.kwBySocket?.[socket];
  if (prev == null || kw > prev) ev.kwBySocket = { ...ev.kwBySocket, [socket]: kw };
}
