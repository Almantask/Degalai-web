import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { extraMinutesFromKm, minutesAtMaxSpeed, netBenefit } from "./calc.ts";
import { loadAppData, type AppData } from "./data.ts";
import {
  formatDate,
  formatDuration,
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
  flyToStation,
  setRouteData,
  setStationData,
  stationPopupHtml,
  stationsInView,
  type Emphasis,
} from "./map.ts";
import { orderRouteRows } from "./route-list.ts";
import { hrefFor, navigate, parsePath, pathFor, type View } from "./router.ts";
import { fetchRoute, geocode, type GeoHit, type RouteResult } from "./routing.ts";
import { fuelFromUrl, loadSettings, saveSettings } from "./settings.ts";
import type { Station } from "./types.ts";
import { DEFAULT_SETTINGS } from "./types.ts";

const DONATE_EMAIL = "almantusk@gmail.com";

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
  let pickMode: "around" | "dest-start" | null = null;
  let aroundOpen = false;
  let settingsOpen = false;
  let donateOpen = false;
  let donateCopied = false;
  let listMinimized = false;
  let headerMinimized = false;
  let aroundRows: AroundRow[] = [];
  let aroundOrigin: LngLat | null = null;
  let routeRows: RouteStationRow[] = [];
  let routeLine: RouteResult | null = null;
  let endHit: GeoHit | null = null;
  let destQuery = "";
  let destStatus: DestStatus = "idle";
  let pendingDest = false;
  let popup: maplibregl.Popup | null = null;
  let locateStatus: "idle" | "pending" | "denied" | "outside" = "idle";

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
      } else if (act === "around") {
        aroundOpen = !aroundOpen;
        settingsOpen = false;
        donateOpen = false;
        if (aroundOpen) void runAroundMe();
        render();
      } else if (act === "settings") {
        settingsOpen = !settingsOpen;
        aroundOpen = false;
        donateOpen = false;
        render();
      } else if (act === "donate") {
        donateOpen = !donateOpen;
        aroundOpen = false;
        settingsOpen = false;
        render();
      } else if (act === "copy-donate-email") {
        void copyDonateEmail();
      } else if (act === "close-panel") {
        aroundOpen = false;
        settingsOpen = false;
        donateOpen = false;
        if (pickMode === "around") pickMode = null;
        render();
      } else if (act === "pick-around") {
        pickMode = "around";
        aroundOpen = true;
        render();
      } else if (act === "radius") {
        settings.aroundRadiusKm = Number(tEl.dataset.km);
        saveSettings(settings);
        void runAroundMe();
      } else if (act === "station") {
        openStation(tEl.dataset.id!);
      } else if (act === "clear-dest") {
        clearDestination();
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
      else if (el.id === "set-cons")
        settings.consumption = num(el.value, DEFAULT_SETTINGS.consumption);
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
    root.addEventListener("keyup", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === "dest") debounceSuggest(el);
    });
    root.addEventListener("keydown", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === "dest" && e.key === "Enter") {
        e.preventDefault();
        void goDestination(el.value);
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
    const box = root.querySelector("#dest-sug");
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
        destQuery = hit.label;
        box.innerHTML = "";
        void selectDestination(hit);
      });
    });
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
    aroundOpen = false;
    settingsOpen = false;
    donateOpen = false;
    pendingDest = true;
    if (!userLocation) {
      destStatus = locateStatus === "denied" ? "denied" : "locating";
      pickMode = locateStatus === "denied" ? "dest-start" : pickMode;
      requestLocation(true);
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
    setRouteData(map, null);
    refreshMap();
    render();
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
      const detours = routeRows.filter((r) => r.connector).map((r) => r.connector!);
      setRouteData(map, routeLine.geometry, detours);
    }
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
        if (aroundOpen) void runAroundMe();
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

  async function runAroundMe(): Promise<void> {
    aroundOpen = true;
    const origin = aroundOrigin ?? userLocation;
    if (!origin || !inLithuania(origin)) {
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
    const start = userLocation;
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
      refreshMap();
      render();
      return;
    }
    routeLine = res;
    destStatus = "idle";
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
      return;
    }
    if (pickMode === "dest-start" || (pendingDest && !userLocation)) {
      if (!inLithuania(ll)) return;
      userLocation = ll;
      pickMode = null;
      locateStatus = "idle";
      if (endHit) void runRoute();
      else render();
    }
  }

  function originForEta(): LngLat | null {
    const origin = userLocation ?? aroundOrigin;
    return origin && inLithuania(origin) ? origin : null;
  }

  function etaParts(distKm: number): { dist: string; eta: string; label: string } {
    const dist = formatKm(distKm);
    const eta = t("list.etaMax", { time: formatDuration(minutesAtMaxSpeed(distKm)) });
    return { dist, eta, label: `${dist} · ${eta}` };
  }

  function stationAddress(s: Station): string {
    return s.address || s.city || t("list.addressMissing");
  }

  function openStation(id: string): void {
    const s = data.stations.find((x) => x.id === id);
    if (!s) return;
    const routeRow = routeRows.find((r) => r.station.id === id);
    const aroundRow = aroundRows.find((r) => r.station.id === id);
    const showEta = Boolean(endHit || aroundOpen);
    const origin = originForEta();
    let distKm: number | undefined;
    if (showEta) {
      distKm = routeRow?.distFromStartKm ?? aroundRow?.distKm;
      if (distKm == null && origin) {
        distKm = roadDistanceKm(origin, { lat: s.lat, lon: s.lon }, settings.roadFactor);
      }
    }
    popup?.remove();
    popup = new maplibregl.Popup({ offset: 16, maxWidth: "300px" })
      .setLngLat([s.lon, s.lat])
      .setHTML(
        stationPopupHtml(
          s,
          data.prices,
          distKm != null ? { etaLabel: etaParts(distKm).label } : undefined,
        ),
      )
      .addTo(map);
    flyToStation(map, s);
  }

  function render(): void {
    document.documentElement.lang = locale;
    updateHreflang();
    const header = root.querySelector("#header")!;
    header.innerHTML = headerHtml();
    applyHeaderMinimized();
    const panels = root.querySelector("#panels")!;
    panels.innerHTML = `${settingsOpen ? settingsHtml() : ""}${aroundOpen ? aroundHtml() : ""}${donateOpen ? donateHtml() : ""}`;
    renderList();
    const banner = root.querySelector("#banner")!;
    banner.innerHTML = statusHtml();
    syncMapControls();
  }

  function renderList(): void {
    const list = root.querySelector("#list")!;
    if (aroundOpen && aroundRows.length) {
      const cheapest = [...aroundRows].sort(
        (a, b) => a.price - b.price || a.station.id.localeCompare(b.station.id),
      )[0];
      const rest = aroundRows.filter((r) => r.station.id !== cheapest.station.id);
      const ordered = [cheapest, ...rest].slice(0, 40);
      list.innerHTML = listWrap(
        ordered.map((r, i) => {
          const worth =
            r.benefit.netBenefit > 0
              ? t("around.save", { amount: formatMoney(r.benefit.netBenefit) })
              : t("around.notWorth", { amount: formatMoney(r.benefit.netBenefit) });
          const isCheapest = r.station.id === cheapest.station.id;
          return stationRow(
            r.station,
            r.price,
            r.distKm,
            worth,
            isCheapest && i === 0 ? "is-pick" : "",
            isCheapest ? `<span class="badge">${escapeHtml(t("list.cheapest"))}</span>` : "",
          );
        }),
      );
      return;
    }
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
                  min: Math.round(r.extraMin),
                  save: formatMoney(r.benefit.netBenefit),
                })
              : "";
          const pinned = isCheapestOn || isCheapestOverall;
          return stationRow(
            r.station,
            r.price,
            r.distFromStartKm,
            extra,
            pinned && i < 2 ? "is-pick" : "",
            badges,
          );
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
    const body = empty
      ? `<p class="empty">${escapeHtml(empty)}</p>`
      : `<ul class="station-list">${items.join("")}</ul>`;
    return `<div class="sheet${listMinimized ? " is-min" : ""}">
      <button type="button" class="list-head" data-act="toggle-list" aria-expanded="${listMinimized ? "false" : "true"}" aria-label="${escapeHtml(listMinimized ? t("list.expand") : t("list.collapse"))}">
        <span class="list-handle" aria-hidden="true"></span>
        <h2>${escapeHtml(title)}</h2>
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
    const eta = distKm != null ? etaParts(distKm) : null;
    const etaLine = [eta?.label, extra].filter(Boolean).join(" ");
    const cls = ["station-row", className].filter(Boolean).join(" ");
    return `<li><button type="button" class="${cls}" data-act="station" data-id="${escapeHtml(s.id)}">
      <span class="swatch" data-brand="${escapeHtml(s.brand)}"></span>
      <span class="station-main">
        ${badges ? `<span class="station-badges">${badges}</span>` : ""}
        <strong>${escapeHtml(s.name)}</strong>
        <small class="station-addr">${escapeHtml(stationAddress(s))}</small>
        ${etaLine ? `<small class="station-eta">${escapeHtml(etaLine)}</small>` : ""}
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
    const minLabel = destVal || t("app.name");
    return `
      <div class="header-body">
        <div class="topbar">
          <a class="logo" data-act="view" data-view="map" href="${pathFor("map", locale)}">${escapeHtml(t("app.name"))}</a>
          <div class="topbar-end">
            <div class="lang">
              <a data-act="locale" data-locale="lt" href="${hrefFor(view, "lt", settings.fuel)}" hreflang="lt" class="${locale === "lt" ? "on" : ""}">LT</a>
              <a data-act="locale" data-locale="en" href="${hrefFor(view, "en", settings.fuel)}" hreflang="en" class="${locale === "en" ? "on" : ""}">EN</a>
            </div>
            <button type="button" class="icon-btn ${aroundOpen ? "on" : ""}" data-act="around">${escapeHtml(t("action.around"))}</button>
            <button type="button" class="icon-btn donate-btn ${donateOpen ? "on" : ""}" data-act="donate">
              <svg class="donate-heart" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path fill="currentColor" d="M7.97 14s-5.3-3.18-6.76-6C.02 5.36 1.3 2.2 4.2 2.2c1.4 0 2.5.8 3.77 2.16C9.24 3 10.34 2.2 11.75 2.2c2.9 0 4.18 3.16 2.99 5.8C13.28 10.82 7.97 14 7.97 14z"/>
              </svg>
              ${escapeHtml(t("action.donate"))}
            </button>
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
          <div class="dest-from">
            <span class="dest-pin" aria-hidden="true"></span>
            <span>${escapeHtml(t("dest.from"))}</span>
          </div>
          <div class="dest-field">
            <input id="dest" class="search" type="search" autocomplete="off" placeholder="${escapeHtml(t("dest.placeholder"))}" value="${escapeHtml(destVal)}" />
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

  function aroundHtml(): string {
    return `<section class="panel" aria-label="${escapeHtml(t("around.title"))}">
      <header><h2>${escapeHtml(t("around.title"))}</h2><button type="button" data-act="close-panel">${escapeHtml(t("action.close"))}</button></header>
      <p>${locateStatus === "pending" ? escapeHtml(t("around.locating")) : (locateStatus === "denied" || locateStatus === "outside") && !aroundOrigin ? escapeHtml(t("around.denied")) : escapeHtml(t("around.baseline"))}</p>
      <div class="radii">${[5, 15, 30]
        .map(
          (km) =>
            `<button type="button" class="${settings.aroundRadiusKm === km ? "on" : ""}" data-act="radius" data-km="${km}">${escapeHtml(t("around.km", { n: km }))}</button>`,
        )
        .join("")}</div>
      <button type="button" data-act="pick-around">${escapeHtml(pickMode === "around" ? t("around.picking") : t("around.pickMap"))}</button>
    </section>`;
  }

  function donateHtml(): string {
    return `<section class="panel donate-panel" aria-label="${escapeHtml(t("donate.title"))}">
      <header><h2>${escapeHtml(t("donate.title"))}</h2><button type="button" data-act="close-panel">${escapeHtml(t("action.close"))}</button></header>
      <p>${escapeHtml(t("donate.lead"))}</p>
      <p class="donate-email-label">${escapeHtml(t("donate.emailLabel"))}</p>
      <div class="donate-email">
        <code>${escapeHtml(DONATE_EMAIL)}</code>
        <button type="button" class="primary" data-act="copy-donate-email">${escapeHtml(donateCopied ? t("donate.copied") : t("donate.copy"))}</button>
      </div>
    </section>`;
  }

  async function copyDonateEmail(): Promise<void> {
    try {
      await navigator.clipboard.writeText(DONATE_EMAIL);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = DONATE_EMAIL;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    donateCopied = true;
    render();
    window.setTimeout(() => {
      donateCopied = false;
      if (donateOpen) render();
    }, 1600);
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
