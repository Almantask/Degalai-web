import { readFileSync, existsSync } from "node:fs";
import { haversineKm } from "../src/geo.ts";
import { normalizeBrand } from "../src/brands.ts";
import type { Observation, Station } from "../src/types.ts";

const MATCH_M = 300;

export interface MatchResult {
  observations: Observation[];
  unmatched: Observation[];
  extraStations: Station[];
  sourceToStation: Record<string, string>;
}

interface OverrideStation {
  sourceStationId?: string;
  osmId?: string;
  lat?: number;
  lon?: number;
  brand?: string;
  name?: string;
}

export function loadOverrides(path: string): OverrideStation[] {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf8")) as OverrideStation[];
}

export function matchObservations(
  stations: Station[],
  observations: Observation[],
  overrides: OverrideStation[],
): MatchResult {
  const byOsm = new Map(stations.map((s) => [s.id, s]));
  const overrideBySource = new Map(
    overrides.filter((o) => o.sourceStationId).map((o) => [o.sourceStationId!, o]),
  );

  const matched: Observation[] = [];
  const unmatched: Observation[] = [];
  const extra: Station[] = [];
  const extraIds = new Set<string>();
  const sourceToStation: Record<string, string> = {};

  const grouped = groupByStation(observations);

  for (const [sourceId, group] of grouped) {
    const ov = overrideBySource.get(sourceId);
    let station: Station | undefined;
    if (ov?.osmId) station = byOsm.get(ov.osmId);

    const sample = group[0];
    if (!station) {
      station = findNearestSameBrand(stations, sample);
    }

    if (station) {
      station.sourceIds = { ...station.sourceIds, [sourceName(sourceId)]: sourceId };
      if (ov?.brand) station.brand = ov.brand;
      sourceToStation[sourceId] = station.id;
      for (const o of group) {
        if (!station.fuels.includes(o.fuel)) station.fuels.push(o.fuel);
        matched.push({ ...o, sourceStationId: station.id });
      }
      continue;
    }

    const lat = ov?.lat ?? sample.lat;
    const lon = ov?.lon ?? sample.lon;
    if (lat != null && lon != null) {
      const id = sourceId.startsWith("lea:") ? sourceId : `src:${sourceId}`;
      sourceToStation[sourceId] = id;
      if (!extraIds.has(id)) {
        extraIds.add(id);
        extra.push({
          id,
          name: ov?.name || sample.name || sample.brand,
          brand: ov?.brand || normalizeBrand(sample.brand, sample.name),
          lat,
          lon,
          address: sample.address,
          city: sample.city,
          fuels: [...new Set(group.map((g) => g.fuel))],
          sourceIds: { [sourceName(sourceId)]: sourceId },
        });
      }
      for (const o of group) matched.push({ ...o, sourceStationId: id });
    } else {
      unmatched.push(...group);
    }
  }

  return { observations: matched, unmatched, extraStations: extra, sourceToStation };
}

function groupByStation(observations: Observation[]): Map<string, Observation[]> {
  const m = new Map<string, Observation[]>();
  for (const o of observations) {
    const list = m.get(o.sourceStationId) ?? [];
    list.push(o);
    m.set(o.sourceStationId, list);
  }
  return m;
}

function findNearestSameBrand(stations: Station[], sample: Observation): Station | undefined {
  if (sample.lat == null || sample.lon == null) return undefined;
  const brand = normalizeBrand(sample.brand, sample.name);
  let best: Station | undefined;
  let bestD = MATCH_M / 1000;
  for (const s of stations) {
    if (brand !== "independent" && s.brand !== brand) continue;
    const d = haversineKm({ lat: sample.lat, lon: sample.lon }, { lat: s.lat, lon: s.lon });
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function sourceName(sourceId: string): string {
  if (sourceId.startsWith("lea:")) return "lea";
  const i = sourceId.indexOf(":");
  return i === -1 ? "src" : sourceId.slice(0, i);
}

export function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Address+brand match when coordinates are missing. */
export function matchByAddress(stations: Station[], sample: Observation): Station | undefined {
  const brand = normalizeBrand(sample.brand, sample.name);
  const key = tokens(`${sample.city ?? ""} ${sample.address ?? ""}`);
  let best: Station | undefined;
  let bestScore = 0.45;
  for (const s of stations) {
    const score = jaccard(key, stationTokens(s));
    const brandOk = brand === "independent" || s.brand === brand || score >= 0.7;
    if (!brandOk) continue;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

const stationTokenCache = new Map<string, Set<string>>();

/** Station tokens are the same for every observation, so tokenize each station text once. */
function stationTokens(s: Station): Set<string> {
  const text = `${s.city ?? ""} ${s.address ?? ""} ${s.name}`;
  let cached = stationTokenCache.get(text);
  if (!cached) {
    cached = tokens(text);
    stationTokenCache.set(text, cached);
  }
  return cached;
}
