import maplibregl from "maplibre-gl";
import uPlot from "uplot";
import "maplibre-gl/dist/maplibre-gl.css";
import "uplot/dist/uPlot.min.css";
import { extraMinutesFromKm, netBenefit } from "./calc.ts";
import { loadAppData, type AppData } from "./data.ts";
import { formatDate, formatKm, formatMoney, formatPrice, escapeHtml } from "./format.ts";
import { distanceAlongLineKm, distanceToPolylineKm, nearestPointOnPolyline, roadDistanceKm, type LngLat } from "./geo.ts";
import { brandLabel, fuelGroupOf, FUEL_BY_GROUP, setLocale, t, tPlural, type Locale, type MessageKey } from "./i18n/index.ts";
import {
  createMap,
  flyToStation,
  setRouteData,
  setStationData,
  stationPopupHtml,
  type Emphasis,
  visibleStationIds,
} from "./map.ts";
import { hrefFor, navigate, parsePath, pathFor, type View } from "./router.ts";
import { fetchRoute, geocode, type GeoHit, type RouteResult } from "./routing.ts";
import { fuelFromUrl, loadSettings, saveSettings } from "./settings.ts";
import type { FuelType, Station, UserSettings } from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";

interface AroundRow {
  station: Station;
  price: number;
  distKm: number;
  benefit: ReturnType<typeof netBenefit>;
  extraKm: number;
  extraMin: number;
}

interface RouteStationRow {
  station: Station;
  price: number;
  kind: "on" | "detour";
  distFromStartKm: number;
  extraKm: number;
  extraMin: number;
  benefit: ReturnType<typeof netBenefit>;
  connector?: [LngLat, LngLat];
}

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
  let pickMode: "around" | "route-start" | "route-end" | null = null;
  let aroundOpen = false;
  let routeOpen = false;
  let settingsOpen = false;
  let aroundRows: AroundRow[] = [];
  let aroundOrigin: LngLat | null = null;
  let routeRows: RouteStationRow[] = [];
  let routeLine: RouteResult | null = null;
  let startHit: GeoHit | { label: string; lat: number; lon: number } | "mylocation" | null = null;
  let endHit: GeoHit | null = null;
  let popup: maplibregl.Popup | null = null;
  let chart: uPlot | null = null;
  let searchQuery = "";
  let locateStatus: "idle" | "pending" | "denied" = "idle";

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
    root.addEventListener("click", (e) => {
      const tEl = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!tEl) return;
      const act = tEl.dataset.act;
      if (act === "view" || act === "locale") e.preventDefault();
      if (act === "view") {
        const v = tEl.dataset.view as View;
        view = v;
        navigate(v, locale, settings.fuel);
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
        const fuels = FUEL_BY_GROUP[g];
        settings.fuel = g === "petrol" && (settings.fuel === "95" || settings.fuel === "98") ? settings.fuel : fuels[0];
        persistFuel();
        onFuelChange();
      } else if (act === "fuel") {
        settings.fuel = tEl.dataset.fuel as FuelType;
        persistFuel();
        onFuelChange();
      } else if (act === "around") {
        aroundOpen = !aroundOpen;
        routeOpen = false;
        if (aroundOpen) void runAroundMe();
        render();
      } else if (act === "route") {
        routeOpen = !routeOpen;
        aroundOpen = false;
        if (routeOpen && !startHit) {
          startHit = "mylocation";
          requestLocation(true);
        }
        render();
      } else if (act === "settings") {
        settingsOpen = !settingsOpen;
        render();
      } else if (act === "close-panel") {
        aroundOpen = false;
        routeOpen = false;
        settingsOpen = false;
        pickMode = null;
        render();
      } else if (act === "pick-around") {
        pickMode = "around";
        aroundOpen = true;
        render();
      } else if (act === "use-loc") {
        startHit = "mylocation";
        requestLocation(true);
        render();
      } else if (act === "route-go") {
        void runRoute();
      } else if (act === "radius") {
        settings.aroundRadiusKm = Number(tEl.dataset.km);
        saveSettings(settings);
        void runAroundMe();
      } else if (act === "pref") {
        settings.routePreference = tEl.dataset.pref as UserSettings["routePreference"];
        saveSettings(settings);
        render();
      } else if (act === "station") {
        openStation(tEl.dataset.id!);
      } else if (act === "clear-route") {
        routeLine = null;
        routeRows = [];
        setRouteData(map, null);
        refreshMap();
        render();
      }
    });

    root.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === "search") {
        searchQuery = el.value;
        renderList();
      } else if (el.id === "set-cons") settings.consumption = num(el.value, DEFAULT_SETTINGS.consumption);
      else if (el.id === "set-litres") settings.litres = num(el.value, DEFAULT_SETTINGS.litres);
      else if (el.id === "set-time") settings.timeValue = num(el.value, 0);
      else if (el.id === "set-factor") settings.roadFactor = num(el.value, 1.3);
      else if (el.id === "set-detour") settings.routeDetourKm = num(el.value, 5);
    });
    root.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === "set-return") settings.aroundReturn = el.checked;
      if (el.id === "set-hide") settings.hideUnpriced = el.checked;
      if (el.id.startsWith("set-")) saveSettings(settings);
      if (el.id === "set-hide") refreshMap();
      if (aroundOpen) void runAroundMe();
    });
    root.addEventListener("focusin", (e) => {
      const el = e.target as HTMLElement;
      if (el.id === "route-start" || el.id === "route-end") {
        /* suggestions handled on input */
      }
    });
    root.addEventListener("keyup", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === "route-end" || el.id === "route-start") debounceSuggest(el);
    });
  }

  let suggestTimer = 0;
  function debounceSuggest(el: HTMLInputElement): void {
    window.clearTimeout(suggestTimer);
    suggestTimer = window.setTimeout(() => void suggest(el), 280);
  }

  async function suggest(el: HTMLInputElement): Promise<void> {
    const hits = await geocode(el.value, locale);
    const box = root.querySelector(`#${el.id}-sug`);
    if (!box) return;
    box.innerHTML = hits
      .map(
        (h, i) =>
          `<button type="button" class="sug" data-i="${i}" data-for="${el.id}">${escapeHtml(h.label)}</button>`,
      )
      .join("");
    box.querySelectorAll<HTMLButtonElement>(".sug").forEach((btn, i) => {
      btn.addEventListener("click", () => {
        const hit = hits[i];
        el.value = hit.label;
        if (el.id === "route-start") startHit = hit;
        else endHit = hit;
        box.innerHTML = "";
      });
    });
  }

  function persistFuel(): void {
    saveSettings(settings);
    navigate(view, locale, settings.fuel, true);
  }

  function onFuelChange(): void {
    if (routeLine) void evaluateRouteStations(routeLine);
    if (aroundOpen && aroundOrigin) aroundRows = computeAround(aroundOrigin);
    refreshMap();
    render();
  }

  function refreshMap(): void {
    const emphasis: Record<string, Emphasis> | undefined = routeLine
      ? Object.fromEntries(
          data.stations.map((s) => {
            const row = routeRows.find((r) => r.station.id === s.id);
            if (!row) return [s.id, "dim" as Emphasis];
            return [s.id, row.kind === "on" ? ("high" as Emphasis) : ("low" as Emphasis)];
          }),
        )
      : undefined;
    setStationData(map, data.stations, data.prices, settings.fuel, settings, emphasis);
    if (routeLine) {
      const detours = routeRows.filter((r) => r.connector).map((r) => r.connector!) ;
      setRouteData(map, routeLine.geometry, detours);
    }
  }

  function requestLocation(force: boolean): void {
    if (!navigator.geolocation) {
      locateStatus = "denied";
      return;
    }
    locateStatus = "pending";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        locateStatus = "idle";
        if (aroundOpen) void runAroundMe();
        render();
      },
      () => {
        locateStatus = "denied";
        if (force) render();
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  }

  async function runAroundMe(): Promise<void> {
    aroundOpen = true;
    const origin = aroundOrigin ?? userLocation;
    if (!origin) {
      requestLocation(true);
      render();
      return;
    }
    aroundOrigin = origin;
    aroundRows = computeAround(origin);
    map.easeTo({ center: [origin.lon, origin.lat], zoom: 11 });
    render();
  }

  function computeAround(origin: LngLat): AroundRow[] {
    const radius = settings.aroundRadiusKm;
    const candidates: Array<{ station: Station; price: number; distKm: number }> = [];
    for (const s of data.stations) {
      const price = data.prices?.prices[s.id]?.[settings.fuel]?.price;
      if (price == null) continue;
      const distKm = roadDistanceKm(origin, { lat: s.lat, lon: s.lon }, settings.roadFactor);
      if (distKm <= radius) candidates.push({ station: s, price, distKm });
    }
    candidates.sort((a, b) => a.distKm - b.distKm);
    if (candidates.length === 0) return [];
    const baseline = candidates[0];
    return candidates
      .map((c) => {
        const extraKm = settings.aroundReturn ? c.distKm * 2 : c.distKm;
        const extraMin = extraMinutesFromKm(extraKm);
        const benefit = netBenefit({
          baselinePrice: baseline.price,
          stationPrice: c.price,
          litres: settings.litres,
          extraKm,
          extraMin,
          consumptionLPer100km: settings.consumption,
          timeValueEurH: settings.timeValue,
        });
        return { ...c, benefit, extraKm, extraMin };
      })
      .sort((a, b) => b.benefit.netBenefit - a.benefit.netBenefit);
  }

  async function runRoute(): Promise<void> {
    const startInput = root.querySelector<HTMLInputElement>("#route-start");
    const endInput = root.querySelector<HTMLInputElement>("#route-end");
    let start: LngLat | null = null;
    if (startHit === "mylocation") start = userLocation;
    else if (startHit) start = { lat: startHit.lat, lon: startHit.lon };
    if (!start && startInput?.value) {
      const hits = await geocode(startInput.value, locale);
      if (hits[0]) start = { lat: hits[0].lat, lon: hits[0].lon };
    }
    if (!start && userLocation) start = userLocation;
    let end: LngLat | null = endHit ? { lat: endHit.lat, lon: endHit.lon } : null;
    if (!end && endInput?.value) {
      const hits = await geocode(endInput.value, locale);
      if (hits[0]) {
        endHit = hits[0];
        end = { lat: hits[0].lat, lon: hits[0].lon };
      }
    }
    if (!end) {
      render();
      return;
    }
    if (!start) {
      locateStatus = "denied";
      render();
      return;
    }
    userLocation = start;
    const res = await fetchRoute(start, end, settings.routePreference);
    if (!res) {
      routeLine = null;
      routeRows = [];
      render();
      return;
    }
    routeLine = res;
    await evaluateRouteStations(res);
    refreshMap();
    render();
  }

  async function evaluateRouteStations(res: RouteResult): Promise<void> {
    const onWay: RouteStationRow[] = [];
    const detours: RouteStationRow[] = [];
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
          benefit: netBenefit({
            baselinePrice: price,
            stationPrice: price,
            litres: settings.litres,
            extraKm: 0,
            extraMin: 0,
            consumptionLPer100km: settings.consumption,
            timeValueEurH: settings.timeValue,
          }),
        });
      } else if (d <= settings.routeDetourKm) {
        detours.push({
          station: s,
          price,
          kind: "detour",
          distFromStartKm: along,
          extraKm: 2 * d * settings.roadFactor,
          extraMin: extraMinutesFromKm(2 * d * settings.roadFactor),
          benefit: netBenefit({
            baselinePrice: 0,
            stationPrice: price,
            litres: settings.litres,
            extraKm: 2 * d * settings.roadFactor,
            extraMin: extraMinutesFromKm(2 * d * settings.roadFactor),
            consumptionLPer100km: settings.consumption,
            timeValueEurH: settings.timeValue,
          }),
          connector: [p, nearest.point],
        });
      }
    }
    onWay.sort((a, b) => a.distFromStartKm - b.distFromStartKm);
    const baselinePrice = onWay.length ? Math.min(...onWay.map((r) => r.price)) : undefined;
    for (const row of onWay) {
      if (baselinePrice == null) continue;
      row.benefit = netBenefit({
        baselinePrice,
        stationPrice: row.price,
        litres: settings.litres,
        extraKm: 0,
        extraMin: 0,
        consumptionLPer100km: settings.consumption,
        timeValueEurH: settings.timeValue,
      });
    }
    detours.sort((a, b) => a.price - b.price);
    const top = detours.slice(0, 15);
    for (const row of top) {
      if (baselinePrice == null) continue;
      const via = { lat: row.station.lat, lon: row.station.lon };
      const start = res.geometry[0];
      const end = res.geometry[res.geometry.length - 1];
      const viaRoute = await fetchRoute(start, end, settings.routePreference, via);
      if (viaRoute) {
        row.extraKm = Math.max(0, viaRoute.distanceKm - res.distanceKm);
        row.extraMin = Math.max(0, viaRoute.durationMin - res.durationMin);
      }
      row.benefit = netBenefit({
        baselinePrice,
        stationPrice: row.price,
        litres: settings.litres,
        extraKm: row.extraKm,
        extraMin: row.extraMin,
        consumptionLPer100km: settings.consumption,
        timeValueEurH: settings.timeValue,
      });
    }
    routeRows = [...onWay, ...top.filter((r) => r.benefit.netBenefit > -5)].sort(
      (a, b) => a.distFromStartKm - b.distFromStartKm,
    );
  }

  function handleMapPick(ll: LngLat): void {
    if (pickMode === "around") {
      aroundOrigin = ll;
      pickMode = null;
      void runAroundMe();
    }
  }

  function openStation(id: string): void {
    const s = data.stations.find((x) => x.id === id);
    if (!s) return;
    popup?.remove();
    popup = new maplibregl.Popup({ offset: 16, maxWidth: "280px" })
      .setLngLat([s.lon, s.lat])
      .setHTML(stationPopupHtml(s, data.prices))
      .addTo(map);
    flyToStation(map, s);
  }

  function render(): void {
    document.documentElement.lang = locale;
    updateHreflang();
    const header = root.querySelector("#header")!;
    header.innerHTML = headerHtml();
    const panels = root.querySelector("#panels")!;
    panels.innerHTML = `${settingsOpen ? settingsHtml() : ""}${aroundOpen ? aroundHtml() : ""}${routeOpen ? routeHtml() : ""}`;
    const page = root.querySelector<HTMLElement>("#page")!;
    page.hidden = view === "map";
    mapDiv.parentElement!.hidden = view !== "map";
    if (view === "history") page.innerHTML = historyHtml();
    else if (view === "about") page.innerHTML = aboutHtml();
    else page.innerHTML = "";
    if (view === "history") drawChart();
    renderList();
    const banner = root.querySelector("#banner")!;
    banner.innerHTML = statusHtml();
  }

  function renderList(): void {
    const list = root.querySelector("#list")!;
    if (view !== "map") {
      list.innerHTML = "";
      return;
    }
    if (aroundOpen && aroundRows.length) {
      list.innerHTML = listWrap(
        aroundRows.slice(0, 40).map((r) => {
          const worth =
            r.benefit.netBenefit > 0
              ? t("around.save", { amount: formatMoney(r.benefit.netBenefit) })
              : t("around.notWorth", { amount: formatMoney(r.benefit.netBenefit) });
          return stationRow(r.station, r.price, `${formatKm(r.distKm)} · ${worth}`);
        }),
      );
      return;
    }
    if (routeOpen && routeRows.length) {
      const cheapestOn = routeRows.filter((r) => r.kind === "on").sort((a, b) => a.price - b.price)[0];
      list.innerHTML = listWrap(
        routeRows.map((r) => {
          const badge =
            cheapestOn && r.station.id === cheapestOn.station.id
              ? `<span class="badge">${escapeHtml(t("route.cheapestBadge"))}</span>`
              : r.kind === "on"
                ? `<span class="badge muted">${escapeHtml(t("route.onTheWay"))}</span>`
                : `<span class="badge">${escapeHtml(r.benefit.netBenefit > 0 ? t("route.worth") : t("route.notWorth"))}</span>`;
          const extra =
            r.kind === "detour"
              ? t("route.extra", {
                  km: r.extraKm.toFixed(1),
                  min: Math.round(r.extraMin),
                  save: formatMoney(r.benefit.netBenefit),
                })
              : t("route.fromStart", { km: r.distFromStartKm.toFixed(0) });
          return stationRow(r.station, r.price, `${extra} ${badge}`);
        }),
      );
      return;
    }
    const ids = new Set(visibleStationIds(map));
    let rows = data.stations.filter((s) => ids.size === 0 || ids.has(s.id));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      rows = data.stations.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.brand.includes(q) ||
          (s.address ?? "").toLowerCase().includes(q) ||
          (s.city ?? "").toLowerCase().includes(q),
      );
    }
    const priced = rows
      .map((s) => ({ s, price: data.prices?.prices[s.id]?.[settings.fuel]?.price }))
      .filter((r) => r.price != null)
      .sort((a, b) => a.price! - b.price!);
    list.innerHTML = listWrap(
      priced.slice(0, 60).map((r) => stationRow(r.s, r.price!, brandLabel(r.s.brand))),
    );
    if (priced.length === 0) {
      list.innerHTML = `<div class="sheet"><h2>${escapeHtml(t("list.title"))}</h2><p class="empty">${escapeHtml(t("list.empty"))}</p></div>`;
    }
  }

  function listWrap(items: string[]): string {
    return `<div class="sheet"><h2>${escapeHtml(t("list.title"))} · ${escapeHtml(tPlural("stations", items.length))}</h2><ul class="station-list">${items.join("")}</ul></div>`;
  }

  function stationRow(s: Station, price: number, extra: string): string {
    return `<li><button type="button" class="station-row" data-act="station" data-id="${escapeHtml(s.id)}">
      <span class="swatch" data-brand="${escapeHtml(s.brand)}"></span>
      <span class="station-main"><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(extra)}</small></span>
      <span class="station-price">${escapeHtml(formatPrice(price))}</span>
    </button></li>`;
  }

  function headerHtml(): string {
    const g = fuelGroupOf(settings.fuel);
    const petrolOpen = g === "petrol";
    return `
      <a class="logo" data-act="view" data-view="map" href="${pathFor("map", locale)}">${escapeHtml(t("app.name"))}</a>
      <div class="fuel-filter" role="group" aria-label="${escapeHtml(t("fuel.diesel"))}">
        ${(["diesel", "petrol", "gas"] as const)
          .map(
            (group) =>
              `<button type="button" class="${g === group ? "on" : ""}" data-act="fuel-group" data-group="${group}">${escapeHtml(t(`fuel.group.${group}` as MessageKey))}</button>`,
          )
          .join("")}
      </div>
      ${
        petrolOpen
          ? `<div class="fuel-sub">${["95", "98"]
              .map(
                (f) =>
                  `<button type="button" class="${settings.fuel === f ? "on" : ""}" data-act="fuel" data-fuel="${f}">${f}</button>`,
              )
              .join("")}</div>`
          : ""
      }
      <input id="search" class="search" type="search" placeholder="${escapeHtml(t("action.search"))}" value="${escapeHtml(searchQuery)}" />
      <button type="button" class="${aroundOpen ? "on" : ""}" data-act="around">${escapeHtml(t("action.around"))}</button>
      <button type="button" class="${routeOpen ? "on" : ""}" data-act="route">${escapeHtml(t("action.route"))}</button>
      <nav class="nav">
        <a data-act="view" data-view="map" href="${hrefFor("map", locale, settings.fuel)}">${escapeHtml(t("nav.map"))}</a>
        <a data-act="view" data-view="history" href="${hrefFor("history", locale, settings.fuel)}">${escapeHtml(t("nav.history"))}</a>
        <a data-act="view" data-view="about" href="${hrefFor("about", locale, settings.fuel)}">${escapeHtml(t("nav.about"))}</a>
      </nav>
      <div class="lang">
        <a data-act="locale" data-locale="lt" href="${hrefFor(view, "lt", settings.fuel)}" hreflang="lt" class="${locale === "lt" ? "on" : ""}">LT</a>
        <a data-act="locale" data-locale="en" href="${hrefFor(view, "en", settings.fuel)}" hreflang="en" class="${locale === "en" ? "on" : ""}">EN</a>
      </div>
      <button type="button" data-act="settings" aria-label="${escapeHtml(t("action.settings"))}">⚙</button>
    `;
  }

  function aroundHtml(): string {
    return `<section class="panel" aria-label="${escapeHtml(t("around.title"))}">
      <header><h2>${escapeHtml(t("around.title"))}</h2><button type="button" data-act="close-panel">${escapeHtml(t("action.close"))}</button></header>
      <p>${locateStatus === "pending" ? escapeHtml(t("around.locating")) : locateStatus === "denied" && !aroundOrigin ? escapeHtml(t("around.denied")) : escapeHtml(t("around.baseline"))}</p>
      <div class="radii">${[5, 15, 30]
        .map(
          (km) =>
            `<button type="button" class="${settings.aroundRadiusKm === km ? "on" : ""}" data-act="radius" data-km="${km}">${escapeHtml(t("around.km", { n: km }))}</button>`,
        )
        .join("")}</div>
      <button type="button" data-act="pick-around">${escapeHtml(pickMode === "around" ? t("around.picking") : t("around.pickMap"))}</button>
    </section>`;
  }

  function routeHtml(): string {
    const startVal = startHit === "mylocation" ? t("route.myLocation") : startHit ? startHit.label : "";
    const endVal = endHit?.label ?? "";
    return `<section class="panel" aria-label="${escapeHtml(t("route.title"))}">
      <header><h2>${escapeHtml(t("route.title"))}</h2><button type="button" data-act="close-panel">${escapeHtml(t("action.close"))}</button></header>
      <label>${escapeHtml(t("route.start"))}
        <input id="route-start" autocomplete="off" placeholder="${escapeHtml(t("route.startPlaceholder"))}" value="${escapeHtml(startVal)}" />
        <div id="route-start-sug" class="sug-box"></div>
      </label>
      <button type="button" data-act="use-loc">${escapeHtml(t("action.useLocation"))}</button>
      <label>${escapeHtml(t("route.end"))}
        <input id="route-end" autocomplete="off" placeholder="${escapeHtml(t("route.endPlaceholder"))}" value="${escapeHtml(endVal)}" />
        <div id="route-end-sug" class="sug-box"></div>
      </label>
      <div class="radii">
        <button type="button" class="${settings.routePreference === "shortest" ? "on" : ""}" data-act="pref" data-pref="shortest">${escapeHtml(t("route.shortest"))}</button>
        <button type="button" class="${settings.routePreference === "fastest" ? "on" : ""}" data-act="pref" data-pref="fastest">${escapeHtml(t("route.fastest"))}</button>
      </div>
      ${routeLine?.profile === "fastest" && settings.routePreference === "shortest" ? `<p class="hint">${escapeHtml(t("route.usingFastest"))}</p>` : ""}
      <button type="button" class="primary" data-act="route-go">${escapeHtml(t("route.search"))}</button>
      ${routeLine ? `<button type="button" data-act="clear-route">${escapeHtml(t("action.clear"))}</button>` : ""}
      ${!endHit && !(root.querySelector<HTMLInputElement>("#route-end")?.value) ? "" : ""}
    </section>`;
  }

  function settingsHtml(): string {
    return `<section class="panel" aria-label="${escapeHtml(t("settings.title"))}">
      <header><h2>${escapeHtml(t("settings.title"))}</h2><button type="button" data-act="close-panel">${escapeHtml(t("action.close"))}</button></header>
      <label>${escapeHtml(t("settings.consumption"))}<input id="set-cons" type="number" min="3" max="20" step="0.1" value="${settings.consumption}" /></label>
      <label>${escapeHtml(t("settings.litres"))}<input id="set-litres" type="number" min="5" max="80" step="1" value="${settings.litres}" /></label>
      <label>${escapeHtml(t("settings.timeValue"))}<input id="set-time" type="number" min="0" max="50" step="1" value="${settings.timeValue}" /></label>
      <label>${escapeHtml(t("settings.roadFactor"))}<input id="set-factor" type="number" min="1" max="2" step="0.05" value="${settings.roadFactor}" /></label>
      <label>${escapeHtml(t("settings.detourKm"))}<input id="set-detour" type="number" min="1" max="15" step="1" value="${settings.routeDetourKm}" /></label>
      <label class="check"><input id="set-return" type="checkbox" ${settings.aroundReturn ? "checked" : ""} /> ${escapeHtml(t("settings.returnTrip"))}</label>
      <label class="check"><input id="set-hide" type="checkbox" ${settings.hideUnpriced ? "checked" : ""} /> ${escapeHtml(t("settings.hideUnpriced"))}</label>
    </section>`;
  }

  function historyHtml(): string {
    return `<section class="page-card">
      <h1>${escapeHtml(t("history.title"))}</h1>
      <div class="radii" id="hist-range">
        ${["1m", "3m", "1y", "all"]
          .map((r) => `<button type="button" data-range="${r}">${escapeHtml(t(`history.range.${r}` as "history.range.1m"))}</button>`)
          .join("")}
      </div>
      <div id="chart" class="chart"></div>
      <p class="hint">${data.history.length < 2 ? escapeHtml(t("history.empty")) : ""}</p>
    </section>`;
  }

  function aboutHtml(): string {
    const updated = data.meta?.date ? formatDate(data.meta.date) : "—";
    return `<section class="page-card about">
      <h1>${escapeHtml(t("about.title"))}</h1>
      <p>${escapeHtml(t("about.body"))}</p>
      <p>${escapeHtml(t("about.disclaimer"))}</p>
      <h2>${escapeHtml(t("about.sources"))}</h2>
      <ul>
        <li>${escapeHtml(t("about.source.lea"))}</li>
        <li>${escapeHtml(t("about.source.osm"))}</li>
        <li>${escapeHtml(t("about.source.map"))}</li>
        <li>${escapeHtml(t("about.source.geo"))}</li>
      </ul>
      <p>${escapeHtml(t("about.updated", { date: updated }))}</p>
      <p>${escapeHtml(t("about.offline"))}</p>
    </section>`;
  }

  function statusHtml(): string {
    if (!navigator.onLine && data.meta?.date) {
      return `<div class="banner">${escapeHtml(t("status.offline", { date: formatDate(data.meta.date) }))}</div>`;
    }
    if (!data.prices) return `<div class="banner">${escapeHtml(t("status.noData"))}</div>`;
    return "";
  }

  function drawChart(): void {
    const el = root.querySelector<HTMLElement>("#chart");
    if (!el) return;
    chart?.destroy();
    chart = null;
    const fuel = settings.fuel;
    const points = data.history.filter((h) => h.byFuel[fuel]);
    if (points.length < 2) return;
    const xs = points.map((p) => Date.parse(`${p.date}T00:00:00Z`) / 1000);
    const mins = points.map((p) => p.byFuel[fuel]!.min);
    const meds = points.map((p) => p.byFuel[fuel]!.median);
    chart = new uPlot(
      {
        width: Math.min(el.clientWidth || 640, 900),
        height: 320,
        series: [
          {},
          { label: t("history.min"), stroke: "#15803d", width: 2 },
          { label: t("history.median"), stroke: "#ca8a04", width: 2 },
        ],
        axes: [{}, { values: (_u, vals) => vals.map((v) => (v as number).toFixed(2)) }],
      },
      [xs, mins, meds],
      el,
    );
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
      <header id="header" class="header"></header>
      <div id="banner"></div>
      <div class="map-wrap"><div id="map" role="application" aria-label="${escapeHtml(t("nav.map"))}"></div><div id="panels"></div></div>
      <main id="page" class="page" hidden></main>
      <aside id="list" class="list"></aside>
    </div>`;
  }

  function num(v: string, fb: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }
}
