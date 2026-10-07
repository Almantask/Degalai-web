import maplibregl from "maplibre-gl";
import type { DailyPrices, FuelType, Station, UserSettings } from "./types.ts";
import { LT_BOUNDS, LT_CENTER } from "./types.ts";
import type { LngLat } from "./geo.ts";
import { formatMoney, formatPrice, formatPriceNumber, escapeHtml } from "./format.ts";
import { brandLabel, chargerBrandLabel, t } from "./i18n/index.ts";

const SOURCE = "stations";
const CLUSTER = "stations-clusters";
const CLUSTER_COUNT = "stations-cluster-count";
const HALO = "stations-halo";
const POINTS = "stations-points";
const LABELS = "stations-labels";
const ROUTE_LABELS = "stations-route-labels";
const ROUTE = "route-line";
const ROUTE_SRC = "route";
const DETOUR_SRC = "detours";
const DETOUR = "detours-line";
const OPTIONS_SRC = "route-options";
const OPTIONS = "route-options-line";
const OPTIONS_HIT = "route-options-hit";

/** Route choices while picking, best first; the main route keeps the first color. */
export const ROUTE_OPTION_COLORS = ["#1b6b3a", "#2563eb", "#b45309"] as const;
/** Routes not taken, once one is picked. */
const ROUTE_OPTION_MUTED = "#6b7280";

/** Marker colors for stations on an active route — contrast with the green path. */
export const ROUTE_MARKER = {
  pick: "#facc15",
  pickHalo: "#fde047",
  on: "#ea580c",
  onHalo: "#fdba74",
  detour: "#4f46e5",
  detourHalo: "#a5b4fc",
} as const;

export type Emphasis = "high" | "normal" | "low" | "dim" | "pick";

export function routeStationEmphasis(kind: "on" | "detour", isCheapestOn: boolean): Emphasis {
  if (kind === "on" && isCheapestOn) return "pick";
  return kind === "on" ? "high" : "low";
}

export interface MapHandlers {
  onStationClick: (id: string) => void;
  onMapClick: (ll: LngLat) => void;
  /** A route choice (its index) was tapped on the map. */
  onRouteClick: (index: number) => void;
}

const geolocateByMap = new WeakMap<
  maplibregl.Map,
  { control: maplibregl.GeolocateControl; highAccuracy: boolean }
>();

export function createMap(
  container: HTMLElement,
  handlers: MapHandlers,
  enableHighAccuracy = true,
): maplibregl.Map {
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
  addGeolocateControl(map, enableHighAccuracy);

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
    map.addSource(OPTIONS_SRC, { type: "geojson", data: emptyFc() });

    map.addLayer({
      id: OPTIONS,
      type: "line",
      source: OPTIONS_SRC,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": ["case", ["get", "picking"], 5, 4],
        "line-opacity": ["case", ["get", "picking"], 0.85, 0.45],
      },
    });
    // Wide and invisible, so a finger can hit a thin line.
    map.addLayer({
      id: OPTIONS_HIT,
      type: "line",
      source: OPTIONS_SRC,
      paint: { "line-color": "#000", "line-width": 22, "line-opacity": 0 },
    });

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
        "line-color": ROUTE_MARKER.detour,
        "line-width": 3,
        "line-dasharray": [2, 2],
        "line-opacity": 0.85,
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
      id: HALO,
      type: "circle",
      source: SOURCE,
      filter: [
        "all",
        ["!", ["has", "point_count"]],
        ["in", ["get", "emphasis"], ["literal", ["pick", "high", "low"]]],
      ],
      paint: {
        "circle-radius": [
          "case",
          ["==", ["get", "emphasis"], "pick"],
          18,
          ["==", ["get", "emphasis"], "high"],
          15,
          12,
        ],
        "circle-color": [
          "case",
          ["==", ["get", "emphasis"], "pick"],
          ROUTE_MARKER.pickHalo,
          ["==", ["get", "emphasis"], "high"],
          ROUTE_MARKER.onHalo,
          ROUTE_MARKER.detourHalo,
        ],
        "circle-opacity": 0.45,
        "circle-blur": 0.15,
      },
    });
    map.addLayer({
      id: POINTS,
      type: "circle",
      source: SOURCE,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": [
          "case",
          ["==", ["get", "emphasis"], "pick"],
          12,
          ["==", ["get", "emphasis"], "high"],
          10,
          ["==", ["get", "emphasis"], "low"],
          8,
          7,
        ],
        "circle-color": [
          "case",
          ["==", ["get", "hasPrice"], 0],
          "#9ca3af",
          ["==", ["get", "emphasis"], "pick"],
          ROUTE_MARKER.pick,
          ["==", ["get", "emphasis"], "high"],
          ROUTE_MARKER.on,
          ["==", ["get", "emphasis"], "low"],
          ROUTE_MARKER.detour,
          ["interpolate", ["linear"], ["get", "pct"], 0, "#15803d", 0.5, "#ca8a04", 1, "#b91c1c"],
        ],
        "circle-stroke-width": [
          "case",
          ["==", ["get", "emphasis"], "pick"],
          3,
          ["==", ["get", "emphasis"], "high"],
          2.5,
          ["==", ["get", "emphasis"], "low"],
          2,
          1.5,
        ],
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
        ["==", ["get", "emphasis"], "normal"],
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
    map.addLayer({
      id: ROUTE_LABELS,
      type: "symbol",
      source: SOURCE,
      filter: [
        "all",
        ["!", ["has", "point_count"]],
        ["==", ["get", "hasPrice"], 1],
        ["in", ["get", "emphasis"], ["literal", ["pick", "high", "low"]]],
      ],
      layout: {
        "text-field": ["get", "priceLabel"],
        "text-size": ["case", ["==", ["get", "emphasis"], "pick"], 13, 12],
        "text-offset": [0, 1.35],
        "text-font": ["Noto Sans Regular"],
        "text-optional": true,
      },
      paint: {
        "text-color": [
          "case",
          ["==", ["get", "emphasis"], "pick"],
          "#854d0e",
          ["==", ["get", "emphasis"], "high"],
          "#9a3412",
          "#3730a3",
        ],
        "text-halo-color": "#fff",
        "text-halo-width": 1.6,
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
  map.on("click", OPTIONS_HIT, (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: [POINTS, HALO, CLUSTER] }).length) return;
    const index = e.features?.[0]?.properties?.index;
    if (typeof index === "number") handlers.onRouteClick(index);
  });
  map.on("mouseenter", OPTIONS_HIT, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", OPTIONS_HIT, () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("click", (e) => {
    const hits = map.queryRenderedFeatures(e.point, {
      layers: [POINTS, HALO, CLUSTER, OPTIONS_HIT],
    });
    if (hits.length) return;
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

function addGeolocateControl(map: maplibregl.Map, enableHighAccuracy: boolean): void {
  const prev = geolocateByMap.get(map);
  if (prev) map.removeControl(prev.control);
  const control = new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy },
    showUserLocation: true,
  });
  map.addControl(control, "top-right");
  geolocateByMap.set(map, { control, highAccuracy: enableHighAccuracy });
}

/** Recreate the locate control so the next GPS request uses the chosen accuracy. */
export function setMapGeolocateAccuracy(map: maplibregl.Map, enableHighAccuracy: boolean): void {
  const prev = geolocateByMap.get(map);
  if (prev?.highAccuracy === enableHighAccuracy) return;
  addGeolocateControl(map, enableHighAccuracy);
}

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
  const excluded = new Set(fuel === "EV" ? settings.excludedEvBrands : settings.excludedBrands);
  const priced = stations
    .map((s) => ({ s, price: prices?.prices[s.id]?.[fuel]?.price }))
    .filter(({ s, price }) => {
      if (excluded.has(s.brand)) return false;
      // Most chargers have no published price; hiding them would empty the EV map.
      if (price == null && settings.hideUnpriced && fuel !== "EV") return false;
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
        priceLabel:
          price == null
            ? ""
            : fuel === "EV" && price === 0
              ? t("units.free")
              : formatPriceNumber(price),
        emphasis: emp,
      },
    };
  });
  src.setData({ type: "FeatureCollection", features });
  map.getContainer().dataset.stationCount = String(features.length);
}

export function setRouteData(
  map: maplibregl.Map,
  line: LngLat[] | null,
  detours: LngLat[][] = [],
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
      features: detours
        .filter((pts) => pts.length >= 2)
        .map((pts) => ({
          type: "Feature" as const,
          properties: {},
          geometry: {
            type: "LineString" as const,
            coordinates: pts.map((p) => [p.lon, p.lat] as [number, number]),
          },
        })),
    });
  }
}

/**
 * Route choices: each in its own color while the driver picks (`chosen` null), then the ones not
 * taken in grey. Either way a tap on one picks it.
 */
export function setRouteOptions(
  map: maplibregl.Map,
  routes: LngLat[][],
  chosen: number | null,
): void {
  const src = map.getSource(OPTIONS_SRC) as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  const picking = chosen == null;
  const features = routes
    .map((pts, index) => ({ pts, index }))
    .filter(({ pts, index }) => index !== chosen && pts.length >= 2)
    // Draw the best route last so it stays on top where routes share a road.
    .reverse()
    .map(({ pts, index }) => ({
      type: "Feature" as const,
      properties: {
        index,
        picking,
        color: picking
          ? ROUTE_OPTION_COLORS[index % ROUTE_OPTION_COLORS.length]
          : ROUTE_OPTION_MUTED,
      },
      geometry: {
        type: "LineString" as const,
        coordinates: pts.map((p) => [p.lon, p.lat] as [number, number]),
      },
    }));
  src.setData({ type: "FeatureCollection", features });
}

function routeBounds(
  line: LngLat[] | null,
  detours: LngLat[][] = [],
): maplibregl.LngLatBounds | null {
  const bounds = new maplibregl.LngLatBounds();
  let hasPoint = false;
  const extend = (pts: LngLat[]) => {
    for (const p of pts) {
      bounds.extend([p.lon, p.lat]);
      hasPoint = true;
    }
  };
  if (line?.length) extend(line);
  for (const pts of detours) extend(pts);
  return hasPoint ? bounds : null;
}

/** Padding so a fit leaves the collapsed header and list grabbers clear. */
export function overlayPadding(
  headerH: number,
  listH: number,
  gap = 12,
): maplibregl.PaddingOptions {
  const edge = 24;
  return {
    top: Math.max(edge, Math.round(headerH) + gap),
    bottom: Math.max(edge, Math.round(listH) + gap),
    left: edge,
    right: edge,
  };
}

type Box = Pick<DOMRect, "top" | "bottom" | "left" | "right" | "width" | "height">;

/**
 * Padding that keeps a fit clear of the header and an open list: beside the map when the list
 * is a panel on the right (wide screens), above it when it is a bottom sheet.
 */
export function openListPadding(
  mapBox: Box,
  headerBox: Box | null,
  listBox: Box | null,
  gap = 12,
): maplibregl.PaddingOptions {
  const edge = 24;
  const pad = { top: edge, bottom: edge, left: edge, right: edge };
  if (headerBox && headerBox.height > 0) {
    pad.top = Math.max(edge, Math.round(headerBox.bottom - mapBox.top) + gap);
  }
  if (listBox && listBox.height > 0) {
    if (listBox.left > mapBox.left + mapBox.width / 2) {
      pad.right = Math.max(edge, Math.round(mapBox.right - listBox.left) + gap);
    } else {
      pad.bottom = Math.max(edge, Math.round(mapBox.bottom - listBox.top) + gap);
    }
  }
  return pad;
}

export function fitRoute(
  map: maplibregl.Map,
  line: LngLat[] | null,
  detours: LngLat[][] = [],
  padding: maplibregl.PaddingOptions = overlayPadding(64, 64),
): void {
  const bounds = routeBounds(line, detours);
  if (bounds) map.fitBounds(bounds, { padding, maxZoom: 12 });
}

/** When a route is active, only those stations appear on the map. */
export function stationsForRouteMap<T extends { id: string }>(
  stations: T[],
  routeStationIds: ReadonlySet<string> | null,
): T[] {
  if (!routeStationIds) return stations;
  return stations.filter((s) => routeStationIds.has(s.id));
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

export function flyToStation(
  map: maplibregl.Map,
  s: Station,
  padding: maplibregl.PaddingOptions = overlayPadding(64, 64),
): void {
  const bounds = new maplibregl.LngLatBounds([s.lon, s.lat], [s.lon, s.lat]);
  map.fitBounds(bounds, { padding, maxZoom: 14 });
}

export interface StationPopupExtra {
  distLabel?: string;
}

export function stationPopupHtml(
  s: Station,
  prices: DailyPrices | null,
  extra?: StationPopupExtra,
): string {
  const fuels = (s.ev ? (["EV"] as FuelType[]) : (["95", "D", "LPG"] as FuelType[]))
    .map((f) => {
      const e = prices?.prices[s.id]?.[f];
      const price = e ? formatPrice(e.price, f) : t("popup.noPrice");
      const flags = [e?.stale ? t("popup.stale") : "", e?.suspicious ? t("popup.suspicious") : ""]
        .filter(Boolean)
        .join(" · ");
      const reason = f === "EV" && e?.price === 0 ? escapeHtml(freeReasonText(s)) : "";
      // "?" shows the reason as a hover title, and below the row on tap or keyboard focus
      // (app.ts toggles aria-expanded).
      const why = reason
        ? `<button type="button" class="free-why-btn" data-act="free-why" aria-expanded="false" aria-controls="free-why-tip" aria-label="${escapeHtml(t("popup.freeWhy"))}" title="${reason}">?</button>`
        : "";
      const tip = reason
        ? `<p class="free-why-tip" id="free-why-tip" role="tooltip">${reason}</p>`
        : "";
      return `<div class="popup-row"><span>${escapeHtml(t(`fuel.${f}` as "fuel.D"))}</span><strong>${escapeHtml(price)}${why}</strong>${flags ? `<small>${escapeHtml(flags)}</small>` : ""}</div>${tip}`;
    })
    .join("");
  const addr = s.address || s.city || t("list.addressMissing");
  const dist = extra?.distLabel ? `<p class="popup-eta">${escapeHtml(extra.distLabel)}</p>` : "";
  const brand = s.ev ? chargerBrandLabel(s) : brandLabel(s.brand);
  return `<div class="popup">
    <h3>${escapeHtml(s.name)}</h3>
    <p class="popup-brand">${escapeHtml(brand)}</p>
    ${addr === s.name ? "" : `<p class="popup-addr">${escapeHtml(addr)}</p>`}
    ${dist}
    ${fuels}
    ${s.ev ? chargerDetailsHtml(s, prices) : ""}
  </div>`;
}

/** Why a free charger is free, for the "?" next to its price. */
export function freeReasonText(s: Station): string {
  const free = s.ev?.free;
  if (!free || (free.reason !== "municipal" && free.reason !== "networkPaid" && !free.owner)) {
    return t("free.unknown");
  }
  return t(`free.${free.reason}`, { owner: free.owner ?? "" });
}

const SOCKET_NAMES: Record<string, string> = {
  type2: "Type 2",
  type2_cable: "Type 2",
  type2_combo: "CCS",
  chademo: "CHAdeMO",
  tesla_supercharger: "Tesla",
  type1: "Type 1",
  type1_combo: "CCS1",
  schuko: "Schuko",
  cee_blue: "CEE",
  cee_red_16a: "CEE",
  cee_red_32a: "CEE",
};

/** Socket names, each once, with the top kW when the site gives it per socket: `CCS 150 kW`. */
export function socketLabels(
  sockets: readonly string[],
  kwBySocket: Readonly<Record<string, number>> = {},
): string[] {
  const kw = new Map<string, number | undefined>();
  for (const k of sockets) {
    const label = SOCKET_NAMES[k] ?? k.replaceAll("_", " ");
    const v = kwBySocket[k];
    const prev = kw.get(label);
    if (!kw.has(label) || (v != null && (prev == null || v > prev))) kw.set(label, v);
  }
  return [...kw].map(([label, v]) => (v != null ? `${label} ${v} kW` : label));
}

function chargerDetailsHtml(s: Station, prices: DailyPrices | null): string {
  const ev = s.ev;
  if (!ev) return "";
  const labels = socketLabels(ev.sockets, ev.kwBySocket);
  // Once a socket shows the site's top power, "up to" would only repeat it.
  const maxShown = ev.sockets.some((k) => ev.kwBySocket?.[k] === ev.maxKw);
  const parts = [
    labels.join(", "),
    ev.maxKw != null && !maxShown ? t("popup.maxKw", { kw: ev.maxKw }) : "",
  ].filter(Boolean);
  const entry = prices?.prices[s.id]?.EV;
  const source = entry?.source;
  // The register's AC and DC prices differ at some sites; the headline is the cheaper one.
  const split =
    source === "via-lietuva" && ev.prices?.ac != null && ev.prices?.dc != null
      ? `AC ${formatPrice(ev.prices.ac, "EV")} · DC ${formatPrice(ev.prices.dc, "EV")}`
      : "";
  const fee =
    source === "via-lietuva" && ev.sessionFee
      ? t("popup.sessionFee", { fee: formatMoney(ev.sessionFee) })
      : "";
  const note =
    source === "via-lietuva"
      ? t("popup.register")
      : source === "osm-charge"
        ? t("popup.chargeTag")
        : source === "ev-tariff"
          ? t("popup.tariff")
          : "";
  const lines = [split, fee].filter(Boolean);
  // Register sites have `vl:` ids; anything else came from OSM alone and may be stale.
  const unregistered = !s.id.startsWith("vl:")
    ? `<p class="popup-ev-note popup-ev-warn">${escapeHtml(t("popup.notInRegister"))}</p>`
    : "";
  return `${unregistered}${lines.map((l) => `<p class="popup-ev">${escapeHtml(l)}</p>`).join("")}${parts.length ? `<p class="popup-ev"><span>${escapeHtml(t("popup.sockets"))}</span> ${escapeHtml(parts.join(" · "))}</p>` : ""}${note ? `<p class="popup-ev-note">${escapeHtml(note)}</p>` : ""}`;
}

/** Rank of `value` in ascending `sorted`: index of the first entry ≥ value, scaled to 0–1. */
export function percentile(sorted: number[], value: number): number {
  if (sorted.length === 1) return 0.5;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo / (sorted.length - 1);
}

function emptyFc(): { type: "FeatureCollection"; features: [] } {
  return { type: "FeatureCollection", features: [] };
}
