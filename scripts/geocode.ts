import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { LT_BOUNDS } from "../src/types.ts";

export interface GeocodeHit {
  lat: number;
  lon: number;
  label: string;
}

export async function loadGeocodeCache(path: string): Promise<Map<string, GeocodeHit | null>> {
  if (!existsSync(path)) return new Map();
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, GeocodeHit | null>;
  return new Map(Object.entries(raw));
}

export function saveGeocodeCache(path: string, cache: Map<string, GeocodeHit | null>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(Object.fromEntries(cache), null, 2)}\n`);
}

export async function geocodePhoton(
  query: string,
  lang: "lt" | "en" = "lt",
  retries = 3,
): Promise<GeocodeHit | null> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("lang", lang === "lt" ? "default" : lang);
  url.searchParams.set("limit", "1");
  url.searchParams.set(
    "bbox",
    `${LT_BOUNDS.minLon},${LT_BOUNDS.minLat},${LT_BOUNDS.maxLon},${LT_BOUNDS.maxLat}`,
  );
  const res = await fetch(url, {
    headers: { "User-Agent": "KurDegalai/0.1 (https://github.com/Almantask/Degalai-web)" },
  });
  if (res.status === 429) {
    if (retries <= 0) return null;
    await sleep(2000);
    return geocodePhoton(query, lang, retries - 1);
  }
  if (!res.ok) return null;
  const json = (await res.json()) as {
    features?: Array<{ geometry: { coordinates: [number, number] }; properties: { name?: string; city?: string; street?: string } }>;
  };
  const f = json.features?.[0];
  if (!f) return null;
  const [lon, lat] = f.geometry.coordinates;
  const label = [f.properties.name, f.properties.street, f.properties.city].filter(Boolean).join(", ");
  return { lat, lon, label };
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
