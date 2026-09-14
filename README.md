# Kur degalai

A free static website (PWA) with current fuel prices at every fuel station in Lithuania.
Users can browse stations on a map, check whether a nearby detour is worth it, plan a
route, and view a historical chart of the cheapest daily prices.

Lithuanian is the default locale (`/`). English lives under `/en/`.

See [PLAN.md](./PLAN.md) for the full product plan.

## Develop

```bash
npm install
npm run pipeline          # OSM stations + LEA prices (needs network)
npm run dev
```

```bash
npm run check             # i18n keys, lint, unit tests, types
npm run build
npm run test:e2e
```

## Data

Git is the database. The GitHub Actions workflow (hourly) runs
`npm run pipeline`, commits `data/` if it changed, and deploys the static site.

| Path                           | What                               |
| ------------------------------ | ---------------------------------- |
| `data/stations.json`           | OSM stations + unmatched LEA sites |
| `data/prices/YYYY-MM-DD.json`  | Daily snapshot                     |
| `data/history.json`            | Aggregated min/median/max          |
| `data/overrides/stations.json` | Manual OSM ↔ source matches        |
| `reports/unmatched.json`       | Source rows that still need a home |

Prices come from the Lithuanian Energy Agency (LEA) public dataset. Station
coordinates come from OpenStreetMap. Always attribute both, plus the original
station chains.

Chain-website adapters can be added under `scripts/adapters/` behind the shared
`PriceSource` interface; a failing adapter must not fail the build.

## Routing

Geocoding uses Photon (filtered to Lithuania). Routing uses OpenRouteService when
`VITE_ORS_KEY` is set (shortest preference), otherwise the public OSRM demo
(fastest) with a haversine × road-factor fallback for detours.

## Licence

Apache-2.0. Map and station data remain under their upstream licences (ODbL for OSM).
