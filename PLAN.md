# Kur degalai – development plan

A free static website (PWA) rebuilt daily with current fuel prices at every fuel station
in Lithuania. Users can:

1. see fuel stations on a map with prices;
2. enter a route and see where fuel is cheapest along the way and whether a detour is worth it;
3. tap "Around me" to get the cheapest stations nearby, accounting for the cost of driving there;
4. view a historical chart of the cheapest daily prices.

Nothing outside Lithuania is covered.

---

## 1. Architecture

```
┌──────────────────────────────┐   daily (cron, GitHub Actions)
│  Data pipeline (Node)        │
│  OSM stations + price        │──► data/stations.json
│  adapters → normalisation    │──► data/prices/YYYY-MM-DD.json
│  → validation → history      │──► data/history.json
└──────────────┬───────────────┘
               │ commit + build
               ▼
┌──────────────────────────────┐
│  Static site (Vite + TS)     │  MapLibre GL, PWA, no backend
│  – map                       │
│  – "Around me"               │  ← geolocation, haversine × road factor
│  – route                     │  ← geocoding + routing API
│  – history chart             │
└──────────────────────────────┘
        hosted on GitHub Pages / Cloudflare Pages (free)
```

Core principle: **git is the database**. One JSON file per day, plus an aggregated
history file. There is no backend; the only external requests from the browser are
map tiles, geocoding and routing.

### Technology choices

| Area | Choice | Why |
|---|---|---|
| Static build | Vite + TypeScript (no framework, or Preact) | small bundles, simple |
| Map | MapLibre GL JS + OpenFreeMap / Protomaps PMTiles | free, vector tiles, no API key |
| Station list | OpenStreetMap (Overpass API, `amenity=fuel`, LT boundary) | open data, coordinates, brands |
| Geocoding | Photon (komoot) or Nominatim (filtered to LT) | free, rate limits are acceptable |
| Routing | OSRM (see section 5 – options) | fast, open |
| Chart | uPlot (or Chart.js) | tiny, fast on long time ranges |
| PWA | vite-plugin-pwa (manifest + service worker) | "works like an app", offline last-known data |
| CI | GitHub Actions cron (06:00 and 14:45 LT) | free, commits data and deploys |
| Tests | Vitest (pipeline, calculations), Playwright (critical UI flows) | |

---

## 2. Data model

```ts
// data/stations.json – changes rarely, generated from OSM + manual overrides
interface Station {
  id: string;            // stable: "osm:node:123456"
  name: string;
  brand: string;         // normalised: "circle-k", "viada", "orlen", "neste", ...
  lat: number; lon: number;
  address?: string;
  city?: string;
  fuels: FuelType[];     // which fuels are offered
  sourceIds: Record<string, string>; // mapping to price-source IDs
}

type FuelType = "95" | "98" | "D" | "LPG"; // later: "HVO", "D+", "95+"

// data/prices/YYYY-MM-DD.json – daily snapshot
interface DailyPrices {
  date: string;                           // "2026-09-12"
  generatedAt: string;                    // ISO
  prices: Record<string /*stationId*/, Partial<Record<FuelType, PriceEntry>>>;
}
interface PriceEntry {
  price: number;        // EUR/l, 3 decimals
  source: string;       // adapter name
  observedAt: string;   // when the source observed the price
}

// data/history.json – aggregated, used by the chart
interface HistoryPoint {
  date: string;
  byFuel: Record<FuelType, {
    min: number; median: number; max: number;
    minStationId: string;
    byBrand: Record<string, { min: number; median: number }>;
  }>;
}
```

The site loads `stations.json` (~1,000 stations, ~150 KB gzip) + the latest
`prices/*.json` + `history.json`. All filtering and calculations run client-side.

---

## 3. Data pipeline (`scripts/`)

### 3.1 Station list
- Overpass query: `amenity=fuel` within the Lithuanian administrative boundary (relation 72596).
- Brand normalisation from `brand`, `operator`, `name` (dictionary in `brands.ts`).
- Manual overrides file `data/overrides/stations.json` (wrong coordinates, missing stations).
- Refreshed weekly (not daily) – OSM changes slowly.

### 3.2 Price adapters
Common interface:

```ts
interface PriceSource {
  name: string;
  fetch(): Promise<Observation[]>; // { sourceStationId, brand, lat?, lon?, address?, fuel, price, observedAt }
}
```

Candidates (one adapter per source, individually enabled/disabled):

| Source | Type | Notes |
|---|---|---|
| Chain websites (Circle K, Viada, Orlen, Neste, Baltic Petroleum, Alauša, Emsi, Jozita, etc.) | official per-station prices | most accurate; review each site's terms of use and `robots.txt` |
| Price aggregators (e.g. degalu-kainos.lt style) | user/chain reports | wider coverage, but needs permission and quality control |
| EU Weekly Oil Bulletin | national average | context / validation only, not per station |

Important: check the legal side (ToS, attribution) before enabling a source. Phase one starts
with the 2–3 largest chains that publish per-station prices publicly.

### 3.3 Matching
- Source station → OSM station: same brand + distance < 300 m; if no coordinates, geocode the
  address (cached in `data/cache/geocode.json`).
- Unmatched stations go to `reports/unmatched.json` – reviewed manually, `overrides` extended.

### 3.4 Validation
- Price ranges per fuel type (e.g. 95: 0.90–2.50 €/l); out-of-range values are dropped and logged.
- Jump check: >15 % change in one day at the same station is flagged `suspicious`.
- Freshness: if a source has produced no data for >48 h, the last known price is used with a
  `stale` flag; after 7 days it is hidden.
- If an adapter returns 0 records or crashes, the build does not fail, but CI opens a GitHub
  Issue / sends a notification (workflow `failure()` step).

### 3.5 History
- After each daily snapshot, `history.json` is recomputed (min/median/max per fuel type, per
  brand, cheapest station).
- Old daily files stay in the repo (≈ 100–200 KB/day; ~50 MB after a year – acceptable;
  archive into yearly files if it grows too much).

### 3.6 CI (`.github/workflows/daily.yml`)
1. `cron: "0 3 * * *"` (06:00 LT) and `cron: "45 11 * * *"` (14:45 LT) + manual `workflow_dispatch`.
2. `npm run pipeline` → generates `data/`.
3. `git commit -m "data: YYYY-MM-DD"` (only if something changed).
4. `npm run build` → deploy to Pages.
5. Notification on failure.

---

## 4. User interface

### 4.1 Map (main view)
- Lithuanian bounds, initial zoom shows the whole country; map `maxBounds` = LT.
- Stations as a MapLibre layer (GeoJSON) with clustering at low zoom levels.
- Marker colour by price percentile (cheap → expensive) for the selected fuel type.
- Top bar: **fuel filter**, search box, "Around me" and "Route" buttons.
  - Fuel filter is a segmented control with three groups: **Diesel** / **Petrol** / **Gas (LPG)**.
    Petrol expands to grade (95 default, 98); Diesel can later expand to D / D+ / HVO.
  - The filter is global: it drives marker colours, the station list, "Around me", route
    highlighting and the history chart. Stations that do not sell the selected fuel are hidden
    (or dimmed – toggle in settings).
  - Stored in localStorage; also reflected in the URL (`?fuel=diesel`) so a filtered view can be shared.
- Tapping a station opens a popup: name, brand, all prices, last update, "Navigate" (link to
  external navigation), price mini-chart (from daily files – optional).
- Bottom (mobile: bottom sheet): list of visible stations sorted by price.

### 4.2 User settings (localStorage)
- Fuel filter (Diesel / Petrol 95 or 98 / Gas).
- Route preference (Shortest / Fastest), default Shortest.
- Vehicle consumption (l/100 km), default 7.0.
- Litres planned to fill, default 40.
- Value of time €/h (default 0 – only fuel costs are counted; can be enabled, e.g. 10 €/h).
- Road factor (haversine → road distance), default 1.3 – used when no routing API is available.

### 4.3 "Around me"
1. `navigator.geolocation` (or a manual point on the map if denied).
2. Stations within R = 15 km are selected (switchable: 5 / 15 / 30 km).
3. **Net benefit** is calculated for each (see section 6); baseline price = the price at the
   nearest station offering the selected fuel.
4. List sorted by net benefit; shows price, distance, "you save ~X €" or "not worth it (−Y €)".

### 4.4 Route
1. Opening route mode requests geolocation and pre-fills **Start = current location**
   (shown as "My location" with a pin on the map); the user only types the destination.
   - The start field remains editable: clearing it lets the user type an address or pick a
     point on the map instead.
   - If geolocation is denied/unavailable, the start field is left empty with a prompt to
     enter a start address, and the "Use my location" button retries the permission.
   - The resolved position is reused for "Around me" and refreshed on each route search.
2. Destination – geocoding filtered to LT, with autocomplete (start uses the same geocoder
   when entered manually).
3. **Shortest path** to the destination: the routing API is asked for the shortest-distance
   route (ORS `preference=shortest`; OSRM would need a `shortest` profile – otherwise its
   fastest route is used and labelled as such). A "Shortest / Fastest" toggle is available,
   default **Shortest**. The response gives geometry, distance and duration, drawn as the main
   route line on the map with the map fitted to its bounds.
4. **Highlight fuel stations along the route** for the selected fuel filter (Diesel / Petrol / Gas):
   - stations within 500 m of the route count as "on the way" (detour ≈ 0) and are drawn with a
     prominent marker (larger, price label always visible, coloured by price);
   - stations within N km (default 5 km, adjustable) are detour candidates, drawn smaller with a
     dashed connector to the route;
   - all other stations are dimmed / hidden while route mode is active;
   - stations not selling the selected fuel are excluded entirely.
5. Baseline price = cheapest "on the way" station. For candidates, the detour is computed:
   - precisely: routing API `table`/`route` via the station as a waypoint (extra distance and time);
   - cheaply (fallback): 2 × haversine to the nearest point on the route × road factor, time at 50 km/h.
6. Result: route on the map, a list of highlighted stations ordered by position along the route
   (with km from start), plus recommended detours with "+X km, +Y min, saves Z €".
   Clearly marked "worth it" / "not worth it"; the cheapest on-route station is badged.
7. Changing the fuel filter while a route is shown re-runs steps 4–6 without refetching the route.
8. To limit API usage, detours are computed only for the top 10–15 candidates by price.

### 4.5 History chart
- Separate panel / page `/history`.
- Lines: cheapest price in the country and median for the selected fuel type; ranges
  1 month / 3 months / 1 year / all.
- Additionally: per brand (toggle); tooltip shows which station was cheapest that day.
- Data from `history.json` – a single file, no extra requests.

### 4.6 Multilanguage (LT and EN)
- Two locales from day one: **Lithuanian (`lt`, default)** and **English (`en`)**.
- URL-prefixed routes so both are indexable and shareable: `/` (lt) and `/en/`, `/istorija` ↔
  `/en/history`, `/apie` ↔ `/en/about`. Each page emits `<link rel="alternate" hreflang>` and
  `<html lang>`.
- Locale selection: URL prefix wins; otherwise saved choice (localStorage) → `navigator.language`
  (`lt*` → lt, anything else → en). Language switcher in the header keeps the current view
  (route, fuel filter, map position) when switching.
- Strings live in `src/i18n/lt.json` and `src/i18n/en.json` with a tiny typed `t()` helper
  (no heavy i18n library); ICU-style plurals only where needed ("1 station" / "3 stations").
  A CI check fails if the two files have different keys.
- Locale-aware formatting via `Intl`: prices (`1,749 €/l` vs `€1.749/l`), distances, dates on
  the chart and "last updated" timestamps; the `lt-LT` / `en-GB` locales are used.
- Data stays language-neutral: station names/brands/addresses come from OSM as-is; fuel type
  labels (Dyzelinas/Diesel, Benzinas/Petrol, Dujos/Gas) and brand display names are translated
  in the UI layer.
- Geocoder queries pass `lang=lt|en` so suggestions and result labels follow the UI language.
- PWA manifest has `lang` per locale build (name/description in both languages); SEO meta and
  Open Graph tags are translated per page.
- Playwright smoke tests run the critical flows in both locales.

### 4.7 PWA, performance, quality
- Manifest, icons, "Install" hint; service worker caches the app shell and the latest
  `data/*.json` (offline shows last known prices with their date).
- Target: < 300 KB JS gzip, LCP < 2.5 s on mobile 4G.
- Accessibility: keyboard navigation in the list, contrast, ARIA for map controls.
- SEO: static pages per locale (see 4.6); "about" lists sources, attribution
  (OSM, OpenFreeMap, Photon/OSRM), last update time, disclaimer.

---

## 5. Routing service – options

For a static site this is the only place where a "live" service is needed.

| Option | Pros | Cons |
|---|---|---|
| **A. Public OSRM demo server** | zero work | not for production, unreliable |
| **B. OpenRouteService / other free API with a key** | reliable, `matrix` endpoint | daily limits (~2,000 requests), key is public in the client (restrict by domain) |
| **C. Own OSRM for the LT extract (Docker, free tier – Fly.io / Oracle free)** | full control, LT graph ~200 MB RAM | no longer 100 % static, maintenance |
| **D. In-browser routing (LT road graph → WASM Dijkstra/CH)** | no server, truly free | complex, ~10–20 MB download |

Recommendation: **start with B** with a haversine-heuristic fallback (the site works without
the API); move to C if usage grows. D only if the goal is zero external services.

---

## 6. Cost / benefit calculation

```
savings       = (baseline_price − station_price) × litres
fuel_cost     = extra_km × (consumption_l_100km / 100) × station_price
time_cost     = extra_min / 60 × time_value_eur_h
net_benefit   = savings − fuel_cost − time_cost
```

- "Around me": extra_km = road distance to the station (and back, if the user ticks
  "I return to the same place" – default on).
- Route: extra_km / min = (route via station) − (direct route).
- Show transparently: "0.05 €/l cheaper × 40 l = 2.00 €; detour 3.2 km ≈ 0.35 € fuel,
  +4 min → net benefit +1.65 €".
- Unit tests with fixed examples (`calc.test.ts`).

---

## 7. Phases

### 0. Foundation
- Repo structure (`scripts/`, `src/`, `data/`, `public/`), Vite + TS, ESLint/Prettier, Vitest.
- GitHub Actions: lint + test on PRs; Pages deploy from `main`.
- i18n scaffolding: `lt.json` / `en.json`, `t()` helper, locale routing (`/` and `/en/`),
  language switcher, key-parity CI check – so every later feature is written bilingual.
- Outcome: empty site with a map of Lithuania deployed, switchable between LT and EN.

### 1. Data pipeline MVP
- OSM station import + brand normalisation.
- 2–3 price adapters, matching, validation, `prices/` + `history.json`.
- Daily cron workflow with commit.
- Outcome: repo gains data daily; `reports/unmatched.json` reviewed.

### 2. Map
- Station layer with prices, clustering, fuel type switch, popups, list.
- Outcome: useful site without routing.

### 3. "Around me"
- Geolocation, settings (consumption, litres), net-benefit calculation with haversine.
- Outcome: first "is it worth it" feature.

### 4. Route
- Geocoding, routing API integration (option B) + fallback, corridor, detour evaluation,
  UI with recommendations.

### 5. History
- `history.json` chart, ranges, brand comparison, mini-chart in popups.

### 6. PWA and quality
- Manifest / service worker / offline, performance optimisation, accessibility, SEO
  (hreflang, per-locale meta), "about" page in both languages.
- Playwright tests in both locales: map loads, "around me" with mocked geolocation, route flow.

### 7. Maintenance and monitoring
- Adapter failure notifications, data quality report in the CI summary.
- Adapters for remaining chains, a form for users to report wrong prices (GitHub Issue
  template or a simple form via a free service).

---

## 8. Risks and assumptions

- **Data sources** – the biggest risk. Lithuania has no mandatory official per-station price
  feed (unlike DE/AT), so chain websites / aggregators are the basis. Any source may change
  its structure – adapters are isolated, and a failure does not take the site down.
- **Legal** – check terms of use before enabling a source; always show attribution and the
  price date/time; "prices may differ" disclaimer.
- **Free service limits** (geocoding, routing) – cache on the client, limit request counts
  (debounce, top-N candidates), keep a heuristic fallback.
- **Repo growth** from daily files – monitor; archive into yearly files if needed.
- **Assumptions** (changeable): fuel types 95, 98, D, LPG; prices updated once a day;
  defaults 7 l/100 km, 40 l, time value 0 €/h; UI in Lithuanian (default) and English, with
  Lithuanian at the root URL and English under `/en/`.
