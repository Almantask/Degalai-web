export interface PricedRouteRow {
  kind: "on" | "detour";
  price: number;
  station: { id: string };
}

export const TOP_CHEAP_COUNT = 5;
/** Without a road detour, stations this close to the trip polyline count as on the way. */
export const ON_ROUTE_KM = 0.5;
/** Stations this close to the trip polyline get a road detour check. */
export const DETOUR_CORRIDOR_KM = 2;
/** Road detour checks per route, closest to the polyline first. */
export const MAX_DETOUR_CHECKS = 150;
/** A station is on the way when stopping there adds at most this much road. */
export const ON_ROUTE_DETOUR_KM = 2;

/** Stations worth a road detour check: inside the corridor, closest to the route first. */
export function detourCandidates<T extends { lineKm: number }>(
  rows: T[],
  limit = MAX_DETOUR_CHECKS,
): T[] {
  return rows
    .filter((r) => r.lineKm <= DETOUR_CORRIDOR_KM)
    .sort((a, b) => a.lineKm - b.lineKm)
    .slice(0, limit);
}

/**
 * On the way by road when the router answered (null: it cannot reach the station). A station
 * across a hill or river from the route is close to the line yet far by road, and one on a
 * parallel street can be on the way though the line misses it. Without an answer (offline, or
 * past the check limit), fall back to distance from the line.
 */
export function isOnTheWay(
  lineKm: number,
  detour: { extraKm: number } | null | undefined,
): boolean {
  if (detour === undefined) return lineKm <= ON_ROUTE_KM;
  return detour != null && detour.extraKm <= ON_ROUTE_DETOUR_KM;
}

export function byPrice<T extends { price: number; station: { id: string } }>(a: T, b: T): number {
  return a.price - b.price || a.station.id.localeCompare(b.station.id);
}

export function topCheapStations<T extends { price: number; station: { id: string } }>(
  rows: T[],
  limit = TOP_CHEAP_COUNT,
): T[] {
  return [...rows].sort(byPrice).slice(0, limit);
}

/** Map pins: five cheapest on the way, plus any station the user picked from the list. */
export function mapRouteStationIds<T extends { price: number; station: { id: string } }>(
  rows: T[],
  extraIds: ReadonlySet<string> = new Set(),
  limit = TOP_CHEAP_COUNT,
): Set<string> {
  const ids = new Set(topCheapStations(rows, limit).map((r) => r.station.id));
  for (const id of extraIds) {
    if (rows.some((r) => r.station.id === id)) ids.add(id);
  }
  return ids;
}

/** Pin cheapest-on-route then cheapest-overall, then the rest cheapest-first. */
export function orderRouteRows<T extends PricedRouteRow>(
  rows: T[],
): { cheapestOn: T | undefined; cheapestOverall: T | undefined; ordered: T[] } {
  const cheapestOverall = [...rows].sort(byPrice)[0];
  const cheapestOn = [...rows].filter((r) => r.kind === "on").sort(byPrice)[0];
  const pinnedIds = new Set<string>();
  const ordered: T[] = [];
  if (cheapestOn) {
    ordered.push(cheapestOn);
    pinnedIds.add(cheapestOn.station.id);
  }
  if (cheapestOverall && !pinnedIds.has(cheapestOverall.station.id)) {
    ordered.push(cheapestOverall);
    pinnedIds.add(cheapestOverall.station.id);
  }
  ordered.push(...rows.filter((r) => !pinnedIds.has(r.station.id)).sort(byPrice));
  return { cheapestOn, cheapestOverall, ordered };
}
