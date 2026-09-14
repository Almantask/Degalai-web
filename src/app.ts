import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { extraMinutesFromKm, netBenefit } from "./calc.ts";
import { loadAppData, type AppData } from "./data.ts";
import {
  formatDate,
  formatDateTime,
  formatKm,
  formatMoney,
  formatPrice,
  escapeHtml,
} from "./format.ts";
import {
  distanceAlongLineKm,
  distanceToPolylineKm,
  inLithuania,
  nearestPointOnPolyline,
  roadDistanceKm,
  type LngLat,
} from "./geo.ts";
import {
  fuelGroupOf,
  FUEL_BY_GROUP,
  setLocale,
  t,
  tPlural,
  type Locale,
  type MessageKey,
} from "./i18n/index.ts";
import {
  createMap,
  fitRoute,
  flyToStation,
  overlayPadding,
  setRouteData,
  setStationData,
  stationPopupHtml,
  stationsForRouteMap,
  stationsInView,
  routeStationEmphasis,
} from "./map.ts";
import { CHEAP_VIA_CORRIDOR_KM, orderRouteRows, topCheapStations } from "./route-list.ts";
import { hrefFor, navigate, parsePath, pathFor, type View } from "./router.ts";
import { fetchRoute, geocode, reverseGeocode, type GeoHit, type RouteResult } from "./routing.ts";
import DOMPurify from "dompurify";
import { fuelFromUrl, loadSettings, saveSettings } from "./settings.ts";
import {
  SHEET_COMPACT_MQ,
  isSheetDrag,
  sheetDragTranslate,
  sheetFromDrag,
  type MinimizeSign,
} from "./sheet-gesture.ts";
import type { Station } from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";

const DONATE_URL = "https://github.com/sponsors/Almantask";

/** Price-delta savings only — user consumption and time value stay out of ranking. */
function priceBenefit(baselinePrice: number, stationPrice: number): ReturnType<typeof netBenefit> {
  return netBenefit({
    baselinePrice,
    stationPrice,
    litres: DEFAULT_SETTINGS.litres,
    extraKm: 0,
    extraMin: 0,
    consumptionLPer100km: 0,
    timeValueEurH: 0,
  });
}

interface RouteStationRow {
  station: Station;
  price: number;
  kind: "on" | "detour";
  distFromStartKm: number;
  extraKm: number;
  extraMin: number;
  benefit: ReturnType<typeof netBenefit>;
  viaGeometry?: LngLat[];
}

type DestStatus = "idle" | "locating" | "routing" | "denied" | "not-found";

export async function startApp(root: HTMLElement): Promise<void> {
  const settings = loadSettings();
  const parsed = parsePath();
  let locale: Locale = parsed.locale;
  setLocale(locale);
  const urlFuel = fuelFromUrl(window.location.search);
  if (urlFuel) settings.fuel = urlFuel;

  let view: View = parsed.view;
  const data: AppData = await loadAppData();
  let userLocation: LngLat | null = null;
  let pickMode: "dest-start" | null = null;
  let settingsOpen = false;
  let listMinimized = false;
  let headerMinimized = false;
  let routeRows: RouteStationRow[] = [];
  let routeLine: RouteResult | null = null;
  let startHit: GeoHit | null = null;
  let startQuery = "";
  let startIsGps = true;
  let endHit: GeoHit | null = null;
  let destQuery = "";
  let destStatus: DestStatus = "idle";
  let pendingDest = false;
  let popup: maplibregl.Popup | null = null;
  let locateStatus: "idle" | "pending" | "denied" | "outside" = "idle";
  let startMarker: maplibregl.Marker | null = null;
  let endMarker: maplibregl.Marker | null = null;

  root.innerHTML = shellHtml();
  const mapDiv = root.querySelector<HTMLElement>("#map")!;
  const map = createMap(mapDiv, {
    onStationClick: (id) => openStation(id),
    onMapClick: (ll) => handleMapPick(ll),
  });

  map.on("load", () => {
    refreshMap();
    render();
  });
  map.on("moveend", () => renderList());
  window.addEventListener("resize", () => syncMapControls());

  window.addEventListener("popstate", () => {
    const next = parsePath();
    view = next.view;
    locale = next.locale;
    setLocale(locale);
    const f = fuelFromUrl(window.location.search);
    if (f) settings.fuel = f;
    render();
    refreshMap();
  });

  bind();
  requestLocation(false);
  render();

  function bind(): void {
    let skipSheetClick = false;
    root.addEventListener(
      "click",
      (e) => {
        if (!skipSheetClick) return;
        skipSheetClick = false;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
    root.addEventListener("pointerdown", (e) => {
      if (!window.matchMedia(SHEET_COMPACT_MQ).matches) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const target = e.target as HTMLElement;
      const headerHandle = target.closest<HTMLElement>(".header-toggle");
      const listHandle = target.closest<HTMLElement>(".list-head");
      if (headerHandle) startSheetDrag(e, "header", headerHandle);
      else if (listHandle) startSheetDrag(e, "list", listHandle);
    });

    function startSheetDrag(e: PointerEvent, kind: "header" | "list", handle: HTMLElement): void {
      const el =
        kind === "header"
          ? root.querySelector<HTMLElement>("#header")
          : root.querySelector<HTMLElement>("#list");
      if (!el) return;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* capture is optional; window listeners still track the drag */
      }
      const startY = e.clientY;
      const startX = e.clientX;
      const wasMin = kind === "header" ? headerMinimized : listMinimized;
      const sign: MinimizeSign = kind === "header" ? -1 : 1;
      let dragging = false;
      const onMove = (ev: PointerEvent) => {
        const dy = ev.clientY - startY;
        const dx = ev.clientX - startX;
        if (!dragging) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (!isSheetDrag(dx, dy)) {
            finish(ev, false);
            return;
          }
          dragging = true;
          el.classList.add("is-dragging");
        }
        ev.preventDefault();
        el.style.transform = `translateY(${sheetDragTranslate(dy, sign, wasMin)}px)`;
      };
      const finish = (ev: PointerEvent, apply = true) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        try {
          if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
        el.style.transform = "";
        el.classList.remove("is-dragging");
        if (!apply || !dragging) return;
        skipSheetClick = true;
        window.setTimeout(() => {
          skipSheetClick = false;
        }, 0);
        const next = sheetFromDrag(ev.clientY - startY, sign, wasMin);
        if (kind === "header") {
          headerMinimized = next;
          applyHeaderMinimized();
        } else if (next !== listMinimized) {
          listMinimized = next;
          renderList();
        }
      };
      const onUp = (ev: PointerEvent) => finish(ev, true);
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    }

    root.addEventListener("click", (e) => {
      const tEl = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!tEl) return;
      const act = tEl.dataset.act;
      if (act === "view" || act === "locale") e.preventDefault();
      if (act === "view") {
        view = "map";
        navigate(view, locale, settings.fuel);
        render();
      } else if (act === "locale") {
        const loc = tEl.dataset.locale as Locale;
        locale = loc;
        setLocale(loc);
        settings.locale = loc;
        saveSettings(settings);
        navigate(view, loc, settings.fuel);
        document.documentElement.lang = loc;
        updateHreflang();
        render();
        refreshMap();
      } else if (act === "fuel-group") {
        const g = tEl.dataset.group as "diesel" | "petrol" | "gas";
        settings.fuel = FUEL_BY_GROUP[g][0];
        persistFuel();
        onFuelChange();
      } else if (act === "settings") {
        settingsOpen = !settingsOpen;
        render();
      } else if (act === "close-panel") {
        settingsOpen = false;
        render();
      } else if (act === "station") {
        openStation(tEl.dataset.id!);
      } else if (act === "clear-dest") {
        clearDestination();
      } else if (act === "clear-start") {
        resetStartToGps();
      } else if (act === "toggle-list") {
        listMinimized = !listMinimized;
        renderList();
      } else if (act === "toggle-header") {
        headerMinimized = !headerMinimized;
        applyHeaderMinimized();
      }
    });

    root.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === "dest") destQuery = el.value;
      else if (el.id === "start") {
        startQuery = el.value;
        startIsGps = isGpsStartQuery(el.value);
        if (startIsGps) startHit = null;
      } else if (el.id === "set-cons")
        settings.consumption = num(el.value, DEFAULT_SETTINGS.consumption);
      else if (el.id === "set-time") settings.timeValue = num(el.value, 0);
    });
    root.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id.startsWith("set-")) saveSettings(settings);
    });
    root.addEventListener("keyup", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === "dest" || el.id === "start") debounceSuggest(el);
    });
    root.addEventListener("keydown", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === "dest" && e.key === "Enter") {
        e.preventDefault();
        void goDestination(el.value);
      } else if (el.id === "start" && e.key === "Enter") {
        e.preventDefault();
        void goStart(el.value);
      }
    });
  }

  let suggestTimer = 0;
  function debounceSuggest(el: HTMLInputElement): void {
    window.clearTimeout(suggestTimer);
    suggestTimer = window.setTimeout(() => void suggest(el), 280);
  }

  async function suggest(el: HTMLInputElement): Promise<void> {
    const hits = await geocode(el.value, locale);
    const box = root.querySelector(el.id === "start" ? "#start-sug" : "#dest-sug");
    if (!box) return;
    box.innerHTML = hits
      .map(
        (h, i) => `<button type="button" class="sug" data-i="${i}">${escapeHtml(h.label)}</button>`,
      )
      .join("");
    box.querySelectorAll<HTMLButtonElement>(".sug").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        const hit = hits[i];
        el.value = hit.label;
        box.innerHTML = "";
        if (el.id === "start") void selectStart(hit);
        else void selectDestination(hit);
      });
    });
  }

  function isGpsStartQuery(query: string): boolean {
    const v = query.trim().toLowerCase();
    if (!v) return true;
    return v === t("route.myLocation").toLowerCase() || v === t("dest.from").toLowerCase();
  }

  async function goStart(query: string): Promise<void> {
    if (isGpsStartQuery(query)) {
      resetStartToGps();
      return;
    }
    const hits = await geocode(query, locale);
    if (!hits[0]) {
      destStatus = "not-found";
      render();
      return;
    }
    await selectStart(hits[0]);
  }

  async function selectStart(hit: GeoHit): Promise<void> {
    startHit = hit;
    startQuery = hit.label;
    startIsGps = false;
    pickMode = null;
    if (endHit) await runRoute();
    else render();
  }

  function resetStartToGps(): void {
    startHit = null;
    startIsGps = true;
    startQuery = userLocation ? t("route.myLocation") : "";
    pickMode = null;
    if (userLocation) void fillGpsStartLabel(userLocation);
    else requestLocation(true);
    if (endHit) void runRoute();
    else render();
  }

  async function fillGpsStartLabel(ll: LngLat): Promise<void> {
    const hit = await reverseGeocode(ll, locale);
    if (!startIsGps) return;
    startQuery = hit?.label || t("route.myLocation");
    if (document.activeElement?.id !== "start") render();
  }

  async function goDestination(query: string): Promise<void> {
    const hits = await geocode(query, locale);
    if (!hits[0]) {
      destStatus = "not-found";
      render();
      return;
    }
    await selectDestination(hits[0]);
  }

  async function selectDestination(hit: GeoHit): Promise<void> {
    endHit = hit;
    destQuery = hit.label;
    settingsOpen = false;
    pendingDest = true;
    if (!routeOrigin()) {
      destStatus = locateStatus === "denied" ? "denied" : "locating";
      pickMode = locateStatus === "denied" || locateStatus === "outside" ? "dest-start" : pickMode;
      if (startIsGps) requestLocation(true);
      render();
      return;
    }
    await runRoute();
  }

  function clearDestination(): void {
    endHit = null;
    destQuery = "";
    pendingDest = false;
    destStatus = "idle";
    routeLine = null;
    routeRows = [];
    pickMode = pickMode === "dest-start" ? null : pickMode;
    headerMinimized = false;
    listMinimized = false;
    setRouteData(map, null);
    setEndpointMarkers(null, null);
    refreshMap();
    render();
  }

  function routeOrigin(): LngLat | null {
    if (!startIsGps && startHit) return { lat: startHit.lat, lon: startHit.lon };
    return userLocation && inLithuania(userLocation) ? userLocation : null;
  }

  function persistFuel(): void {
    saveSettings(settings);
    navigate(view, locale, settings.fuel, true);
  }

  function onFuelChange(): void {
    if (routeLine) void evaluateRouteStations(routeLine);
    refreshMap();
    render();
  }

  function refreshMap(): void {
    const routeIds = routeLine ? new Set(routeRows.map((r) => r.station.id)) : null;
    const stations = stationsForRouteMap(data.stations, routeIds);
    const cheapestOnId = routeLine ? orderRouteRows(routeRows).cheapestOn?.station.id : undefined;
    const emphasis = routeLine
      ? Object.fromEntries(
          routeRows.map((r) => [
            r.station.id,
            routeStationEmphasis(r.kind, r.station.id === cheapestOnId),
          ]),
        )
      : undefined;
    setStationData(map, stations, data.prices, settings.fuel, settings, emphasis);
    if (routeLine) {
      const detours = viaGeometries();
      setRouteData(map, routeLine.geometry, detours);
    }
  }

  function viaGeometries(): LngLat[][] {
    return routeRows
      .map((r) => r.viaGeometry)
      .filter((g): g is LngLat[] => Boolean(g && g.length >= 2));
  }

  function collapseForMapFocus(): void {
    headerMinimized = true;
    listMinimized = true;
    settingsOpen = false;
    render();
  }

  function chromePadding(): maplibregl.PaddingOptions {
    const header = root.querySelector<HTMLElement>("#header");
    const list = root.querySelector<HTMLElement>("#list");
    return overlayPadding(
      header?.getBoundingClientRect().height ?? 0,
      list?.getBoundingClientRect().height ?? 0,
    );
  }

  function focusRoute(): void {
    if (!routeLine) return;
    collapseForMapFocus();
    fitRoute(map, routeLine.geometry, viaGeometries(), chromePadding());
  }

  function focusStationOnMap(s: Station, row: RouteStationRow | undefined): void {
    collapseForMapFocus();
    const padding = chromePadding();
    if (row?.viaGeometry) {
      fitRoute(map, row.viaGeometry, [], padding);
      return;
    }
    if (routeLine) {
      fitRoute(map, routeLine.geometry, viaGeometries(), padding);
      return;
    }
    flyToStation(map, s, padding);
  }

  function requestLocation(force: boolean): void {
    if (!navigator.geolocation) {
      locateStatus = "denied";
      if (pendingDest) {
        destStatus = "denied";
        pickMode = "dest-start";
      }
      return;
    }
    locateStatus = "pending";
    if (pendingDest) destStatus = "locating";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const ll = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (!inLithuania(ll)) {
          locateStatus = "outside";
          userLocation = null;
          if (pendingDest) {
            destStatus = "denied";
            pickMode = "dest-start";
          }
          render();
          return;
        }
        userLocation = ll;
        locateStatus = "idle";
        if (startIsGps) {
          if (!startQuery) startQuery = t("route.myLocation");
          void fillGpsStartLabel(ll);
        }
        if (pendingDest && endHit) void runRoute();
        else render();
      },
      () => {
        locateStatus = "denied";
        if (pendingDest) {
          destStatus = "denied";
          pickMode = "dest-start";
        }
        if (force) render();
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }

  async function runRoute(): Promise<void> {
    const start = routeOrigin();
    const end = endHit ? { lat: endHit.lat, lon: endHit.lon } : null;
    if (!end) {
      destStatus = "idle";
      render();
      return;
    }
    if (!start || !inLithuania(start)) {
      destStatus = "denied";
      pickMode = "dest-start";
      render();
      return;
    }
    destStatus = "routing";
    pendingDest = false;
    pickMode = null;
    render();
    const res = await fetchRoute(start, end, settings.routePreference);
    if (!res) {
      routeLine = null;
      routeRows = [];
      destStatus = "not-found";
      setRouteData(map, null);
      setEndpointMarkers(null, null);
      refreshMap();
      render();
      return;
    }
    routeLine = res;
    destStatus = "idle";
    setEndpointMarkers(start, end);
    await evaluateRouteStations(res);
    refreshMap();
    focusRoute();
  }

  async function evaluateRouteStations(res: RouteResult): Promise<void> {
    const start = res.geometry[0];
    const end = res.geometry[res.geometry.length - 1];
    if (!start || !end) {
      routeRows = [];
      return;
    }
    const onWay: RouteStationRow[] = [];
    const nearby: RouteStationRow[] = [];
    for (const s of data.stations) {
      const price = data.prices?.prices[s.id]?.[settings.fuel]?.price;
      if (price == null) continue;
      const p = { lat: s.lat, lon: s.lon };
      const d = distanceToPolylineKm(p, res.geometry);
      const nearest = nearestPointOnPolyline(p, res.geometry);
      const along = distanceAlongLineKm(res.geometry, nearest.index, nearest.point);
      if (d <= 0.5) {
        onWay.push({
          station: s,
          price,
          kind: "on",
          distFromStartKm: along,
          extraKm: 0,
          extraMin: 0,
          benefit: priceBenefit(price, price),
        });
      } else if (d <= CHEAP_VIA_CORRIDOR_KM) {
        nearby.push({
          station: s,
          price,
          kind: "detour",
          distFromStartKm: along,
          extraKm: 2 * d * DEFAULT_SETTINGS.roadFactor,
          extraMin: extraMinutesFromKm(2 * d * DEFAULT_SETTINGS.roadFactor),
          benefit: priceBenefit(0, price),
        });
      }
    }
    const baselinePrice = onWay.length
      ? Math.min(...onWay.map((r) => r.price))
      : nearby.length
        ? Math.min(...nearby.map((r) => r.price))
        : undefined;
    for (const row of onWay) {
      if (baselinePrice == null) continue;
      row.benefit = priceBenefit(baselinePrice, row.price);
    }
    const topCheap = topCheapStations([...onWay, ...nearby]).filter((r) => r.kind === "detour");
    await Promise.all(
      topCheap.map(async (row) => {
        const via = { lat: row.station.lat, lon: row.station.lon };
        const viaRoute = await fetchRoute(start, end, settings.routePreference, via);
        if (viaRoute) {
          row.extraKm = Math.max(0, viaRoute.distanceKm - res.distanceKm);
          row.extraMin = Math.max(0, viaRoute.durationMin - res.durationMin);
          row.viaGeometry = viaRoute.geometry;
        } else {
          row.viaGeometry = [start, via, end];
        }
        if (baselinePrice != null) row.benefit = priceBenefit(baselinePrice, row.price);
      }),
    );
    routeRows = [...onWay, ...topCheap];
  }

  function handleMapPick(ll: LngLat): void {
    if (pickMode === "dest-start" || (pendingDest && !routeOrigin())) {
      if (!inLithuania(ll)) return;
      userLocation = ll;
      pickMode = null;
      locateStatus = "idle";
      startHit = { label: t("route.myLocation"), lat: ll.lat, lon: ll.lon };
      startQuery = t("route.myLocation");
      startIsGps = false;
      void fillMapStartLabel(ll);
      if (endHit) void runRoute();
      else render();
    }
  }

  async function fillMapStartLabel(ll: LngLat): Promise<void> {
    const hit = await reverseGeocode(ll, locale);
    if (!startHit || startIsGps) return;
    if (Math.abs(startHit.lat - ll.lat) > 1e-6 || Math.abs(startHit.lon - ll.lon) > 1e-6) return;
    startHit = { label: hit?.label || t("route.myLocation"), lat: ll.lat, lon: ll.lon };
    startQuery = startHit.label;
    if (document.activeElement?.id !== "start") render();
  }

  function originForDistance(): LngLat | null {
    const origin = routeOrigin();
    return origin && inLithuania(origin) ? origin : null;
  }

  function setEndpointMarkers(start: LngLat | null, end: LngLat | null): void {
    startMarker?.remove();
    endMarker?.remove();
    startMarker = start
      ? new maplibregl.Marker({ color: "#0f8a4b" }).setLngLat([start.lon, start.lat]).addTo(map)
      : null;
    endMarker = end
      ? new maplibregl.Marker({ color: "#b91c1c" }).setLngLat([end.lon, end.lat]).addTo(map)
      : null;
  }

  function stationAddress(s: Station): string {
    return s.address || s.city || t("list.addressMissing");
  }

  function openStation(id: string): void {
    const s = data.stations.find((x) => x.id === id);
    if (!s) return;
    const routeRow = routeRows.find((r) => r.station.id === id);
    const origin = originForDistance();
    let distKm: number | undefined;
    if (endHit) {
      distKm = routeRow?.distFromStartKm;
      if (distKm == null && origin) {
        distKm = roadDistanceKm(origin, { lat: s.lat, lon: s.lon }, DEFAULT_SETTINGS.roadFactor);
      }
    }
    popup?.remove();
    focusStationOnMap(s, routeRow);
    popup = new maplibregl.Popup({ offset: 16, maxWidth: "300px" })
      .setLngLat([s.lon, s.lat])
      .setHTML(
        DOMPurify.sanitize(
          stationPopupHtml(
            s,
            data.prices,
            distKm != null ? { distLabel: formatKm(distKm) } : undefined,
          ),
          { USE_PROFILES: { html: true } },
        ),
      )
      .addTo(map);
  }

  function render(): void {
    document.documentElement.lang = locale;
    updateHreflang();
    const header = root.querySelector("#header")!;
    header.innerHTML = headerHtml();
    applyHeaderMinimized();
    const panels = root.querySelector("#panels")!;
    panels.innerHTML = settingsOpen ? settingsHtml() : "";
    renderList();
    const banner = root.querySelector("#banner")!;
    banner.innerHTML = statusHtml();
    root.querySelector(".app")?.classList.toggle("has-route", Boolean(routeLine));
    syncMapControls();
  }

  function renderList(): void {
    const list = root.querySelector("#list")!;
    if (routeLine && routeRows.length) {
      const { cheapestOn, cheapestOverall, ordered } = orderRouteRows(routeRows);
      list.innerHTML = listWrap(
        ordered.map((r, i) => {
          const isCheapestOn = cheapestOn?.station.id === r.station.id;
          const isCheapestOverall = cheapestOverall?.station.id === r.station.id;
          const detourWorth = r.benefit.netBenefit > 0 ? t("route.worth") : t("route.notWorth");
          const badges = [
            isCheapestOn
              ? `<span class="badge">${escapeHtml(t("route.cheapestBadge"))}</span>`
              : "",
            isCheapestOverall
              ? `<span class="badge">${escapeHtml(t("route.cheapestOverall"))}</span>`
              : "",
            !isCheapestOn && r.kind === "on"
              ? `<span class="badge muted">${escapeHtml(t("route.onTheWay"))}</span>`
              : "",
            !isCheapestOverall && r.kind === "detour"
              ? `<span class="badge">${escapeHtml(detourWorth)}</span>`
              : "",
          ].join("");
          const extra =
            r.kind === "detour"
              ? t("route.extra", {
                  km: r.extraKm.toFixed(1),
                  save: formatMoney(r.benefit.netBenefit),
                })
              : "";
          const pinned = isCheapestOn || isCheapestOverall;
          const rowClass = [
            pinned && i < 2 ? "is-pick" : "",
            r.kind === "on" ? "is-on-route" : "is-detour",
          ]
            .filter(Boolean)
            .join(" ");
          return stationRow(r.station, r.price, r.distFromStartKm, extra, rowClass, badges);
        }),
      );
      return;
    }
    if (routeLine && endHit && routeRows.length === 0) {
      list.innerHTML = listWrap([], t("route.noStations"));
      return;
    }
    const priced = stationsInView(map, data.stations)
      .map((s) => ({
        s,
        price: data.prices?.prices[s.id]?.[settings.fuel]?.price,
      }))
      .filter((r): r is { s: Station; price: number } => r.price != null)
      .sort((a, b) => a.price - b.price || a.s.id.localeCompare(b.s.id));
    if (priced.length === 0) {
      list.innerHTML = listWrap([], t("list.empty"));
      return;
    }
    const last = priced.length - 1;
    list.innerHTML = listWrap(
      priced.map((r, i) => {
        const badges = [
          i === 0 ? `<span class="badge">${escapeHtml(t("list.cheapest"))}</span>` : "",
          i === last && last > 0
            ? `<span class="badge muted">${escapeHtml(t("list.expensive"))}</span>`
            : "",
        ].join("");
        return stationRow(r.s, r.price, undefined, "", i === 0 ? "is-pick" : "", badges);
      }),
    );
  }

  function listWrap(items: string[], empty?: string): string {
    const count = items.length;
    const title = count ? `${t("list.title")} · ${tPlural("stations", count)}` : t("list.title");
    const updatedAt = data.prices?.generatedAt ?? data.meta?.generatedAt;
    const updated = updatedAt
      ? `<p class="list-updated">${escapeHtml(t("list.updated", { time: formatDateTime(updatedAt) }))}</p>`
      : "";
    const body = empty
      ? `<p class="empty">${escapeHtml(empty)}</p>`
      : `<ul class="station-list">${items.join("")}</ul>`;
    return `<div class="sheet${listMinimized ? " is-min" : ""}">
      <button type="button" class="list-head" data-act="toggle-list" aria-expanded="${listMinimized ? "false" : "true"}" aria-label="${escapeHtml(listMinimized ? t("list.expand") : t("list.collapse"))}">
        <span class="list-handle" aria-hidden="true"></span>
        <span class="list-head-copy">
          <h2>${escapeHtml(title)}</h2>
          ${updated}
        </span>
        <span class="list-chevron" aria-hidden="true">${listMinimized ? "▴" : "▾"}</span>
      </button>
      <div class="list-body">${body}</div>
    </div>`;
  }

  function stationRow(
    s: Station,
    price: number,
    distKm?: number,
    extra = "",
    className = "",
    badges = "",
  ): string {
    const dist = distKm != null ? formatKm(distKm) : "";
    const metaLine = [dist, extra].filter(Boolean).join(" ");
    const cls = ["station-row", className].filter(Boolean).join(" ");
    return `<li><button type="button" class="${cls}" data-act="station" data-id="${escapeHtml(s.id)}">
      <span class="swatch" data-brand="${escapeHtml(s.brand)}"></span>
      <span class="station-main">
        ${badges ? `<span class="station-badges">${badges}</span>` : ""}
        <strong>${escapeHtml(s.name)}</strong>
        <small class="station-addr">${escapeHtml(stationAddress(s))}</small>
        ${metaLine ? `<small class="station-eta">${escapeHtml(metaLine)}</small>` : ""}
      </span>
      <span class="station-price">${escapeHtml(formatPrice(price))}</span>
    </button></li>`;
  }

  function applyHeaderMinimized(): void {
    const header = root.querySelector("#header")!;
    header.classList.toggle("is-min", headerMinimized);
    const btn = header.querySelector<HTMLButtonElement>("[data-act='toggle-header']");
    if (!btn) return;
    btn.setAttribute("aria-expanded", headerMinimized ? "false" : "true");
    btn.setAttribute("aria-label", headerMinimized ? t("header.expand") : t("header.collapse"));
    const chev = btn.querySelector(".header-chevron");
    if (chev) chev.textContent = headerMinimized ? "▾" : "▴";
    syncMapControls();
  }

  function syncMapControls(): void {
    const header = root.querySelector<HTMLElement>("#header");
    if (!header) return;
    root.style.setProperty("--header-h", `${Math.round(header.getBoundingClientRect().height)}px`);
  }

  function headerHtml(): string {
    const g = fuelGroupOf(settings.fuel);
    const destVal = destQuery || endHit?.label || "";
    const startVal = startQuery;
    const startPlaceholder =
      startIsGps && locateStatus === "pending" ? t("dest.locating") : t("dest.from");
    const minLabel = destVal || startVal || t("app.name");
    return `
      <div class="header-body">
        <div class="topbar">
          <a class="logo" data-act="view" data-view="map" href="${pathFor("map", locale)}">${escapeHtml(t("app.name"))}</a>
          <div class="topbar-end">
            <div class="lang">
              <a data-act="locale" data-locale="lt" href="${escapeHtml(hrefFor(view, "lt", settings.fuel))}" hreflang="lt" class="${locale === "lt" ? "on" : ""}">LT</a>
              <a data-act="locale" data-locale="en" href="${escapeHtml(hrefFor(view, "en", settings.fuel))}" hreflang="en" class="${locale === "en" ? "on" : ""}">EN</a>
            </div>
            <a class="icon-btn donate-btn" href="${DONATE_URL}" target="_blank" rel="noopener noreferrer">
              ${escapeHtml(t("action.donate"))}
            </a>
            <button type="button" class="icon-btn ${settingsOpen ? "on" : ""}" data-act="settings" aria-label="${escapeHtml(t("action.settings"))}">⚙</button>
          </div>
        </div>
        <div class="fuel-filter" role="group" aria-label="${escapeHtml(t("fuel.filter"))}">
          ${(["diesel", "petrol", "gas"] as const)
            .map(
              (group) =>
                `<button type="button" class="${g === group ? "on" : ""}" data-act="fuel-group" data-group="${group}">${escapeHtml(t(`fuel.group.${group}` as MessageKey))}</button>`,
            )
            .join("")}
        </div>
        <div class="dest">
          <div class="dest-field">
            <span class="dest-pin dest-pin-start" aria-hidden="true"></span>
            <input id="start" class="search" type="search" autocomplete="off" aria-label="${escapeHtml(t("dest.from"))}" placeholder="${escapeHtml(startPlaceholder)}" value="${escapeHtml(startVal)}" />
            ${!startIsGps ? `<button type="button" class="dest-clear" data-act="clear-start" aria-label="${escapeHtml(t("dest.clearStart"))}">×</button>` : ""}
            <div id="start-sug" class="sug-box"></div>
          </div>
          <div class="dest-field">
            <span class="dest-pin dest-pin-end" aria-hidden="true"></span>
            <input id="dest" class="search" type="search" autocomplete="off" aria-label="${escapeHtml(t("dest.placeholder"))}" placeholder="${escapeHtml(t("dest.placeholder"))}" value="${escapeHtml(destVal)}" />
            ${endHit ? `<button type="button" class="dest-clear" data-act="clear-dest" aria-label="${escapeHtml(t("dest.clear"))}">×</button>` : ""}
            <div id="dest-sug" class="sug-box"></div>
          </div>
        </div>
      </div>
      <button type="button" class="header-toggle" data-act="toggle-header" aria-expanded="${headerMinimized ? "false" : "true"}" aria-label="${escapeHtml(headerMinimized ? t("header.expand") : t("header.collapse"))}">
        <span class="header-handle" aria-hidden="true"></span>
        <span class="header-min-label">${escapeHtml(minLabel)}</span>
        <span class="header-chevron" aria-hidden="true">${headerMinimized ? "▾" : "▴"}</span>
      </button>
    `;
  }

  function settingsHtml(): string {
    return `<section class="panel" aria-label="${escapeHtml(t("settings.title"))}">
      <header><h2>${escapeHtml(t("settings.title"))}</h2><button type="button" data-act="close-panel">${escapeHtml(t("action.close"))}</button></header>
      <label>${escapeHtml(t("settings.consumption"))}<input id="set-cons" type="number" min="3" max="20" step="0.1" value="${escapeHtml(String(settings.consumption))}" /></label>
      <label>${escapeHtml(t("settings.timeValue"))}<input id="set-time" type="number" min="0" max="50" step="1" value="${escapeHtml(String(settings.timeValue))}" /></label>
    </section>`;
  }

  function statusHtml(): string {
    if (!navigator.onLine && data.meta?.date) {
      return `<div class="banner">${escapeHtml(t("status.offline", { date: formatDate(data.meta.date) }))}</div>`;
    }
    if (!data.prices) return `<div class="banner">${escapeHtml(t("status.noData"))}</div>`;
    if (destStatus === "locating")
      return `<div class="banner info">${escapeHtml(t("dest.locating"))}</div>`;
    if (destStatus === "routing")
      return `<div class="banner info">${escapeHtml(t("dest.routing"))}</div>`;
    if (destStatus === "denied") {
      const msg =
        locateStatus === "outside"
          ? t("dest.outside")
          : pickMode === "dest-start"
            ? t("dest.pickStart")
            : t("dest.denied");
      return `<div class="banner">${escapeHtml(msg)}</div>`;
    }
    if (destStatus === "not-found")
      return `<div class="banner">${escapeHtml(t("dest.notFound"))}</div>`;
    return "";
  }

  function updateHreflang(): void {
    const head = document.head;
    head.querySelectorAll("link[rel='alternate']").forEach((n) => n.remove());
    for (const loc of ["lt", "en"] as Locale[]) {
      const link = document.createElement("link");
      link.rel = "alternate";
      link.hreflang = loc;
      link.href = new URL(pathFor(view, loc), window.location.origin).toString();
      head.append(link);
    }
    const def = document.createElement("link");
    def.rel = "alternate";
    def.hreflang = "x-default";
    def.href = new URL(pathFor(view, "lt"), window.location.origin).toString();
    head.append(def);
    document.title = `${t("app.name")} – ${t("app.tagline")}`;
    const manifest = document.querySelector<HTMLLinkElement>("link[rel='manifest']");
    if (manifest) {
      const base = import.meta.env.BASE_URL || "/";
      manifest.href = `${base}manifest-${locale}.webmanifest`;
    }
  }

  function shellHtml(): string {
    return `<div class="app">
      <div class="map-wrap"><div id="map" role="application" aria-label="${escapeHtml(t("nav.map"))}"></div></div>
      <header id="header" class="header"></header>
      <div id="banner"></div>
      <div id="panels"></div>
      <aside id="list" class="list"></aside>
    </div>`;
  }

  function num(v: string, fb: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }
}
