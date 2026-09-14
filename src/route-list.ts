export interface PricedRouteRow {
  kind: "on" | "detour";
  price: number;
  station: { id: string };
}

export const TOP_CHEAP_COUNT = 5;
/** Stations this close to the trip polyline count as on the way. */
export const ON_ROUTE_KM = 0.5;

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
