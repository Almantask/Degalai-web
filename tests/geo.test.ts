import { describe, expect, it } from "vitest";
import {
  bearingDeg,
  boundsAround,
  distanceAlongLineKm,
  distanceToPolylineKm,
  nearestPointOnPolyline,
  pointAlongLine,
  sampleLine,
  haversineKm,
} from "../src/geo.ts";

const start = { lon: 25.28, lat: 54.687 };
const north = { lon: 25.28, lat: 54.697 };
const east = { lon: 25.3, lat: 54.687 };

describe("distanceToPolylineKm", () => {
  it("is infinite for an empty line, and the point distance otherwise", () => {
    const point = { lon: 25.29, lat: 54.69 };
    expect(distanceToPolylineKm(point, [])).toBe(Infinity);
    expect(distanceToPolylineKm(point, [start])).toBeCloseTo(haversineKm(point, start), 5);
    expect(distanceToPolylineKm(start, [start, north, east])).toBeCloseTo(0, 5);
  });
});

describe("nearestPointOnPolyline", () => {
  it("projects onto the closest segment, including a repeated point", () => {
    const point = { lon: 25.29, lat: 54.69 };
    expect(nearestPointOnPolyline(point, [])).toEqual({ point, distKm: Infinity, index: 0 });

    const repeated = nearestPointOnPolyline(point, [start, start]);
    expect(repeated.point).toEqual(start);
    expect(repeated.index).toBe(0);

    const atStart = nearestPointOnPolyline(start, [start, north]);
    expect(atStart.index).toBe(0);
    expect(atStart.distKm).toBeCloseTo(0, 5);

    const nearEnd = nearestPointOnPolyline(north, [start, east, north]);
    expect(nearEnd.index).toBeGreaterThan(0);
    expect(nearEnd.distKm).toBeLessThan(haversineKm(north, start));

    // A tiny longitude step at the pole underflows once it is scaled, so the segment is empty.
    const pole = { lon: 0, lat: 90 };
    expect(nearestPointOnPolyline(pole, [pole, { lon: 1e-150, lat: 90 }]).point).toEqual(pole);
  });
});

describe("distanceAlongLineKm", () => {
  it("stops at the last vertex when the index is past the end", () => {
    const line = [start, north, east];
    const seg0 = haversineKm(start, north);
    const seg1 = haversineKm(north, east);
    expect(distanceAlongLineKm(line, 0, start)).toBeCloseTo(0, 5);
    expect(distanceAlongLineKm(line, 1, north)).toBeCloseTo(seg0, 5);
    expect(distanceAlongLineKm(line, 99, east)).toBeCloseTo(seg0 + seg1, 5);
  });
});

describe("bearingDeg", () => {
  it("measures clockwise from north", () => {
    expect(bearingDeg(start, north)).toBeCloseTo(0, 5);
    expect(bearingDeg(start, east)).toBeCloseTo(90, 0);
  });
});

describe("pointAlongLine", () => {
  it("walks a polyline and clamps to its ends", () => {
    expect(pointAlongLine([], 5)).toEqual({ point: { lat: 0, lon: 0 }, bearing: 0 });

    const atStart = pointAlongLine([start, start, north], -3);
    expect(atStart.point.lat).toBeCloseTo(start.lat, 5);
    expect(atStart.bearing).toBeCloseTo(0, 5);

    const mid = pointAlongLine([start, north], haversineKm(start, north) / 2);
    expect(mid.point.lat).toBeGreaterThan(start.lat);
    expect(mid.point.lat).toBeLessThan(north.lat);

    const beyond = pointAlongLine([start, north], 1000);
    expect(beyond.point).toEqual(north);
  });
});

describe("boundsAround", () => {
  it("contains points near the line and rejects far ones", () => {
    const box = boundsAround([start, north], 1);
    expect(box.contains(start)).toBe(true);
    expect(box.contains({ lon: start.lon, lat: start.lat - 5 })).toBe(false);
    expect(box.contains({ lon: start.lon, lat: start.lat + 5 })).toBe(false);
    expect(box.contains({ lon: start.lon - 5, lat: start.lat })).toBe(false);
    expect(box.contains({ lon: start.lon + 5, lat: start.lat })).toBe(false);
  });
});

describe("sampleLine", () => {
  it("returns a short line as-is and steps along a long one", () => {
    expect(sampleLine([])).toEqual([]);
    expect(sampleLine([start])).toEqual([start]);
    const near = { lon: start.lon + 0.00001, lat: start.lat };
    expect(sampleLine([start, near])).toEqual([start, near]);
    const sampled = sampleLine([start, north], 0.4);
    expect(sampled.length).toBeGreaterThan(2);
    expect(sampled[0]).toEqual(start);
    expect(sampled.at(-1)).toEqual(north);
  });
});
