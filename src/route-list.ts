import { distanceAlongLineKm, nearestPointOnPolyline, pointAlongLine, type LngLat } from "./geo.ts";

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
export const MAX_DETOUR_CHECKS = 120;
/**
 * A stop leaves the route this far before the station and rejoins it this far after, so a
 * motorway exit or a junction just before the pumps still counts.
 */
export const DETOUR_WINDOW_KM = 1;
/** Stations this close to a dashed via-route get a check for being on it. */
export const DASHED_ROUTE_KM = 0.2;
/** Road detour checks per dashed via-route, cheapest first. */
export const MAX_DASHED_CHECKS = 10;

/** A point on the route with the heading of travel there. */
export interface RoutePoint extends LngLat {
  bearing: number;
}

/**
 * Where a stop at the station leaves and rejoins the route, and how far along the route the
 * station sits. The detour is then leave → station → rejoin against leave → rejoin.
 */
export function detourWindow(
  line: LngLat[],
  station: LngLat,
  windowKm = DETOUR_WINDOW_KM,
): { alongKm: number; leave: RoutePoint; rejoin: RoutePoint } {
  const nearest = nearestPointOnPolyline(station, line);
  const alongKm = distanceAlongLineKm(line, nearest.index, nearest.point);
  const leave = pointAlongLine(line, alongKm - windowKm);
  const rejoin = pointAlongLine(line, alongKm + windowKm);
  return {
    alongKm,
    leave: { ...leave.point, bearing: leave.bearing },
    rejoin: { ...rejoin.point, bearing: rejoin.bearing },
  };
}

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
  maxDetourKm: number,
): boolean {
  if (detour === undefined) return lineKm <= ON_ROUTE_KM;
  return detour != null && detour.extraKm < maxDetourKm;
}

/**
 * The one station worth marking on a dashed via-route: near the line, cheaper than the station
 * the line leads to, and on it by road. `detourKm` is the detour from the dashed line itself
 * (null: unreachable; undefined: the router did not answer, so closeness to the line decides).
 */
export function cheapestOnDashed<
  T extends {
    price: number;
    station: { id: string };
    dashedKm: number;
    detourKm: number | null | undefined;
  },
>(targetPrice: number, candidates: T[], maxDetourKm: number): T | undefined {
  return candidates
    .filter(
      (c) =>
        c.dashedKm <= DASHED_ROUTE_KM &&
        c.price < targetPrice &&
        c.detourKm !== null &&
        (c.detourKm === undefined || c.detourKm < maxDetourKm),
    )
    .sort(byPrice)[0];
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
