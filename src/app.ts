import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { netBenefit } from "./calc.ts";
import { cheapestHourRanges, filterSeries, formatCheapRanges } from "./cheap-hours.ts";
import { swapEndpoints, type Endpoints } from "./endpoints.ts";
import { loadAppData, lastUpdatedAt, loadChargers, loadHistory, type AppData } from "./data.ts";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatKm,
  formatPrice,
  escapeHtml,
  shortAddress,
} from "./format.ts";
import {
  boundsAround,
  distanceAlongLineKm,
  distanceToPolylineKm,
  inLithuania,
  nearestPointOnPolyline,
  roadDistanceKm,
  type LngLat,
} from "./geo.ts";
import {
  brandLabel,
  networkLabels,
  FUEL_BY_GROUP,
  fuelGroupOf,
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
  openListPadding,
  overlayPadding,
  setMapGeolocateAccuracy,
  ROUTE_OPTION_COLORS,
  setRouteData,
  setRouteOptions,
  setStationData,
  freeReasonText,
  stationPopupHtml,
  stationsForRouteMap,
  stationsInView,
  routeStationEmphasis,
} from "./map.ts";
import {
  byPrice,
  cheapestOnDashed,
  DASHED_ROUTE_KM,
  DETOUR_CORRIDOR_KM,
  MAX_DASHED_CHECKS,
  detourCandidates,
  detourWindow,
  isOnTheWay,
  mapRouteStationIds,
  orderRouteRows,
} from "./route-list.ts";
import { hrefFor, navigate, parsePath, pathFor, type View } from "./router.ts";
import {
  fetchDetours,
  fetchRoute,
  fetchRoutes,
  geocode,
  reverseGeocode,
  type Detour,
  type GeoHit,
  type RouteResult,
} from "./routing.ts";
import {
  installOffer,
  isIosSafari,
  isStandalone,
  loadInstallDismissed,
  persistInstallDismissed,
} from "./pwa.ts";
import { browserRefreshDeps, refreshWebsite } from "./refresh.ts";
import {
  githubIssueLink,
  MAX_REPORT_CHARS,
  MIN_REPORT_CHARS,
  REPORT_CATEGORIES,
  sendReport,
  type ReportCategory,
  type ReportContext,
} from "./report.ts";
import { blobToDataUrl, shrinkImage } from "./report-image.ts";
import DOMPurify from "dompurify";
import {
  allHistoryBrandsOn,
  brandColor,
  chartBrands,
  seriesForStat,
  toggleAllHistoryBrands,
  toggleHistoryBrand,
} from "./history-series.ts";
import {
  clampDetourKm,
  excludedFor,
  fuelFromUrl,
  isBrandIncluded,
  loadSettings,
  locationPositionOptions,
  MAX_DETOUR_KM_RANGE,
  saveSettings,
  uniqueBrands,
} from "./settings.ts";
import {
  SHEET_COMPACT_MQ,
  isSheetDrag,
  sheetDragTranslate,
  sheetFromDrag,
  type MinimizeSign,
} from "./sheet-gesture.ts";
import type {
  FuelGroup,
  FuelType,
  HistoryFile,
  HistoryHourSeries,
  HistoryStat,
  Station,
} from "./types.ts";
import { DEFAULT_SETTINGS, FUEL_GROUPS, HISTORY_STATS } from "./types.ts";

const DONATE_URL = "https://almantask.github.io/donate-me/";
const LEA_SOURCE_URL = "https://degalukainos.ena.lt/";
const CIRCLE_K_SOURCE_URL = "https://www.circlek.lt/privatiems/degalu-kainos";
const OSM_SOURCE_URL = "https://www.openstreetmap.org/copyright";
const SPOT_SOURCE_URL = "https://dashboard.elering.ee/";
const REGISTER_SOURCE_URL = "https://ev.vialietuva.lt/en/data-provision";
const REPORTS_SOURCE_URL =
  "https://github.com/Almantask/Degalai-web/issues/new?template=wrong-price.yml";
/** The cron worker's POST /report; unset in dev, where the form opens GitHub instead. */
const REPORT_URL = import.meta.env.VITE_REPORT_URL ?? "";

const DONATE_HEART = `<svg class="donate-heart" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
  <path fill="currentColor" d="M7.97 14s-5.3-3.18-6.76-6C.02 5.36 1.3 2.2 4.2 2.2c1.4 0 2.5.8 3.77 2.16C9.24 3 10.34 2.2 11.75 2.2c2.9 0 4.18 3.16 2.99 5.8C13.28 10.82 7.97 14 7.97 14z"/>
</svg>`;

const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M4 21v-7"/>
  <path d="M4 10V3"/>
  <path d="M12 21v-9"/>
  <path d="M12 8V3"/>
  <path d="M20 21v-5"/>
  <path d="M20 12V3"/>
  <path d="M1 14h6"/>
  <path d="M9 8h6"/>
  <path d="M17 16h6"/>
</svg>`;

const SWAP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M7 4v16"/>
  <path d="M3 8l4-4 4 4"/>
  <path d="M17 20V4"/>
  <path d="M21 16l-4 4-4-4"/>
</svg>`;

const REPORT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  <path d="M7 8h10"/>
  <path d="M7 12h6"/>
</svg>`;

const IMAGE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect width="18" height="18" x="3" y="3" rx="2"/>
  <circle cx="9" cy="9" r="2"/>
  <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>
</svg>`;

const REFRESH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M21 12a9 9 0 1 1-3.5-7.1"/>
  <path d="M21 3v6h-6"/>
</svg>`;

/** Price-delta savings only — user consumption and time value stay out of ranking. */
function priceBenefit(
  baselinePrice: number,
  stationPrice: number,
  fuel: FuelType,
): ReturnType<typeof netBenefit> {
  return netBenefit({
    baselinePrice,
    stationPrice,
    litres: fuel === "EV" ? DEFAULT_SETTINGS.evKwh : DEFAULT_SETTINGS.litres,
    extraKm: 0,
    extraMin: 0,
    consumptionLPer100km: 0,
    timeValueEurH: 0,
  });
}

/** A station near a dashed via-route, with its road detour from that line once checked. */
interface DashedCandidate {
  station: Station;
  price: number;
  dashedKm: number;
  detourKm: number | null | undefined;
  detourMin: number;
}

/** A priced station within the detour corridor, with its distance from the route line. */
interface NearbyStation {
  station: Station;
  price: number;
  lineKm: number;
}

interface RouteStationRow {
  station: Station;
  price: number;
  kind: "on" | "detour";
  distFromStartKm: number;
  extraKm: number;
  extraMin: number;
  /** extraKm and extraMin are the road detour from the route, not from the via-route. */
  roadDetour: boolean;
  benefit: ReturnType<typeof netBenefit>;
  viaGeometry?: LngLat[];
  /** What the via-route through this station adds over the route. */
  viaExtraKm?: number;
  viaExtraMin?: number;
}

type DestStatus = "idle" | "locating" | "routing" | "denied" | "not-found";
type Panel = "settings" | "report";
type ReportStatus = "idle" | "short" | "sending" | "sent" | "rate" | "failed";

export async function startApp(root: HTMLElement): Promise<void> {
  // Fetch data alongside the map style and tiles instead of before them.
  const dataPromise = loadAppData();
  const settings = loadSettings();
  const parsed = parsePath();
  let locale: Locale = parsed.locale;
  setLocale(locale);
  const urlFuel = fuelFromUrl(window.location.search);
  if (urlFuel) settings.fuel = urlFuel;

  let view: View = parsed.view;
  let userLocation: LngLat | null = null;
  let pickMode: "dest-start" | null = null;
  let openPanel: Panel | null = null;
  /** Panel markup last written, so a re-render does not wipe the focus or a half-typed report. */
  let panelsHtml = "";
  /** Bug or feature idea; the form asks for it before the text box shows. */
  let reportCategory: ReportCategory | null = null;
  let reportDraft = "";
  let reportStatus: ReportStatus = "idle";
  let reportIssue: { number?: number; url?: string; imageSaved?: boolean } | null = null;
  /** The attached picture, already shrunk; `url` is an object URL for the preview. */
  let reportImage: { blob: Blob; url: string } | null = null;
  let reportImageState: "idle" | "reading" | "failed" = "idle";
  let listMinimized = false;
  let headerMinimized = false;
  let historyMinimized = false;
  let historyFile: HistoryFile | null = null;
  let historyLoading = false;
  let historyPlot: {
    destroy: () => void;
    setHidden: (hidden: ReadonlySet<string>) => void;
  } | null = null;
  let hiddenHistoryBrands = new Set<string>();
  /** EV history shows the Nord Pool spot price instead of charger prices by network. */
  let historySpot = false;
  let routeRows: RouteStationRow[] = [];
  let extraMapStationIds = new Set<string>();
  let routeLine: RouteResult | null = null;
  /** Routes from the last search; with more than one, the driver picks routeLine from them. */
  let routeOptions: RouteResult[] = [];
  /** On each dashed via-route, the cheapest station on it that is not on the way itself. */
  let dashedRows: RouteStationRow[] = [];
  /** Road detours for routeLine by station id; null when the router cannot reach one. */
  let routeDetours: { route: RouteResult; byId: Map<string, Detour | null> } | null = null;
  let routeEvalSeq = 0;
  let startHit: GeoHit | null = null;
  let startQuery = "";
  let startIsGps = true;
  let endHit: GeoHit | null = null;
  /** The destination is the user's location, swapped in from the GPS start. */
  let endIsHere = false;
  let destQuery = "";
  let destStatus: DestStatus = "idle";
  let pendingDest = false;
  let popup: maplibregl.Popup | null = null;
  let locateStatus: "idle" | "pending" | "denied" | "outside" = "idle";
  let startMarker: maplibregl.Marker | null = null;
  let endMarker: maplibregl.Marker | null = null;
  let installDismissed = loadInstallDismissed();
  let installPrompt: { prompt: () => Promise<void> } | null = null;
  let listHtml = "";
  let includedCache: { excluded: string[]; source: Station[]; stations: Station[] } | null = null;
  /** EV chargers, fetched the first time the EV chip is on. */
  let chargers: Station[] | null = null;
  let chargersLoading = false;

  const standalone = isStandalone(
    (q) => window.matchMedia(q).matches,
    (navigator as Navigator & { standalone?: boolean }).standalone,
  );
  if (standalone) document.documentElement.classList.add("is-standalone");

  root.innerHTML = shellHtml();
  const mapDiv = root.querySelector<HTMLElement>("#map")!;
  let dataReady = false;
  const map = createMap(
    mapDiv,
    {
      onStationClick: (id) => openStation(id),
      onMapClick: (ll) => {
        if (dataReady) handleMapPick(ll);
      },
      onRouteClick: (index) => void chooseRoute(index),
    },
    settings.highAccuracyLocation,
  );
  const mapLoaded = new Promise<void>((resolve) => map.once("load", () => resolve()));

  const data: AppData = await dataPromise;
  dataReady = true;
  void ensureChargers();
  void mapLoaded.then(() => {
    refreshMap();
    render();
  });
  map.on("moveend", () => renderList());
  window.addEventListener("resize", () => {
    syncMapControls();
    if (view === "history") paintHistoryChart();
  });

  window.addEventListener("popstate", () => {
    const next = parsePath();
    view = next.view;
    locale = next.locale;
    setLocale(locale);
    const f = fuelFromUrl(window.location.search);
    if (f) settings.fuel = f;
    void ensureChargers();
    render();
    refreshMap();
  });

  bind();
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    const ev = e as Event & { prompt?: () => Promise<void> };
    if (typeof ev.prompt !== "function") return;
    installPrompt = { prompt: () => ev.prompt!() };
    render();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installDismissed = true;
    persistInstallDismissed();
    render();
  });
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
      const historyHandle = target.closest<HTMLElement>(".history-head");
      if (headerHandle) startSheetDrag(e, "header", headerHandle);
      else if (listHandle) startSheetDrag(e, "list", listHandle);
      else if (historyHandle) startSheetDrag(e, "history", historyHandle);
    });

    function startSheetDrag(
      e: PointerEvent,
      kind: "header" | "list" | "history",
      handle: HTMLElement,
    ): void {
      const el =
        kind === "header"
          ? root.querySelector<HTMLElement>("#header")
          : kind === "list"
            ? root.querySelector<HTMLElement>("#list")
            : root.querySelector<HTMLElement>(".history-panel");
      if (!el) return;
      try {
        handle.setPointerCapture(e.pointerId);
      } catch {
        /* capture is optional; window listeners still track the drag */
      }
      const startY = e.clientY;
      const startX = e.clientX;
      const wasMin =
        kind === "header" ? headerMinimized : kind === "list" ? listMinimized : historyMinimized;
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
        } else if (kind === "list") {
          if (next !== listMinimized) {
            listMinimized = next;
            renderList();
          }
        } else if (next !== historyMinimized) {
          historyMinimized = next;
          applyHistoryMinimized();
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
      if (act === "free-why") {
        tEl.setAttribute(
          "aria-expanded",
          tEl.getAttribute("aria-expanded") === "true" ? "false" : "true",
        );
      } else if (act === "view") {
        view = tEl.dataset.view === "history" ? "history" : "map";
        headerMinimized = false;
        openPanel = null;
        if (view === "history") historyMinimized = false;
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
        const g = tEl.dataset.group as FuelGroup;
        if (!FUEL_GROUPS.includes(g)) return;
        settings.fuel = FUEL_BY_GROUP[g][0];
        persistFuel();
        onFuelChange();
      } else if (act === "settings") {
        openPanel = openPanel === "settings" ? null : "settings";
        render();
      } else if (act === "report") {
        openPanel = openPanel === "report" ? null : "report";
        if (reportStatus !== "sending") reportStatus = "idle";
        render();
        root
          .querySelector<HTMLElement>(reportCategory ? "#report-text" : "input[name='report-kind']")
          ?.focus();
      } else if (act === "refresh") {
        tEl.setAttribute("disabled", "true");
        tEl.setAttribute("aria-busy", "true");
        void refreshWebsite(browserRefreshDeps());
      } else if (act === "close-panel") {
        openPanel = null;
        render();
      } else if (act === "station") {
        openStation(tEl.dataset.id!);
      } else if (act === "route") {
        void chooseRoute(Number(tEl.dataset.index));
      } else if (act === "clear-dest") {
        clearDestination();
      } else if (act === "clear-start") {
        clearStart();
      } else if (act === "swap-dest") {
        swapStartAndDestination();
      } else if (act === "toggle-list") {
        listMinimized = !listMinimized;
        renderList();
      } else if (act === "toggle-header") {
        headerMinimized = !headerMinimized;
        applyHeaderMinimized();
      } else if (act === "toggle-history") {
        historyMinimized = !historyMinimized;
        applyHistoryMinimized();
      } else if (act === "install") {
        void promptInstall();
      } else if (act === "install-dismiss") {
        installDismissed = true;
        persistInstallDismissed();
        render();
      } else if (act === "history-all") {
        hiddenHistoryBrands = toggleAllHistoryBrands(hiddenHistoryBrands, historyBrandIds());
        applyHistoryVisibility();
      } else if (act === "history-brand" && tEl.dataset.brand) {
        hiddenHistoryBrands = toggleHistoryBrand(hiddenHistoryBrands, tEl.dataset.brand);
        applyHistoryVisibility();
      } else if (act === "history-stat" && tEl.dataset.stat) {
        const next = tEl.dataset.stat as HistoryStat;
        if (HISTORY_STATS.includes(next) && (next !== settings.historyStat || historySpot)) {
          historySpot = false;
          settings.historyStat = next;
          saveSettings(settings);
          render();
        }
      } else if (act === "history-spot" && !historySpot) {
        historySpot = true;
        render();
      } else if (act === "report-image-pick") {
        root.querySelector<HTMLInputElement>("#report-image")?.click();
      } else if (act === "report-image-remove") {
        clearReportImage();
        renderPanels();
        root.querySelector<HTMLElement>("[data-act='report-image-pick']")?.focus();
      } else if (act === "report-github") {
        const form = { category: reportCategory ?? "bug", description: reportDraft } as const;
        window.open(githubIssueLink(form, reportContext()), "_blank", "noopener");
      }
    });

    // A screenshot pasted while writing feedback becomes its picture; pasted text stays text.
    root.addEventListener("paste", (e) => {
      if (openPanel !== "report" || !reportCategory || !REPORT_URL) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      e.preventDefault();
      void attachReportImage(file);
    });

    root.addEventListener("submit", (e) => {
      if ((e.target as HTMLElement).id !== "report-form") return;
      e.preventDefault();
      void submitReport();
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
      else if (el.id === "set-ev-cons")
        settings.evConsumption = num(el.value, DEFAULT_SETTINGS.evConsumption);
      else if (el.id === "set-time") settings.timeValue = num(el.value, 0);
      else if (el.id === "report-text") reportDraft = el.value;
    });
    // The browser's own ✕ in a search field fires `search` with an empty value (so does Enter on
    // an empty field). Capture it: the event does not reach `root` by bubbling in every browser.
    root.addEventListener(
      "search",
      (e) => {
        const el = e.target as HTMLInputElement;
        if (el.value !== "") return;
        if (el.id === "dest" && (endHit || destStatus !== "idle")) clearDestination();
        else if (el.id === "start") clearStart();
      },
      true,
    );
    root.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.id === "report-image") {
        const file = el.files?.[0];
        el.value = "";
        void attachReportImage(file);
        return;
      }
      if (el.name === "report-kind") {
        reportCategory = REPORT_CATEGORIES.find((c) => c === el.value) ?? null;
        renderPanels();
        // The re-render replaced the radio: keep focus on it so arrow keys still switch options.
        root.querySelector<HTMLInputElement>(`#report-kind-${el.value}`)?.focus();
        return;
      }
      if (el.id === "set-high-accuracy") {
        settings.highAccuracyLocation = el.checked;
        saveSettings(settings);
        setMapGeolocateAccuracy(map, el.checked);
        if (startIsGps) requestLocation(true);
        return;
      }
      if (el.id === "set-detour") {
        settings.maxDetourKm = clampDetourKm(el.value);
        el.value = String(settings.maxDetourKm);
        saveSettings(settings);
        // Detours are cached per route, so this only re-sorts stations already checked.
        if (routeLine) {
          void evaluateRouteStations(routeLine).then(() => {
            refreshMap();
            renderList();
          });
        }
        return;
      }
      if (el.id.startsWith("set-brand-") && el.dataset.brand) {
        const brand = el.dataset.brand;
        const next = new Set(excludedFor(settings));
        if (el.checked) next.delete(brand);
        else next.add(brand);
        // Fuel brands and charging networks are filtered separately ("Kita" exists in both).
        if (isEv()) settings.excludedEvBrands = [...next].sort();
        else settings.excludedBrands = [...next].sort();
        saveSettings(settings);
        applyBrandFilter();
        return;
      }
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

  /** Back to "my location" with an empty field; the placeholder already says so. */
  function clearStart(): void {
    startHit = null;
    startIsGps = true;
    startQuery = "";
    pickMode = null;
    if (!userLocation) requestLocation(true);
    if (endHit) void runRoute();
    else render();
  }

  function currentEndpoints(): Endpoints {
    return { start: startIsGps ? null : startHit, end: endHit, endIsHere };
  }

  function hereForSwap(): LngLat | null {
    return userLocation && inLithuania(userLocation) ? userLocation : null;
  }

  function swapStartAndDestination(): void {
    const next = swapEndpoints(currentEndpoints(), hereForSwap(), t("route.myLocation"));
    if (!next) return;
    startHit = next.start;
    startIsGps = next.start === null;
    startQuery = next.start?.label ?? (userLocation ? t("route.myLocation") : "");
    if (startIsGps && userLocation) void fillGpsStartLabel(userLocation);
    endHit = next.end;
    endIsHere = next.endIsHere;
    destQuery = next.end?.label ?? "";
    pickMode = null;
    if (endHit) void runRoute();
    else clearDestination();
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
    endIsHere = false;
    destQuery = hit.label;
    openPanel = null;
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
    endIsHere = false;
    destQuery = "";
    pendingDest = false;
    destStatus = "idle";
    routeLine = null;
    routeOptions = [];
    routeRows = [];
    dashedRows = [];
    extraMapStationIds = new Set();
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

  function isEv(): boolean {
    return settings.fuel === "EV";
  }

  /** Fuel stations, or EV chargers once loaded when the EV chip is on. */
  function activeStations(): Station[] {
    return isEv() ? (chargers ?? []) : data.stations;
  }

  async function ensureChargers(): Promise<void> {
    if (!isEv() || chargers || chargersLoading) return;
    chargersLoading = true;
    renderList();
    chargers = await loadChargers();
    chargersLoading = false;
    if (!isEv()) return;
    if (routeLine) await evaluateRouteStations(routeLine);
    refreshMap();
    render();
  }

  /** Brand filter is replaced, never mutated, so the array identity keys the cache. */
  function includedStations(): Station[] {
    const source = activeStations();
    const excluded = excludedFor(settings);
    if (includedCache?.excluded !== excluded || includedCache.source !== source) {
      includedCache = {
        excluded,
        source,
        stations: source.filter((s) => isBrandIncluded(s.brand, excluded)),
      };
    }
    return includedCache.stations;
  }

  function applyBrandFilter(): void {
    if (routeLine) {
      void evaluateRouteStations(routeLine).then(() => {
        refreshMap();
        renderList();
        if (view === "history") render();
      });
      return;
    }
    refreshMap();
    renderList();
    if (view === "history") render();
  }

  function onFuelChange(): void {
    popup?.remove();
    void ensureChargers();
    if (routeLine) {
      void evaluateRouteStations(routeLine).then(() => {
        refreshMap();
        render();
      });
    }
    refreshMap();
    render();
  }

  function choosingRoute(): boolean {
    return !routeLine && routeOptions.length > 1;
  }

  function refreshMap(): void {
    // While the driver picks a route, no station is weighed yet.
    const routeIds = routeLine ? mapStationIds() : choosingRoute() ? new Set<string>() : null;
    const stations = stationsForRouteMap(includedStations(), routeIds);
    const shown = routeLine
      ? [...routeRows, ...dashedRows].filter((r) => routeIds?.has(r.station.id))
      : [];
    const cheapestOnId = shown.length ? orderRouteRows(shown).cheapestOn?.station.id : undefined;
    const emphasis = routeLine
      ? Object.fromEntries(
          shown.map((r) => [
            r.station.id,
            routeStationEmphasis(r.kind, r.station.id === cheapestOnId),
          ]),
        )
      : undefined;
    setStationData(map, stations, data.prices, settings.fuel, settings, emphasis);
    setRouteData(map, routeLine?.geometry ?? null, routeLine ? viaGeometries() : []);
    setRouteOptions(
      map,
      routeOptions.length > 1 ? routeOptions.map((r) => r.geometry) : [],
      routeLine ? routeOptions.indexOf(routeLine) : null,
    );
  }

  function mapStationIds(): Set<string> {
    const ids = mapRouteStationIds(routeRows, extraMapStationIds);
    for (const r of dashedRows) ids.add(r.station.id);
    return ids;
  }

  function viaGeometries(): LngLat[][] {
    const ids = mapStationIds();
    return routeRows
      .filter((r) => ids.has(r.station.id))
      .map((r) => r.viaGeometry)
      .filter((g): g is LngLat[] => Boolean(g && g.length >= 2));
  }

  function collapseForMapFocus(): void {
    headerMinimized = true;
    listMinimized = true;
    openPanel = null;
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
      locationPositionOptions(settings.highAccuracyLocation),
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
    const routes = await fetchRoutes(start, end, settings.routePreference);
    routeLine = null;
    routeOptions = routes;
    routeRows = [];
    dashedRows = [];
    extraMapStationIds = new Set();
    if (!routes.length) {
      destStatus = "not-found";
      setEndpointMarkers(null, null);
      refreshMap();
      render();
      return;
    }
    setEndpointMarkers(start, end);
    if (routes.length === 1) {
      await chooseRoute(0);
      return;
    }
    // Several ways there: the driver picks one before any station is weighed.
    destStatus = "idle";
    headerMinimized = true;
    listMinimized = false;
    openPanel = null;
    refreshMap();
    render();
    // The list stays open beside or under the map, so fit around it, not under it.
    const box = (sel: string) => root.querySelector<HTMLElement>(sel)?.getBoundingClientRect();
    fitRoute(
      map,
      routes[0].geometry,
      routes.slice(1).map((r) => r.geometry),
      openListPadding(
        mapDiv.getBoundingClientRect(),
        box("#header") ?? null,
        box(".sheet") ?? null,
      ),
    );
  }

  async function chooseRoute(index: number): Promise<void> {
    const res = routeOptions[index];
    if (!res || res === routeLine) return;
    routeLine = res;
    // The last route's stations must not show on this one while its detours load.
    routeRows = [];
    dashedRows = [];
    extraMapStationIds = new Set();
    destStatus = "routing";
    refreshMap();
    render();
    await evaluateRouteStations(res);
    if (routeLine !== res) return;
    destStatus = "idle";
    refreshMap();
    focusRoute();
  }

  async function evaluateRouteStations(res: RouteResult): Promise<void> {
    const start = res.geometry[0];
    const end = res.geometry[res.geometry.length - 1];
    if (!start || !end) {
      routeRows = [];
      extraMapStationIds = new Set();
      return;
    }
    const seq = ++routeEvalSeq;
    // Dashed lines are redrawn below; until then the old picks would carry stale prices.
    dashedRows = [];
    const nearby: NearbyStation[] = [];
    for (const s of includedStations()) {
      const price = data.prices?.prices[s.id]?.[settings.fuel]?.price;
      if (price == null) continue;
      const lineKm = distanceToPolylineKm({ lat: s.lat, lon: s.lon }, res.geometry);
      if (lineKm <= DETOUR_CORRIDOR_KM) nearby.push({ station: s, price, lineKm });
    }
    if (routeDetours?.route !== res) routeDetours = { route: res, byId: new Map() };
    const detours = routeDetours.byId;
    const unchecked = detourCandidates(nearby).filter((c) => !detours.has(c.station.id));
    if (unchecked.length) {
      // Show what is already known for this fuel while the router answers for the rest.
      const pending = new Set(unchecked.map((c) => c.station.id));
      routeRows = onTheWayRows(
        res,
        nearby.filter((c) => !pending.has(c.station.id)),
        detours,
      );
      const fetched = await fetchDetours(
        unchecked.map((c) => {
          const { leave, rejoin } = detourWindow(res.geometry, c.station);
          return { leave, stop: c.station, rejoin };
        }),
      );
      if (fetched) unchecked.forEach((c, i) => detours.set(c.station.id, fetched[i] ?? null));
      // A newer route, fuel or brand filter has taken over while the router answered.
      if (seq !== routeEvalSeq || routeLine !== res) return;
    }
    const onWay = onTheWayRows(res, nearby, detours);
    routeRows = onWay;
    extraMapStationIds = new Set(
      [...extraMapStationIds].filter((id) => onWay.some((r) => r.station.id === id)),
    );
    const mapIds = mapRouteStationIds(onWay, extraMapStationIds);
    await Promise.all(
      onWay.filter((row) => mapIds.has(row.station.id)).map((row) => attachViaRoute(row, res)),
    );
    if (seq !== routeEvalSeq || routeLine !== res) return;
    const dashed = await dashedLineRows();
    if (seq !== routeEvalSeq || routeLine !== res) return;
    dashedRows = dashed;
  }

  /**
   * On each dashed via-route on the map, the one station worth marking (cheapestOnDashed): the
   * cheapest few near each line get a road detour check against that line, so one across the
   * road from it is left out.
   */
  async function dashedLineRows(): Promise<RouteStationRow[]> {
    const onWayIds = new Set(routeRows.map((r) => r.station.id));
    const ids = mapRouteStationIds(routeRows, extraMapStationIds);
    const priced: Array<{ station: Station; price: number }> = [];
    for (const s of includedStations()) {
      const price = data.prices?.prices[s.id]?.[settings.fuel]?.price;
      if (price != null && !onWayIds.has(s.id)) priced.push({ station: s, price });
    }
    const lines: Array<{ target: RouteStationRow; line: LngLat[]; candidates: DashedCandidate[] }> =
      [];
    for (const target of routeRows) {
      const line = target.viaGeometry;
      if (!ids.has(target.station.id) || !line || line.length < 2) continue;
      const box = boundsAround(line, DASHED_ROUTE_KM);
      const candidates = priced
        .filter(({ station: s, price }) => price < target.price && box.contains(s))
        .map(({ station, price }) => ({
          station,
          price,
          dashedKm: distanceToPolylineKm(station, line),
          detourKm: undefined as number | null | undefined,
          detourMin: 0,
        }))
        .filter((c) => c.dashedKm <= DASHED_ROUTE_KM)
        .sort(byPrice)
        .slice(0, MAX_DASHED_CHECKS);
      if (candidates.length) lines.push({ target, line, candidates });
    }
    const checks = lines.flatMap(({ line, candidates }) => candidates.map((c) => ({ line, c })));
    const fetched = await fetchDetours(
      checks.map(({ line, c }) => {
        const { leave, rejoin } = detourWindow(line, c.station);
        return { leave, stop: c.station, rejoin };
      }),
    );
    if (fetched) {
      checks.forEach(({ c }, i) => {
        c.detourKm = fetched[i]?.extraKm ?? null;
        c.detourMin = fetched[i]?.extraMin ?? 0;
      });
    }
    const rows = new Map<string, RouteStationRow>();
    for (const { target, line, candidates } of lines) {
      const pick = cheapestOnDashed(target.price, candidates, settings.maxDetourKm);
      if (!pick || rows.has(pick.station.id)) continue;
      const nearest = nearestPointOnPolyline(pick.station, line);
      rows.set(pick.station.id, {
        station: pick.station,
        price: pick.price,
        kind: "detour",
        distFromStartKm: distanceAlongLineKm(line, nearest.index, nearest.point),
        // Taking the dashed route, then stopping on it.
        extraKm: (target.viaExtraKm ?? target.extraKm) + (pick.detourKm ?? 0),
        extraMin: (target.viaExtraMin ?? target.extraMin) + pick.detourMin,
        roadDetour: true,
        benefit: priceBenefit(target.price, pick.price, settings.fuel),
        viaGeometry: line,
      });
    }
    return [...rows.values()];
  }

  function onTheWayRows(
    res: RouteResult,
    nearby: NearbyStation[],
    detours: Map<string, Detour | null>,
  ): RouteStationRow[] {
    const onWay: RouteStationRow[] = [];
    for (const { station: s, price, lineKm } of nearby) {
      const detour = detours.get(s.id);
      if (!isOnTheWay(lineKm, detour, settings.maxDetourKm)) continue;
      const nearest = nearestPointOnPolyline({ lat: s.lat, lon: s.lon }, res.geometry);
      onWay.push({
        station: s,
        price,
        kind: "on",
        distFromStartKm: distanceAlongLineKm(res.geometry, nearest.index, nearest.point),
        extraKm: detour?.extraKm ?? 0,
        extraMin: detour?.extraMin ?? 0,
        roadDetour: detour != null,
        benefit: priceBenefit(price, price, settings.fuel),
      });
    }
    const baselinePrice = onWay.length ? Math.min(...onWay.map((r) => r.price)) : undefined;
    for (const row of onWay) {
      if (baselinePrice == null) continue;
      row.benefit = priceBenefit(baselinePrice, row.price, settings.fuel);
    }
    return onWay;
  }

  async function attachViaRoute(row: RouteStationRow, res: RouteResult): Promise<void> {
    if (row.viaGeometry && row.viaGeometry.length >= 2) return;
    const start = res.geometry[0];
    const end = res.geometry[res.geometry.length - 1];
    if (!start || !end) return;
    const via = { lat: row.station.lat, lon: row.station.lon };
    const viaRoute = await fetchRoute(start, end, settings.routePreference, via);
    if (viaRoute) {
      row.viaExtraKm = Math.max(0, viaRoute.distanceKm - res.distanceKm);
      row.viaExtraMin = Math.max(0, viaRoute.durationMin - res.durationMin);
      if (!row.roadDetour) {
        row.extraKm = row.viaExtraKm;
        row.extraMin = row.viaExtraMin;
      }
      row.viaGeometry = viaRoute.geometry;
    } else {
      row.viaGeometry = [start, via, end];
    }
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
    void revealStation(id);
  }

  async function revealStation(id: string): Promise<void> {
    const s = activeStations().find((x) => x.id === id);
    if (!s) return;
    const routeRow =
      routeRows.find((r) => r.station.id === id) ?? dashedRows.find((r) => r.station.id === id);
    if (routeLine && routeRow?.kind === "on") {
      const res = routeLine;
      extraMapStationIds.add(id);
      await attachViaRoute(routeRow, res);
      const seq = routeEvalSeq;
      const dashed = await dashedLineRows();
      if (seq === routeEvalSeq && routeLine === res) dashedRows = dashed;
      refreshMap();
    }
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
    popup = new maplibregl.Popup({
      offset: 16,
      maxWidth: "min(280px, calc(100vw - 24px))",
      className: "station-popup",
    })
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
    renderPanels();
    renderList();
    const banner = root.querySelector("#banner")!;
    banner.innerHTML = statusHtml();
    root.querySelector(".app")?.classList.toggle("has-route", Boolean(routeLine));
    root.querySelector(".app")?.classList.toggle("is-history", view === "history");
    if (view === "history" && !historyFile && !historyLoading) void ensureHistory();
    const history = root.querySelector("#history")!;
    history.innerHTML = view === "history" ? historyHtml() : "";
    void paintHistoryChart();
    syncMapControls();
  }

  async function ensureHistory(): Promise<void> {
    if (historyFile || historyLoading) {
      if (historyFile && view === "history") void paintHistoryChart();
      return;
    }
    historyLoading = true;
    historyFile = await loadHistory();
    historyLoading = false;
    if (view === "history") render();
  }

  /** EV's "Spot" tab: one Nord Pool line, no per-network stats or provider filter. */
  function isSpotView(): boolean {
    return isEv() && historySpot;
  }

  function historyViewSeries(): HistoryHourSeries | undefined {
    if (isSpotView()) return historyFile?.spot;
    const series = historyFile?.byFuel[settings.fuel];
    const forStat = seriesForStat(series, settings.historyStat);
    return forStat ? filterSeries(forStat, excludedFor(settings)) : undefined;
  }

  function historyHtml(): string {
    const filtered = historyViewSeries();
    const toggle = `<button type="button" class="history-head" data-act="toggle-history" aria-expanded="${historyMinimized ? "false" : "true"}" aria-label="${escapeHtml(historyMinimized ? t("history.expand") : t("history.collapse"))}">
        <span class="history-handle" aria-hidden="true"></span>
        <span class="history-head-copy">
          <h2>${escapeHtml(t("history.title"))}</h2>
          ${updatedMetaHtml(isSpotView() ? data.meta?.spotUpdatedAt : undefined)}
        </span>
        <span class="history-chevron" aria-hidden="true">${historyMinimized ? "▴" : "▾"}</span>
      </button>`;
    if (historyLoading && !historyFile) {
      return `<section class="history-panel${historyMinimized ? " is-min" : ""}" aria-label="${escapeHtml(t("history.title"))}">
      ${toggle}
      <div class="history-body">
        <p class="history-caption">${escapeHtml(t("history.loading"))}</p>
      </div>
    </section>`;
    }
    const hasPoints = Boolean(
      filtered && Object.values(filtered.brands).some((row) => row.some((v) => v != null)),
    );
    const caption = hasPoints
      ? isSpotView()
        ? spotCaptionHtml(filtered)
        : isEv()
          ? `<p class="history-caption">${escapeHtml(t("history.evCaption"))}</p>`
          : ""
      : `<p class="history-caption">${escapeHtml(t("history.empty"))}</p>`;
    return `<section class="history-panel${historyMinimized ? " is-min" : ""}" aria-label="${escapeHtml(t("history.title"))}">
      ${toggle}
      <div class="history-body">
        ${historyStatHtml()}
        <div class="history-chart-stack">
          <div id="history-chart"></div>
          ${isSpotView() ? `<div id="history-legend"></div>` : historyLegendHtml(filtered)}
        </div>
        ${caption}
      </div>
    </section>`;
  }

  /** What the spot price includes, and its cheapest hours from now on. */
  function spotCaptionHtml(series: HistoryHourSeries | undefined): string {
    const ranges = series
      ? cheapestHourRanges(series, undefined, new Date().toISOString(), { ahead: true })
      : [];
    const cheap = ranges.length
      ? `<p class="history-caption history-cheap">${escapeHtml(t("history.cheapAhead", { ranges: formatCheapRanges(ranges) }))}</p>`
      : "";
    return `${cheap}<p class="history-caption">${escapeHtml(t("history.spotCaption"))}</p>`;
  }

  function historyStatHtml(): string {
    const chip = (act: string, label: string, on: boolean, data = "") =>
      `<button type="button" class="history-chip${on ? " is-on" : ""}" data-act="${act}"${data} aria-pressed="${on ? "true" : "false"}">${escapeHtml(label)}</button>`;
    const buttons = HISTORY_STATS.map((stat) =>
      chip(
        "history-stat",
        t(`history.mode.${stat}` as MessageKey),
        !isSpotView() && settings.historyStat === stat,
        ` data-stat="${stat}"`,
      ),
    ).join("");
    const spot = isEv() ? chip("history-spot", t("history.mode.spot"), isSpotView()) : "";
    return `<div class="history-stat" role="group" aria-label="${escapeHtml(t("history.stat"))}">${buttons}${spot}</div>`;
  }

  function historyBrandIds(): string[] {
    return chartBrands(historyViewSeries()).map((b) => b.id);
  }

  /** Charging networks by the name their operator uses; brands keep their own names. */
  function historyLabels(): ReadonlyMap<string, string> {
    return isEv() && chargers ? networkLabels(chargers) : new Map();
  }

  function historyLegendHtml(filtered: HistoryHourSeries | undefined): string {
    const brands = chartBrands(filtered);
    if (brands.length === 0) return `<div id="history-legend"></div>`;
    const labels = historyLabels();
    const ids = brands.map((b) => b.id);
    const allOn = allHistoryBrandsOn(hiddenHistoryBrands, ids);
    const chips = brands
      .map((b, i) => {
        const on = !hiddenHistoryBrands.has(b.id);
        return `<button type="button" class="history-chip${on ? " is-on" : ""}" data-act="history-brand" data-brand="${escapeHtml(b.id)}" aria-pressed="${on ? "true" : "false"}">
        <span class="history-chip-swatch" style="background:${escapeHtml(brandColor(b.id, i))}"></span>
        ${escapeHtml(labels.get(b.id) ?? brandLabel(b.id))}
      </button>`;
      })
      .join("");
    return `<div id="history-legend" class="history-legend" role="group" aria-label="${escapeHtml(t("history.legend"))}">
      <button type="button" class="history-chip history-chip-all${allOn ? " is-on" : ""}" data-act="history-all" aria-pressed="${allOn ? "true" : "false"}">${escapeHtml(t("history.all"))}</button>
      ${chips}
    </div>`;
  }

  function applyHistoryVisibility(): void {
    const legend = root.querySelector("#history-legend");
    const filtered = historyViewSeries();
    if (legend) {
      const next = document.createElement("div");
      next.innerHTML = historyLegendHtml(filtered);
      const replacement = next.firstElementChild;
      if (replacement) legend.replaceWith(replacement);
    }
    if (historyPlot) historyPlot.setHidden(hiddenHistoryBrands);
    else void paintHistoryChart();
  }

  async function paintHistoryChart(): Promise<void> {
    historyPlot?.destroy();
    historyPlot = null;
    if (view !== "history" || historyMinimized) return;
    const el = root.querySelector<HTMLElement>("#history-chart");
    if (!el || !historyFile) return;
    const filtered = historyViewSeries();
    const { mountHistoryChart } = await import("./history-view.ts");
    if (view !== "history" || historyMinimized) return;
    historyPlot = mountHistoryChart(el, filtered, hiddenHistoryBrands, {
      fuel: settings.fuel,
      ...(isSpotView() ? { now: new Date().toISOString() } : {}),
      labels: historyLabels(),
    });
  }

  function applyHistoryMinimized(): void {
    const panel = root.querySelector(".history-panel");
    if (!panel) return;
    panel.classList.toggle("is-min", historyMinimized);
    const btn = panel.querySelector<HTMLButtonElement>("[data-act='toggle-history']");
    if (btn) {
      btn.setAttribute("aria-expanded", historyMinimized ? "false" : "true");
      btn.setAttribute(
        "aria-label",
        historyMinimized ? t("history.expand") : t("history.collapse"),
      );
      const chev = btn.querySelector(".history-chevron");
      if (chev) chev.textContent = historyMinimized ? "▴" : "▾";
    }
    if (historyMinimized) {
      historyPlot?.destroy();
      historyPlot = null;
    } else {
      void paintHistoryChart();
    }
  }

  function renderList(): void {
    const list = root.querySelector("#list")!;
    const setList = (html: string): void => {
      // Map moves often leave the list unchanged; skip reparsing hundreds of rows.
      if (html === listHtml && list.childElementCount) return;
      listHtml = html;
      list.innerHTML = html;
    };
    if (choosingRoute()) {
      setList(routeChoiceHtml());
      return;
    }
    const rows = [...routeRows, ...dashedRows];
    if (routeLine && rows.length) {
      const { cheapestOn, cheapestOverall, ordered } = orderRouteRows(rows);
      setList(
        listWrap(
          ordered.map((r, i) => {
            const isCheapestOn = cheapestOn?.station.id === r.station.id;
            const isCheapestOverall = cheapestOverall?.station.id === r.station.id;
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
              r.kind === "detour"
                ? `<span class="badge">${escapeHtml(t("route.cheapestDashed"))}</span>`
                : "",
            ].join("");
            const extra = r.extraKm >= 0.1 ? t("route.detour", { km: formatKm(r.extraKm) }) : "";
            const pinned = isCheapestOn || isCheapestOverall;
            const rowClass = [
              pinned && i < 2 ? "is-pick" : "",
              r.kind === "on" ? "is-on-route" : "is-detour",
            ]
              .filter(Boolean)
              .join(" ");
            return stationRow(r.station, r.price, r.distFromStartKm, extra, rowClass, badges);
          }),
          undefined,
          routeSwitchHtml(),
        ),
      );
      return;
    }
    if (routeLine && endHit && rows.length === 0 && destStatus !== "routing") {
      setList(listWrap([], t(isEv() ? "route.noChargers" : "route.noStations"), routeSwitchHtml()));
      return;
    }
    if (isEv() && !chargers) {
      setList(listWrap([], t("list.loadingChargers")));
      return;
    }
    const inView = stationsInView(map, includedStations()).map((s) => ({
      s,
      price: data.prices?.prices[s.id]?.[settings.fuel]?.price,
    }));
    const priced = inView
      .filter((r): r is { s: Station; price: number } => r.price != null)
      .sort((a, b) => a.price - b.price || a.s.id.localeCompare(b.s.id));
    // Few chargers have a published price, so EV also lists the unpriced ones after them.
    const unpriced = isEv()
      ? inView
          .filter((r) => r.price == null)
          .sort((a, b) => a.s.name.localeCompare(b.s.name) || a.s.id.localeCompare(b.s.id))
      : [];
    if (priced.length === 0 && unpriced.length === 0) {
      setList(listWrap([], t(isEv() ? "list.emptyEv" : "list.empty")));
      return;
    }
    const last = priced.length - 1;
    setList(
      listWrap([
        ...priced.map((r, i) => {
          const badges = [
            i === 0 ? `<span class="badge">${escapeHtml(t("list.cheapest"))}</span>` : "",
            i === last && last > 0
              ? `<span class="badge muted">${escapeHtml(t("list.expensive"))}</span>`
              : "",
          ].join("");
          return stationRow(r.s, r.price, undefined, "", i === 0 ? "is-pick" : "", badges);
        }),
        ...unpriced.map((r) => stationRow(r.s, undefined, undefined, "", "is-unpriced")),
      ]),
    );
  }

  /** `at` overrides the pump-price time, e.g. with when the spot price was last fetched. */
  function updatedMetaHtml(at?: string): string {
    const updatedAt = at ?? lastUpdatedAt(data);
    if (!updatedAt) return "";
    const text = t("list.updated", { time: formatDateTime(updatedAt) });
    return `<p class="list-meta" title="${escapeHtml(text)}"><span class="list-updated">${escapeHtml(text)}</span></p>`;
  }

  function listWrap(items: string[], empty?: string, lead = ""): string {
    const count = items.length;
    const ev = isEv();
    const base = t(ev ? "list.titleEv" : "list.title");
    const title = count ? `${base} · ${tPlural(ev ? "chargers" : "stations", count)}` : base;
    const body = empty
      ? `<p class="empty">${escapeHtml(empty)}</p>`
      : `<ul class="station-list">${items.join("")}</ul>`;
    return sheetHtml(title, updatedMetaHtml(), lead + body);
  }

  function sheetHtml(title: string, meta: string, body: string): string {
    return `<div class="sheet${listMinimized ? " is-min" : ""}">
      <button type="button" class="list-head" data-act="toggle-list" aria-expanded="${listMinimized ? "false" : "true"}" aria-label="${escapeHtml(listMinimized ? t("list.expand") : t("list.collapse"))}">
        <span class="list-handle" aria-hidden="true"></span>
        <span class="list-head-copy">
          <h2>${escapeHtml(title)}</h2>
          ${meta}
        </span>
        <span class="list-chevron" aria-hidden="true">${listMinimized ? "▴" : "▾"}</span>
      </button>
      <div class="list-body">${body}</div>
    </div>`;
  }

  /** The routes to pick from, best first, each in its color on the map. */
  function routeChoiceHtml(): string {
    const items = routeOptions.map((r, i) => {
      const color = ROUTE_OPTION_COLORS[i % ROUTE_OPTION_COLORS.length];
      const note = i === 0 && r.profile === "fastest" ? t("route.fastest") : "";
      return `<li><button type="button" class="route-option" data-act="route" data-index="${i}">
        <span class="route-swatch" style="background:${color}" aria-hidden="true"></span>
        <span class="route-option-main">
          <strong>${escapeHtml(t("route.option", { n: i + 1 }))}</strong>
          ${note ? `<small>${escapeHtml(note)}</small>` : ""}
        </span>
        <span class="route-option-meta">${escapeHtml(formatKm(r.distanceKm))} · ${escapeHtml(formatDuration(r.durationMin))}</span>
      </button></li>`;
    });
    const hint = `<p class="list-meta">${escapeHtml(t("route.chooseHint"))}</p>`;
    return sheetHtml(t("route.choose"), hint, `<ul class="route-options">${items.join("")}</ul>`);
  }

  /** Once a route is picked, the others stay one tap away above its stations. */
  function routeSwitchHtml(): string {
    if (!routeLine || routeOptions.length < 2) return "";
    const chosen = routeOptions.indexOf(routeLine);
    const chips = routeOptions.map(
      (r, i) =>
        `<button type="button" class="route-chip${i === chosen ? " is-on" : ""}" data-act="route" data-index="${i}" aria-pressed="${i === chosen ? "true" : "false"}">${escapeHtml(t("route.option", { n: i + 1 }))} · ${escapeHtml(formatDuration(r.durationMin))}</button>`,
    );
    return `<div class="route-switch" role="group" aria-label="${escapeHtml(t("route.choose"))}">${chips.join("")}</div>`;
  }

  function stationRow(
    s: Station,
    price: number | undefined,
    distKm?: number,
    extra = "",
    className = "",
    badges = "",
  ): string {
    const dist = distKm != null ? formatKm(distKm) : "";
    const metaLine = [dist, extra].filter(Boolean).join(" · ");
    const addr = stationAddress(s);
    const cls = ["station-row", className].filter(Boolean).join(" ");
    return `<li><button type="button" class="${cls}" data-act="station" data-id="${escapeHtml(s.id)}">
      <span class="swatch" data-brand="${escapeHtml(s.brand)}"></span>
      <span class="station-main">
        ${badges ? `<span class="station-badges">${badges}</span>` : ""}
        <strong>${escapeHtml(s.name)}</strong>
        <small class="station-addr" title="${escapeHtml(addr)}">${escapeHtml(shortAddress(addr))}</small>
        ${metaLine ? `<small class="station-eta">${escapeHtml(metaLine)}</small>` : ""}
      </span>
      <span class="station-price">${escapeHtml(price == null ? "—" : formatPrice(price, settings.fuel))}${
        isEv() && price === 0
          ? `<span class="free-why-mark" title="${escapeHtml(freeReasonText(s))}" aria-hidden="true">?</span>`
          : ""
      }</span>
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
    const canSwap = swapEndpoints(currentEndpoints(), hereForSwap(), "") !== null;
    return `
      <div class="header-body">
        <div class="topbar">
          <a class="logo" data-act="view" data-view="map" href="${pathFor("map", locale)}">${escapeHtml(t("app.name"))}</a>
          <div class="topbar-end">
            <div class="lang">
              <a data-act="locale" data-locale="lt" href="${escapeHtml(hrefFor(view, "lt", settings.fuel))}" hreflang="lt" class="${locale === "lt" ? "on" : ""}">LT</a>
              <a data-act="locale" data-locale="en" href="${escapeHtml(hrefFor(view, "en", settings.fuel))}" hreflang="en" class="${locale === "en" ? "on" : ""}">EN</a>
            </div>
            <nav class="nav-views">
              <a class="icon-btn ${view === "map" ? "on" : ""}" data-act="view" data-view="map" href="${escapeHtml(hrefFor("map", locale, settings.fuel))}">${escapeHtml(t("nav.stations"))}</a>
              <a class="icon-btn ${view === "history" ? "on" : ""}" data-act="view" data-view="history" href="${escapeHtml(hrefFor("history", locale, settings.fuel))}">${escapeHtml(t("nav.history"))}</a>
            </nav>
            <a class="icon-btn donate-btn" href="${DONATE_URL}" target="_blank" rel="noopener noreferrer">
              ${DONATE_HEART}
              ${escapeHtml(t("action.donate"))}
            </a>
          </div>
          <div class="topbar-tools">
            <button type="button" class="icon-btn icon-tool icon-report ${openPanel === "report" ? "on" : ""}" data-act="report" aria-label="${escapeHtml(t("report.open"))}" title="${escapeHtml(t("report.open"))}" aria-expanded="${openPanel === "report" ? "true" : "false"}">${REPORT_ICON}</button>
            <button type="button" class="icon-btn icon-tool icon-refresh" data-act="refresh" aria-label="${escapeHtml(t("action.refresh"))}" title="${escapeHtml(t("action.refresh"))}">${REFRESH_ICON}</button>
            <button type="button" class="icon-btn icon-tool icon-settings ${openPanel === "settings" ? "on" : ""}" data-act="settings" aria-label="${escapeHtml(t("action.settings"))}">${SETTINGS_ICON}</button>
          </div>
        </div>
        <div class="fuel-filter" role="group" aria-label="${escapeHtml(t("fuel.filter"))}">
          ${FUEL_GROUPS.map(
            (group) =>
              `<button type="button" class="${g === group ? "on" : ""}" data-act="fuel-group" data-group="${group}">${escapeHtml(t(`fuel.group.${group}` as MessageKey))}</button>`,
          ).join("")}
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
          <button type="button" class="dest-swap" data-act="swap-dest" aria-label="${escapeHtml(t("dest.swap"))}" title="${escapeHtml(t("dest.swap"))}"${canSwap ? "" : " disabled"}>${SWAP_ICON}</button>
        </div>
      </div>
      <button type="button" class="header-toggle" data-act="toggle-header" aria-expanded="${headerMinimized ? "false" : "true"}" aria-label="${escapeHtml(headerMinimized ? t("header.expand") : t("header.collapse"))}">
        <span class="header-handle" aria-hidden="true"></span>
        <span class="header-min-label" title="${escapeHtml(minLabel)}">${escapeHtml(minLabel)}</span>
        <span class="header-chevron" aria-hidden="true">${headerMinimized ? "▾" : "▴"}</span>
      </button>
    `;
  }

  function settingsHtml(): string {
    const ev = isEv();
    // EV lists charging networks by the name their operator uses; fuel lists the chains.
    const evLabels = ev ? networkLabels(activeStations()) : new Map<string, string>();
    const label = (brand: string) => evLabels.get(brand) ?? brandLabel(brand);
    const excluded = excludedFor(settings);
    const brands = uniqueBrands(activeStations()).sort((a, b) => {
      if (a === "independent") return 1;
      if (b === "independent") return -1;
      return label(a).localeCompare(label(b), locale === "lt" ? "lt" : "en");
    });
    const checks = brands.length
      ? brands
          .map((brand) => {
            const id = `set-brand-${brand}`;
            const on = isBrandIncluded(brand, excluded);
            return `<label class="check"><input id="${escapeHtml(id)}" data-brand="${escapeHtml(brand)}" type="checkbox"${on ? " checked" : ""} />${escapeHtml(label(brand))}</label>`;
          })
          .join("")
      : `<p class="hint">${escapeHtml(t("list.loadingChargers"))}</p>`;
    const source = (href: string, text: string) =>
      `<li><a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a></li>`;
    const sources = ev
      ? [
          source(REGISTER_SOURCE_URL, t("settings.source.register")),
          source(OSM_SOURCE_URL, t("settings.source.osm")),
          source(SPOT_SOURCE_URL, t("settings.source.nordpool")),
        ]
      : [
          source(LEA_SOURCE_URL, t("settings.source.lea")),
          source(CIRCLE_K_SOURCE_URL, brandLabel("circle-k")),
          source(OSM_SOURCE_URL, t("settings.source.osm")),
          source(REPORTS_SOURCE_URL, t("settings.source.reports")),
        ];
    return `<section class="panel" aria-label="${escapeHtml(t("settings.title"))}">
      <header><h2>${escapeHtml(t("settings.title"))}</h2><button type="button" data-act="close-panel">${escapeHtml(t("action.close"))}</button></header>
      ${
        isEv()
          ? `<label>${escapeHtml(t("settings.evConsumption"))}<input id="set-ev-cons" type="number" min="8" max="40" step="0.5" value="${escapeHtml(String(settings.evConsumption))}" /></label>`
          : `<label>${escapeHtml(t("settings.consumption"))}<input id="set-cons" type="number" min="3" max="20" step="0.1" value="${escapeHtml(String(settings.consumption))}" /></label>`
      }
      <label>${escapeHtml(t("settings.timeValue"))}<input id="set-time" type="number" min="0" max="50" step="1" value="${escapeHtml(String(settings.timeValue))}" /></label>
      <div class="setting-block">
        <label>${escapeHtml(t("settings.maxDetour"))}<input id="set-detour" type="number" min="${MAX_DETOUR_KM_RANGE.min}" max="${MAX_DETOUR_KM_RANGE.max}" step="0.1" value="${escapeHtml(String(settings.maxDetourKm))}" /></label>
        <p class="hint">${escapeHtml(t("settings.maxDetourHint"))}</p>
      </div>
      <div class="setting-block">
        <label class="check"><input id="set-high-accuracy" type="checkbox"${settings.highAccuracyLocation ? " checked" : ""} />${escapeHtml(t("settings.highAccuracy"))}</label>
        <p class="hint">${escapeHtml(t("settings.highAccuracyHint"))}</p>
      </div>
      <fieldset class="brand-filter">
        <legend>${escapeHtml(t(ev ? "settings.networks" : "settings.providers"))}</legend>
        ${checks}
      </fieldset>
      <fieldset class="data-sources">
        <legend>${escapeHtml(t("settings.sources"))}</legend>
        <ul>
          ${sources.join("\n          ")}
        </ul>
      </fieldset>
    </section>`;
  }

  function renderPanels(): void {
    const html =
      openPanel === "settings" ? settingsHtml() : openPanel === "report" ? reportHtml() : "";
    if (html === panelsHtml) return;
    panelsHtml = html;
    const panels = root.querySelector<HTMLElement>("#panels")!;
    panels.innerHTML = html;
    // The draft is set here, not in the markup, so typing does not change what render() compares.
    const text = panels.querySelector<HTMLTextAreaElement>("#report-text");
    if (text) text.value = reportDraft;
  }

  function reportHtml(): string {
    const title = escapeHtml(t("report.title"));
    const head = `<header><h2>${title}</h2><button type="button" data-act="close-panel">${escapeHtml(t("action.close"))}</button></header>`;
    if (reportStatus === "sent") {
      const issue = reportIssue;
      const done =
        issue?.url && issue.number
          ? `<p class="report-done" role="status">${escapeHtml(t("report.sent", { n: issue.number }))}</p>
      <p class="hint">${escapeHtml(t("report.follow"))}</p>
      <a class="report-issue-link" href="${escapeHtml(issue.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t("report.openIssue", { n: issue.number }))} ↗</a>`
          : `<p class="report-done" role="status">${escapeHtml(t("report.thanks"))}</p>`;
      const lost =
        issue?.imageSaved === false
          ? `<p class="report-msg">${escapeHtml(t("report.imageLost"))}</p>`
          : "";
      return `<section class="panel report-panel" aria-label="${title}">
      ${head}
      ${done}
      ${lost}
    </section>`;
    }
    const sending = reportStatus === "sending";
    const reading = reportImageState === "reading";
    const category = reportCategory;
    const message =
      reportStatus === "short"
        ? escapeHtml(t("report.short", { n: MIN_REPORT_CHARS }))
        : reportStatus === "rate"
          ? escapeHtml(t("report.rate"))
          : reportStatus === "failed"
            ? `${escapeHtml(t("report.failed"))} <button type="button" class="link-btn" data-act="report-github">${escapeHtml(t("report.viaGithub"))}</button>`
            : "";
    const submit = sending
      ? t("report.sending")
      : REPORT_URL
        ? t("report.send")
        : t("report.viaGithub");
    const kinds = REPORT_CATEGORIES.map(
      (c) =>
        `<label><input type="radio" id="report-kind-${c}" name="report-kind" value="${c}"${category === c ? " checked" : ""}${sending ? " disabled" : ""} />${escapeHtml(t(`report.kind.${c}` as MessageKey))}</label>`,
    ).join("");
    const fields = category
      ? `<label>${escapeHtml(t(`report.label.${category}` as MessageKey))}<textarea id="report-text" rows="5" maxlength="${MAX_REPORT_CHARS}" placeholder="${escapeHtml(t(`report.placeholder.${category}` as MessageKey))}"${sending ? " disabled" : ""}></textarea></label>
        ${REPORT_URL ? reportImageHtml(sending) : ""}
        <div class="report-hp" aria-hidden="true"><label>Website<input id="report-website" name="website" type="text" tabindex="-1" autocomplete="off" /></label></div>
        <p class="hint">${escapeHtml(t("report.public"))}</p>
        ${message ? `<p class="report-msg" role="alert">${message}</p>` : ""}
        <button type="submit" class="primary"${sending || reading ? " disabled" : ""}>${escapeHtml(submit)}</button>`
      : "";
    return `<section class="panel report-panel" aria-label="${title}">
      ${head}
      <form id="report-form" class="report-form" novalidate>
        <fieldset class="report-kind">
          <legend>${escapeHtml(t("report.kind"))}</legend>
          <div class="report-kind-options">${kinds}</div>
        </fieldset>
        ${fields}
      </form>
    </section>`;
  }

  /** Picture picker, or the chosen picture's preview. Only with the worker: GitHub links take none. */
  function reportImageHtml(sending: boolean): string {
    if (reportImage) {
      return `<div class="report-image">
          <img src="${escapeHtml(reportImage.url)}" alt="${escapeHtml(t("report.imageAlt"))}" />
          <button type="button" data-act="report-image-remove"${sending ? " disabled" : ""}>${escapeHtml(t("report.imageRemove"))}</button>
        </div>`;
    }
    const reading = reportImageState === "reading";
    const label = t(reading ? "report.imageReading" : "report.imageAdd");
    return `<div class="report-image">
          <button type="button" class="report-attach" data-act="report-image-pick" title="${escapeHtml(t("report.imageAddTitle"))}"${reading || sending ? " disabled" : ""}>${IMAGE_ICON}${escapeHtml(label)}</button>
          <input type="file" id="report-image" accept="image/*" hidden />
        </div>
        ${reportImageState === "failed" ? `<p class="report-msg" role="alert">${escapeHtml(t("report.imageFailed"))}</p>` : ""}`;
  }

  async function attachReportImage(file: File | undefined): Promise<void> {
    if (!file) return;
    reportImageState = "reading";
    renderPanels();
    try {
      const blob = await shrinkImage(file);
      clearReportImage();
      reportImage = { blob, url: URL.createObjectURL(blob) };
      reportImageState = "idle";
    } catch {
      reportImageState = "failed";
    }
    renderPanels();
  }

  function clearReportImage(): void {
    if (reportImage) URL.revokeObjectURL(reportImage.url);
    reportImage = null;
    reportImageState = "idle";
  }

  function reportContext(): ReportContext {
    return {
      page: window.location.href,
      locale,
      fuel: settings.fuel,
      dataDate: lastUpdatedAt(data) ?? data.meta?.date ?? "",
      userAgent: navigator.userAgent,
      viewport: `${window.innerWidth}×${window.innerHeight}`,
    };
  }

  async function submitReport(): Promise<void> {
    const category = reportCategory;
    if (reportStatus === "sending" || reportImageState === "reading" || !category) return;
    const text = reportDraft.trim();
    if (text.length < MIN_REPORT_CHARS) {
      reportStatus = "short";
      renderPanels();
      root.querySelector<HTMLTextAreaElement>("#report-text")?.focus();
      return;
    }
    if (!REPORT_URL) {
      window.open(
        githubIssueLink({ category, description: text }, reportContext()),
        "_blank",
        "noopener",
      );
      return;
    }
    const website = root.querySelector<HTMLInputElement>("#report-website")?.value ?? "";
    reportStatus = "sending";
    renderPanels();
    let image: string | undefined;
    try {
      image = reportImage ? await blobToDataUrl(reportImage.blob) : undefined;
    } catch {
      reportStatus = "failed";
      renderPanels();
      return;
    }
    const result = await sendReport(
      REPORT_URL,
      { category, description: text, website, image },
      reportContext(),
    );
    if (result.ok) {
      reportStatus = "sent";
      reportIssue = { number: result.number, url: result.url, imageSaved: result.imageSaved };
      reportDraft = "";
      reportCategory = null;
      clearReportImage();
    } else {
      reportStatus = result.reason;
    }
    renderPanels();
    // The form is gone after a send: move focus to the issue link rather than losing it.
    if (result.ok) root.querySelector<HTMLElement>(".report-issue-link")?.focus();
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
    const offer = currentInstallOffer();
    if (offer === "prompt") {
      return `<div class="banner info install-banner">
        <p>${escapeHtml(t("install.hint"))}</p>
        <button type="button" class="install-go" data-act="install">${escapeHtml(t("install.action"))}</button>
        <button type="button" class="install-dismiss" data-act="install-dismiss" aria-label="${escapeHtml(t("action.close"))}">×</button>
      </div>`;
    }
    if (offer === "ios") {
      return `<div class="banner info install-banner">
        <p>${escapeHtml(t("install.ios"))}</p>
        <button type="button" class="install-dismiss" data-act="install-dismiss" aria-label="${escapeHtml(t("action.close"))}">×</button>
      </div>`;
    }
    return "";
  }

  function currentInstallOffer(): ReturnType<typeof installOffer> {
    return installOffer({
      standalone,
      dismissed: installDismissed,
      canPrompt: Boolean(installPrompt),
      iosSafari: isIosSafari(navigator.userAgent, navigator),
    });
  }

  async function promptInstall(): Promise<void> {
    const prompt = installPrompt;
    if (!prompt) return;
    try {
      await prompt.prompt();
    } catch {
      /* user closed the browser sheet */
    }
    installPrompt = null;
    render();
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
    document.title = `${t("app.name")} – ${t(view === "history" ? "history.title" : "app.tagline")}`;
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.setAttribute("content", t("app.name"));
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
      <div id="history"></div>
      <aside id="list" class="list"></aside>
    </div>`;
  }

  function num(v: string, fb: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  }
}
