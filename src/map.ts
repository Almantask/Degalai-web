import maplibregl from "maplibre-gl";
import type { DailyPrices, FuelType, Station, UserSettings } from "./types.ts";
import { LT_BOUNDS, LT_CENTER } from "./types.ts";
import type { LngLat } from "./geo.ts";
import { formatPrice, escapeHtml } from "./format.ts";
import { brandLabel, t } from "./i18n/index.ts";

const SOURCE = "stations";
const CLUSTER = "stations-clusters";
const CLUSTER_COUNT = "stations-cluster-count";
const POINTS = "stations-points";
const LABELS = "stations-labels";
const ROUTE = "route-line";
const ROUTE_SRC = "route";
const DETOUR_SRC = "detours";
const DETOUR = "detours-line";

export interface MapHandlers {
  onStationClick: (id: string) => void;
  onMapClick: (ll: LngLat) => void;
}

export function createMap(container: HTMLElement, handlers: MapHandlers): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    style: "https://tiles.openfreemap.org/styles/positron",
    center: LT_CENTER,
    zoom: 7,
    maxBounds: [
      [LT_BOUNDS.minLon - 0.3, LT_BOUNDS.minLat - 0.3],
      [LT_BOUNDS.maxLon + 0.3, LT_BOUNDS.maxLat + 0.3],
    ],
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(
    new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      showUserLocation: true,
    }),
    "bottom-left",
  );

  map.on("load", () => {
    map.addSource(SOURCE, {
      type: "geojson",
      data: emptyFc(),
      cluster: true,
      clusterMaxZoom: 11,
      clusterRadius: 48,
      clusterProperties: {
        minPrice: ["min", ["coalesce", ["get", "price"], 99]],
      },
    });
    map.addSource(ROUTE_SRC, { type: "geojson", data: emptyFc() });
    map.addSource(DETOUR_SRC, { type: "geojson", data: emptyFc() });

    map.addLayer({
      id: ROUTE,
      type: "line",
      source: ROUTE_SRC,
      paint: {
        "line-color": "#1b6b3a",
        "line-width": 4,
        "line-opacity": 0.9,
      },
    });
    map.addLayer({
      id: DETOUR,
      type: "line",
      source: DETOUR_SRC,
      paint: {
        "line-color": "#6b7280",
        "line-width": 2,
        "line-dasharray": [2, 2],
        "line-opacity": 0.8,
      },
    });
    map.addLayer({
      id: CLUSTER,
      type: "circle",
      source: SOURCE,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": "#1b6b3a",
        "circle-radius": ["step", ["get", "point_count"], 16, 20, 20, 100, 26],
        "circle-opacity": 0.85,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#fff",
      },
    });
    map.addLayer({
      id: CLUSTER_COUNT,
      type: "symbol",
      source: SOURCE,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-size": 12,
        "text-font": ["Noto Sans Regular"],
      },
      paint: { "text-color": "#fff" },
    });
    map.addLayer({
      id: POINTS,
      type: "circle",
      source: SOURCE,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": [
          "case",
          ["==", ["get", "emphasis"], "high"],
          9,
          ["==", ["get", "emphasis"], "low"],
          5,
          7,
        ],
        "circle-color": [
          "case",
          ["==", ["get", "hasPrice"], 0],
          "#9ca3af",
          ["interpolate", ["linear"], ["get", "pct"], 0, "#15803d", 0.5, "#ca8a04", 1, "#b91c1c"],
        ],
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#fff",
        "circle-opacity": ["case", ["==", ["get", "emphasis"], "dim"], 0.15, 0.95],
      },
    });
    map.addLayer({
      id: LABELS,
      type: "symbol",
      source: SOURCE,
      minzoom: 9,
      filter: [
        "all",
        ["!", ["has", "point_count"]],
        ["==", ["get", "hasPrice"], 1],
        ["in", ["get", "emphasis"], ["literal", ["high", "normal"]]],
      ],
      layout: {
        "text-field": ["get", "priceLabel"],
        "text-size": 11,
        "text-offset": [0, 1.1],
        "text-font": ["Noto Sans Regular"],
        "text-optional": true,
      },
      paint: {
        "text-color": "#111827",
        "text-halo-color": "#fff",
        "text-halo-width": 1.2,
      },
    });
  });

  map.on("click", POINTS, (e) => {
    const id = e.features?.[0]?.properties?.id as string | undefined;
    if (id) handlers.onStationClick(id);
  });
  map.on("click", CLUSTER, (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const src = map.getSource(SOURCE) as maplibregl.GeoJSONSource;
    const clusterId = Number(feature.properties?.cluster_id);
    const geom = feature.geometry;
    if (geom.type !== "Point") return;
    void src.getClusterExpansionZoom(clusterId).then((zoom) => {
      map.easeTo({ center: geom.coordinates as [number, number], zoom });
    });
  });
  map.on("click", (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: [POINTS, CLUSTER] }).length) return;
    handlers.onMapClick({ lon: e.lngLat.lng, lat: e.lngLat.lat });
  });
  map.on("mouseenter", POINTS, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", POINTS, () => {
    map.getCanvas().style.cursor = "";
  });

  return map;
}

export type Emphasis = "high" | "normal" | "low" | "dim";

export function setStationData(
  map: maplibregl.Map,
  stations: Station[],
  prices: DailyPrices | null,
  fuel: FuelType,
  settings: UserSettings,
  emphasis?: Record<string, Emphasis>,
): void {
  const src = map.getSource(SOURCE) as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  const priced = stations
    .map((s) => ({ s, price: prices?.prices[s.id]?.[fuel]?.price }))
    .filter(({ s, price }) => {
      if (price == null && settings.hideUnpriced) return false;
      if (price == null && !s.fuels.includes(fuel)) return false;
      return true;
    });
  const values = priced
    .map((p) => p.price)
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b);
  const features = priced.map(({ s, price }) => {
    const pct = price == null || values.length === 0 ? 0.5 : percentile(values, price);
    const emp = emphasis?.[s.id] ?? "normal";
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        brand: s.brand,
        price: price ?? null,
        hasPrice: price == null ? 0 : 1,
        pct,
        priceLabel: price == null ? "" : formatPrice(price).replace(" €/l", "").replace("€", ""),
        emphasis: emp,
      },
    };
  });
  src.setData({ type: "FeatureCollection", features });
}

export function setRouteData(
  map: maplibregl.Map,
  line: LngLat[] | null,
  detours: Array<[LngLat, LngLat]> = [],
): void {
  const routeSrc = map.getSource(ROUTE_SRC) as maplibregl.GeoJSONSource | undefined;
  const detourSrc = map.getSource(DETOUR_SRC) as maplibregl.GeoJSONSource | undefined;
  if (routeSrc) {
    routeSrc.setData(
      line && line.length
        ? {
            type: "FeatureCollection",
            features: [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: line.map((p) => [p.lon, p.lat]) },
              },
            ],
          }
        : emptyFc(),
    );
  }
  if (detourSrc) {
    detourSrc.setData({
      type: "FeatureCollection",
      features: detours.map(([a, b]) => ({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            [a.lon, a.lat],
            [b.lon, b.lat],
          ],
        },
      })),
    });
  }
  if (line && line.length) {
    const bounds = new maplibregl.LngLatBounds();
    for (const p of line) bounds.extend([p.lon, p.lat]);
    map.fitBounds(bounds, { padding: 64, maxZoom: 12 });
  }
}

/** Stations whose coordinates fall inside the current map viewport. */
export function stationsInView<T extends { lat: number; lon: number }>(
  map: maplibregl.Map,
  stations: T[],
): T[] {
  let bounds: maplibregl.LngLatBounds;
  try {
    bounds = map.getBounds();
  } catch {
    return stations;
  }
  return stations.filter((s) => bounds.contains([s.lon, s.lat]));
}

export function flyToStation(map: maplibregl.Map, s: Station): void {
  map.easeTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 13) });
}

export interface StationPopupExtra {
  etaLabel?: string;
}

export function stationPopupHtml(
  s: Station,
  prices: DailyPrices | null,
  extra?: StationPopupExtra,
): string {
  const fuels = (["95", "98", "D", "LPG"] as FuelType[])
    .map((f) => {
      const e = prices?.prices[s.id]?.[f];
      const price = e ? formatPrice(e.price) : t("popup.noPrice");
      const flags = [e?.stale ? t("popup.stale") : "", e?.suspicious ? t("popup.suspicious") : ""]
        .filter(Boolean)
        .join(" · ");
      return `<div class="popup-row"><span>${escapeHtml(t(`fuel.${f}` as "fuel.D"))}</span><strong>${escapeHtml(price)}</strong>${flags ? `<small>${escapeHtml(flags)}</small>` : ""}</div>`;
    })
    .join("");
  const nav = `https://www.openstreetmap.org/directions?from=&to=${s.lat}%2C${s.lon}`;
  const updated = prices?.generatedAt ? `${t("popup.updated")}: ${escapeHtml(prices.date)}` : "";
  const addr = s.address || s.city || t("list.addressMissing");
  const eta = extra?.etaLabel ? `<p class="popup-eta">${escapeHtml(extra.etaLabel)}</p>` : "";
  return `<div class="popup">
    <h3>${escapeHtml(s.name)}</h3>
    <p class="popup-brand">${escapeHtml(brandLabel(s.brand))}</p>
    <p class="popup-addr">${escapeHtml(addr)}</p>
    ${eta}
    ${fuels}
    <p class="popup-meta">${updated}</p>
    <a class="popup-nav" href="${nav}" target="_blank" rel="noreferrer">${escapeHtml(t("action.navigate"))}</a>
  </div>`;
}

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 1) return 0.5;
  let i = 0;
  while (i < sorted.length && sorted[i] < value) i++;
  return i / (sorted.length - 1);
}

function emptyFc(): { type: "FeatureCollection"; features: [] } {
  return { type: "FeatureCollection", features: [] };
}
