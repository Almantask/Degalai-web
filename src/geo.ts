export interface LngLat {
  lon: number;
  lat: number;
}

const EARTH_KM = 6371;

export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function roadDistanceKm(a: LngLat, b: LngLat, roadFactor: number): number {
  return haversineKm(a, b) * roadFactor;
}

/** Shortest distance from a point to a polyline (km). */
export function distanceToPolylineKm(point: LngLat, line: LngLat[]): number {
  if (line.length === 0) return Infinity;
  if (line.length === 1) return haversineKm(point, line[0]);
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    min = Math.min(min, distanceToSegmentKm(point, line[i], line[i + 1]));
  }
  return min;
}

export function nearestPointOnPolyline(point: LngLat, line: LngLat[]): { point: LngLat; distKm: number; index: number } {
  if (line.length === 0) return { point, distKm: Infinity, index: 0 };
  let best = { point: line[0], distKm: haversineKm(point, line[0]), index: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const proj = projectOnSegment(point, line[i], line[i + 1]);
    const d = haversineKm(point, proj);
    if (d < best.distKm) best = { point: proj, distKm: d, index: i };
  }
  return best;
}

export function distanceAlongLineKm(line: LngLat[], upToIndex: number, upTo: LngLat): number {
  let d = 0;
  for (let i = 0; i < upToIndex && i < line.length - 1; i++) {
    d += haversineKm(line[i], line[i + 1]);
  }
  if (upToIndex < line.length) d += haversineKm(line[Math.min(upToIndex, line.length - 1)], upTo);
  return d;
}

/** Heading from a to b in degrees clockwise from north. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** The point `km` along a polyline, clamped to its ends, with the heading of travel there. */
export function pointAlongLine(line: LngLat[], km: number): { point: LngLat; bearing: number } {
  if (line.length === 0) return { point: { lat: 0, lon: 0 }, bearing: 0 };
  let left = Math.max(0, km);
  let last: { point: LngLat; bearing: number } = { point: line[0], bearing: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const seg = haversineKm(a, b);
    if (seg === 0) continue;
    const bearing = bearingDeg(a, b);
    if (left <= seg) {
      const t = left / seg;
      const point = { lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t };
      return { point, bearing };
    }
    left -= seg;
    last = { point: b, bearing };
  }
  return last;
}

/** A box around a polyline, widened by `km`, to skip points that cannot be that close to it. */
export function boundsAround(line: LngLat[], km: number): { contains: (p: LngLat) => boolean } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const p of line) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon);
    maxLon = Math.max(maxLon, p.lon);
  }
  const dLat = km / 111;
  const dLon = km / (111 * Math.cos(toRad(Math.max(Math.abs(minLat), Math.abs(maxLat)))));
  return {
    contains: (p) =>
      p.lat >= minLat - dLat &&
      p.lat <= maxLat + dLat &&
      p.lon >= minLon - dLon &&
      p.lon <= maxLon + dLon,
  };
}

function distanceToSegmentKm(p: LngLat, a: LngLat, b: LngLat): number {
  return haversineKm(p, projectOnSegment(p, a, b));
}

function projectOnSegment(p: LngLat, a: LngLat, b: LngLat): LngLat {
  const ax = a.lon;
  const ay = a.lat;
  const dx = b.lon - ax;
  const dy = b.lat - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return a;
  // Local equirectangular scale so lon/lat projection is less distorted.
  const latScale = Math.cos(toRad((a.lat + b.lat) / 2));
  const pdx = (p.lon - ax) * latScale;
  const pdy = p.lat - ay;
  const sdx = dx * latScale;
  const sdy = dy;
  const slen2 = sdx * sdx + sdy * sdy;
  if (slen2 === 0) return a;
  const t = Math.max(0, Math.min(1, (pdx * sdx + pdy * sdy) / slen2));
  return { lon: ax + dx * t, lat: ay + dy * t };
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function inLithuania(p: LngLat): boolean {
  return p.lat >= 53.88 && p.lat <= 56.46 && p.lon >= 20.84 && p.lon <= 26.84;
}

export function sampleLine(line: LngLat[], everyKm = 0.2): LngLat[] {
  if (line.length < 2) return line.slice();
  const out: LngLat[] = [line[0]];
  let leftover = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const seg = haversineKm(a, b);
    let d = leftover;
    while (d + everyKm <= seg) {
      d += everyKm;
      const t = d / seg;
      out.push({ lon: a.lon + (b.lon - a.lon) * t, lat: a.lat + (b.lat - a.lat) * t });
    }
    leftover = seg - d;
  }
  out.push(line[line.length - 1]);
  return out;
}
