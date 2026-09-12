import { normalizeBrand, osmFuels } from "../src/brands.ts";
import type { Station } from "../src/types.ts";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const QUERY = `
[out:json][timeout:120];
area(3600072596)->.lt;
(
  node["amenity"="fuel"](area.lt);
  way["amenity"="fuel"](area.lt);
);
out center tags;
`.trim();

interface OverpassEl {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export async function fetchOsmStations(): Promise<Station[]> {
  let lastErr: unknown;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "KurDegalai/0.1 (https://github.com/Almantask/Degalai-web)",
        },
        body: `data=${encodeURIComponent(QUERY)}`,
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
      const json = (await res.json()) as { elements: OverpassEl[] };
      return json.elements.map(toStation).filter((s): s is Station => s !== null);
    } catch (e) {
      lastErr = e;
      console.warn(`Overpass ${url} failed:`, e);
    }
  }
  throw lastErr;
}

function toStation(el: OverpassEl): Station | null {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null) return null;
  const tags = el.tags ?? {};
  const brand = normalizeBrand(tags.brand, tags.operator, tags.name);
  const name = tags.name || tags.brand || tags.operator || displayFallback(brand);
  const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"];
  const street = tags["addr:street"];
  const housenumber = tags["addr:housenumber"];
  const address = [street && housenumber ? `${street} ${housenumber}` : street, city]
    .filter(Boolean)
    .join(", ");
  return {
    id: `osm:${el.type}:${el.id}`,
    name,
    brand,
    lat,
    lon,
    address: address || undefined,
    city: city || undefined,
    fuels: osmFuels(tags),
    sourceIds: { osm: `${el.type}/${el.id}` },
  };
}

function displayFallback(brand: string): string {
  return brand === "independent" ? "Degalinė" : brand;
}
