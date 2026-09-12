export interface PricedRouteRow {
  kind: "on" | "detour";
  price: number;
  station: { id: string };
}

export function byPrice<T extends { price: number; station: { id: string } }>(a: T, b: T): number {
  return a.price - b.price || a.station.id.localeCompare(b.station.id);
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
