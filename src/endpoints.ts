import type { LngLat } from "./geo.ts";
import type { GeoHit } from "./routing.ts";

/** The two route fields: a chosen place, or the user's own location. */
export interface Endpoints {
  /** `null` means "my location" (the GPS start). */
  start: GeoHit | null;
  /** `null` means no destination yet. */
  end: GeoHit | null;
  /** The destination is the user's location, fixed when it was swapped in from the start. */
  endIsHere: boolean;
}

/**
 * Start and destination swapped, or `null` when the swap button should be disabled: nothing to
 * swap, or "my location" has to become the destination while it is unknown.
 */
export function swapEndpoints(
  e: Endpoints,
  here: LngLat | null,
  hereLabel: string,
): Endpoints | null {
  const startIsHere = e.start === null;
  const endIsHere = e.end !== null && e.endIsHere;
  if (startIsHere && (e.end === null || endIsHere)) return null;
  if (startIsHere && !here) return null;
  return {
    // An empty destination, or one that is my location, becomes the GPS start.
    start: e.end === null || endIsHere ? null : e.end,
    end: startIsHere ? { label: hereLabel, lat: here!.lat, lon: here!.lon } : e.start,
    endIsHere: startIsHere,
  };
}
