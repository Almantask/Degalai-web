import { KNOWN_BRANDS, networkSlug } from "../src/brands.ts";
import { addSocketKw } from "../src/ev-filter.ts";
import { haversineKm } from "../src/geo.ts";
import type { Station } from "../src/types.ts";

/**
 * An OSM charger this close to a register site is the same place. Large car parks put OSM points
 * 100–300 m from the register's coordinates; real neighbouring sites are rarely that close.
 */
export const SAME_SITE_KM = 0.3;

/**
 * Chargers from the national register first; OSM fills in places the register lacks. An OSM
 * charger near a register site is dropped, but its `charge` tag stays on the site as a lower-ranked
 * price and its sockets and their power fill gaps.
 */
export function mergeChargers(
  register: Station[],
  osm: Station[],
  radiusKm = SAME_SITE_KM,
): { chargers: Station[]; osmOnly: number } {
  const sites = register.map((s) => ({ ...s, ev: { sockets: [], ...s.ev } }));
  const extra: Station[] = [];
  for (const o of osm) {
    let best: Station | undefined;
    let bestKm = radiusKm;
    // Cheap box test before haversine; a degree of longitude shrinks with latitude.
    const dLat = radiusKm / 111;
    const dLon = radiusKm / (111 * Math.cos((o.lat * Math.PI) / 180));
    for (const s of sites) {
      if (Math.abs(s.lat - o.lat) > dLat || Math.abs(s.lon - o.lon) > dLon) continue;
      const km = haversineKm(s, o);
      if (km <= bestKm) {
        best = s;
        bestKm = km;
      }
    }
    if (!best) {
      extra.push(o);
      continue;
    }
    const ev = best.ev!;
    if (ev.chargeTag == null && o.ev?.chargeTag != null) ev.chargeTag = o.ev.chargeTag;
    if (ev.sockets.length === 0 && o.ev?.sockets.length) ev.sockets = [...o.ev.sockets];
    if (ev.maxKw == null && o.ev?.maxKw != null) ev.maxKw = o.ev.maxKw;
    for (const [k, kw] of Object.entries(o.ev?.kwBySocket ?? {})) {
      if (ev.sockets.includes(k) && ev.kwBySocket?.[k] == null) addSocketKw(ev, k, kw);
    }
    if (!best.address && o.address) best.address = o.address;
    if (!best.city && o.city) best.city = o.city;
    best.sourceIds = { ...best.sourceIds, ...o.sourceIds };
  }
  return { chargers: [...sites, ...extra], osmOnly: extra.length };
}

/** Networks with fewer sites than this are listed under "Kita" rather than on their own. */
export const MIN_NETWORK_SITES = 3;

/**
 * Gives each charging network its own provider id so the EV provider filter can list it: known
 * brands keep theirs, others get a slug of the network name, and networks with fewer than
 * `min` sites stay "independent" so the list stays short.
 */
export function assignNetworkBrands(
  chargers: Station[],
  min = MIN_NETWORK_SITES,
): { chargers: Station[]; networks: number } {
  const ids = chargers.map((c) =>
    c.brand !== "independent" ? c.brand : networkSlug(c.ev?.network ?? undefined),
  );
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const out = chargers.map((c, i) => {
    const id = ids[i];
    const brand = KNOWN_BRANDS.has(id) || (counts.get(id) ?? 0) >= min ? id : "independent";
    return brand === c.brand ? c : { ...c, brand };
  });
  const networks = new Set(out.map((c) => c.brand).filter((b) => b !== "independent")).size;
  return { chargers: out, networks };
}
