import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DailyPrices, DataMeta, Observation, Station } from "../src/types.ts";
import { HISTORY_KEEP_DAYS } from "../src/types.ts";
import { cheapestHoursByFuel } from "../src/cheap-hours.ts";
import {
  chargerPrices,
  countBySource,
  EV_SOURCE_ORDER,
  loadEvTariffs,
  mergeChargerPrices,
} from "./adapters/ev-tariffs.ts";
import {
  fetchSpot,
  loadSpotCache,
  mergeSpot,
  spotSeries,
  type SpotPoint,
} from "./adapters/nordpool.ts";
import { loadPriceReports, reportsToObservations } from "./adapters/reports.ts";
import { fetchRegister, loadRegisterCache, usableCache } from "./adapters/via-lietuva.ts";
import { mergeChargers } from "./chargers.ts";
import { geocodePhoton, loadGeocodeCache, saveGeocodeCache, sleep } from "./geocode.ts";
import { datesWithinDays, isHistoryFile, prunePriceFiles, recomputeHistory } from "./history.ts";
import { loadOverrides, matchByAddress, matchObservations } from "./match.ts";
import { combinePriceObservations, summarizeSources } from "./merge-sources.ts";
import { chooseOsmStations, fetchOsmChargers, fetchOsmStations, MIN_OSM_CHARGERS } from "./osm.ts";
import {
  loadHealth,
  rankSources,
  recordRuns,
  saveHealth,
  SOURCE_META,
  type RankedSource,
  type SourceRun,
} from "./source-health.ts";
import { runProviders, type SourceContext } from "./sources.ts";
import {
  applyStale,
  latestObservedAt,
  observationsToDaily,
  reuseGeneratedAtIfUnchanged,
  type SelectionPolicy,
} from "./validate.ts";

const ROOT = join(import.meta.dirname, "..");
const DATA = join(ROOT, "data");
const PRICES = join(DATA, "prices");
const REPORTS = join(ROOT, "reports");

function todayVilnius(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Vilnius",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const space = /\/prices\/\d{4}-\d{2}-\d{2}\.json$/.test(path) ? 0 : 2;
  writeFileSync(path, `${JSON.stringify(value, null, space)}\n`);
}

function latestPriceDate(): string | null {
  if (!existsSync(PRICES)) return null;
  const dates = readdirSync(PRICES)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, 10))
    .sort();
  return dates.at(-1) ?? null;
}

async function enrichCoords(observations: Observation[]): Promise<Observation[]> {
  const cachePath = join(DATA, "cache", "geocode.json");
  const cache = await loadGeocodeCache(cachePath);
  const bySource = new Map<string, Observation[]>();
  for (const o of observations) {
    const list = bySource.get(o.sourceStationId) ?? [];
    list.push(o);
    bySource.set(o.sourceStationId, list);
  }

  let lookups = 0;
  const MAX_LOOKUPS = 400;
  const out: Observation[] = [];
  for (const [, group] of bySource) {
    const sample = group[0];
    if (sample.lat != null && sample.lon != null) {
      out.push(...group);
      continue;
    }
    const q = [sample.address, sample.city, "Lietuva"].filter(Boolean).join(", ");
    let hit = cache.get(q);
    if (hit === undefined) {
      if (lookups >= MAX_LOOKUPS) {
        out.push(...group);
        continue;
      }
      try {
        hit = q.length > 8 ? await geocodePhoton(q, "lt") : null;
      } catch (e) {
        console.warn(`Geocode failed for "${q}":`, e);
        hit = null;
      }
      cache.set(q, hit);
      lookups++;
      if (lookups % 10 === 0) saveGeocodeCache(cachePath, cache);
      await sleep(150);
    }
    if (hit) {
      for (const o of group) out.push({ ...o, lat: hit.lat, lon: hit.lon });
    } else {
      out.push(...group);
    }
  }
  saveGeocodeCache(cachePath, cache);
  console.log(`Geocoded ${lookups} new addresses (${cache.size} cached)`);
  return out;
}

async function loadOsm(force: boolean): Promise<Station[]> {
  const path = join(DATA, "stations.json");
  const existing = readJson<Station[]>(path, []).filter((s) => s.id.startsWith("osm:"));
  const weekday = new Date().getUTCDay();
  const shouldRefresh = force || existing.length === 0 || weekday === 0;
  if (!shouldRefresh) {
    console.log(`Reusing ${existing.length} OSM stations`);
    return existing;
  }
  console.log("Fetching OSM fuel stations…");
  try {
    const stations = chooseOsmStations(existing, await fetchOsmStations());
    console.log(`OSM stations: ${stations.length}`);
    return stations;
  } catch (e) {
    const fallback = chooseOsmStations(existing, undefined, e);
    console.warn(`OSM fetch failed; reusing ${fallback.length} cached stations:`, e);
    return fallback;
  }
}

/** OSM EV chargers refresh on the same weekly cadence; a failed fetch never fails the build. */
async function loadOsmChargers(force: boolean): Promise<Station[]> {
  const path = join(DATA, "cache", "osm-chargers.json");
  // Before this cache existed, the OSM chargers lived only in chargers.json (`ev:` ids).
  const existing = existsSync(path)
    ? readJson<Station[]>(path, [])
    : readJson<Station[]>(join(DATA, "chargers.json"), []).filter((c) => c.id.startsWith("ev:"));
  const weekday = new Date().getUTCDay();
  if (!force && existing.length > 0 && weekday !== 0) {
    console.log(`Reusing ${existing.length} OSM chargers`);
    if (!existsSync(path)) writeJson(path, existing);
    return existing;
  }
  console.log("Fetching OSM EV chargers…");
  try {
    const chargers = chooseOsmStations(
      existing,
      await fetchOsmChargers(),
      undefined,
      MIN_OSM_CHARGERS,
    );
    console.log(`OSM chargers: ${chargers.length}`);
    writeJson(path, chargers);
    return chargers;
  } catch (e) {
    console.warn(`OSM charger fetch failed; reusing ${existing.length} cached chargers:`, e);
    if (!existsSync(path) && existing.length) writeJson(path, existing);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::OSM chargers failed: ${String(e)}`);
    return existing;
  }
}

/** Via Lietuva register chargers with prices; a failed download falls back to a recent cache. */
async function loadRegister(now: Date): Promise<Station[]> {
  const path = join(DATA, "cache", "via-lietuva.json");
  try {
    const { reportUrl, chargers } = await fetchRegister();
    writeJson(path, { fetchedAt: now.toISOString(), reportUrl, chargers });
    console.log(`Via Lietuva register: ${chargers.length} sites from ${reportUrl}`);
    return chargers;
  } catch (e) {
    const cache = usableCache(loadRegisterCache(path), now);
    console.warn(
      `Via Lietuva register failed; ${cache ? `using cache from ${cache.fetchedAt}` : "no recent cache"}:`,
      e,
    );
    if (process.env.GITHUB_ACTIONS)
      console.log(`::warning::Via Lietuva register failed: ${String(e)}`);
    return cache?.chargers ?? [];
  }
}

/** Nord Pool LT spot price, merged into a cache so one failed fetch keeps the chart. */
async function loadSpot(now: Date): Promise<{ points: SpotPoint[]; fetchedAt?: string }> {
  const path = join(DATA, "cache", "spot.json");
  const cache = loadSpotCache(path);
  try {
    const fresh = await fetchSpot(now);
    const points = mergeSpot(cache?.points ?? [], fresh, now);
    const fetchedAt = now.toISOString();
    writeJson(path, { fetchedAt, points });
    console.log(`Spot price: ${fresh.length} hours fetched, ${points.length} kept`);
    return { points, fetchedAt };
  } catch (e) {
    console.warn("Spot price fetch failed; keeping cached hours:", e);
    if (process.env.GITHUB_ACTIONS) console.log(`::warning::Spot price failed: ${String(e)}`);
    return { points: mergeSpot(cache?.points ?? [], [], now), fetchedAt: cache?.fetchedAt };
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const osmOnly = args.has("--osm-only");
  const dateArg = process.argv.find((_, i) => process.argv[i - 1] === "--date");

  mkdirSync(PRICES, { recursive: true });
  mkdirSync(join(DATA, "overrides"), { recursive: true });
  mkdirSync(REPORTS, { recursive: true });
  if (!existsSync(join(DATA, "overrides", "stations.json"))) {
    writeJson(join(DATA, "overrides", "stations.json"), []);
  }
  if (!existsSync(join(DATA, "overrides", "prices.json"))) {
    writeJson(join(DATA, "overrides", "prices.json"), []);
  }
  if (!existsSync(join(DATA, "overrides", "ev-tariffs.json"))) {
    writeJson(join(DATA, "overrides", "ev-tariffs.json"), []);
  }

  let stations = await loadOsm(args.has("--osm"));
  const osmChargers = await loadOsmChargers(args.has("--osm"));
  if (osmOnly) {
    writeJson(join(DATA, "stations.json"), stations);
    return;
  }
  const runAt = new Date();
  const register = await loadRegister(runAt);
  const { chargers, osmOnly: osmOnlyChargers } = mergeChargers(register, osmChargers);
  const spot = await loadSpot(runAt);

  const overrides = loadOverrides(join(DATA, "overrides", "stations.json"));
  const requested = dateArg ?? todayVilnius();
  const ctx: SourceContext = { requested, leaByDate: new Map(), leaDate: null };
  console.log(`Fetching sources: ${SOURCE_META.map((m) => m.name).join(", ")}…`);
  const { byProvider, runs } = await runProviders(ctx);
  for (const run of runs) logRun(run);
  if (ctx.leaByDate.size) console.log(`  ${ctx.leaByDate.size} days in LEA workbook`);

  const healthPath = join(DATA, "cache", "source-health.json");
  const health = recordRuns(loadHealth(healthPath), runs);
  saveHealth(healthPath, health);
  const ranking = rankSources(health);
  const policy: SelectionPolicy = {
    order: ranking.map((r) => r.name),
    maxAgeHours: Object.fromEntries(SOURCE_META.map((m) => [m.name, m.maxAgeHours])),
    now: new Date(),
  };

  const reports = reportsToObservations(
    loadPriceReports(join(DATA, "overrides", "prices.json")),
    stations,
  );
  const combined = combinePriceObservations({
    byProvider,
    reports,
    requested,
    excelDate: ctx.leaDate,
  });
  const { date, observations: combinedRows } = combined;
  let observations = combinedRows;

  if (observations.length === 0) {
    console.warn("No live observations; keeping previous snapshot if any.");
  } else {
    console.log(`Using ${observations.length} observations for ${date}`);
    // Address-match first so we can skip geocoding for known OSM stations.
    const pre: Observation[] = [];
    const needGeo: Observation[] = [];
    const grouped = new Map<string, Observation[]>();
    for (const o of observations) {
      const g = grouped.get(o.sourceStationId) ?? [];
      g.push(o);
      grouped.set(o.sourceStationId, g);
    }
    for (const group of grouped.values()) {
      const sample = group.find((o) => o.lat != null && o.lon != null) ?? group[0];
      if (sample.lat != null && sample.lon != null) {
        for (const o of group) pre.push({ ...o, lat: sample.lat, lon: sample.lon });
        continue;
      }
      const hit = matchByAddress(stations, sample);
      if (hit) {
        for (const o of group) pre.push({ ...o, lat: hit.lat, lon: hit.lon });
      } else needGeo.push(...group);
    }
    const geocoded = await enrichCoords(needGeo);
    observations = [...pre, ...geocoded];
  }

  const matched = matchObservations(stations, observations, overrides);
  stations = [...stations, ...matched.extraStations];
  writeJson(join(REPORTS, "unmatched.json"), matched.unmatched);

  const prevDate = latestPriceDate();
  const previous = prevDate
    ? readJson<DailyPrices | null>(join(PRICES, `${prevDate}.json`), null)
    : null;
  const { daily: fresh, log } = observationsToDaily(date, matched.observations, previous, policy);
  const tariffs = loadEvTariffs(join(DATA, "overrides", "ev-tariffs.json"));
  const evPrices = chargerPrices(chargers, tariffs, runAt, previous);
  mergeChargerPrices(fresh, evPrices);
  const bySource = countBySource(evPrices);
  console.log(
    `EV: ${chargers.length} chargers (${register.length} register, ${osmOnlyChargers} OSM only); ` +
      `${Object.keys(evPrices).length} priced: ` +
      EV_SOURCE_ORDER.map((src) => `${src} ${bySource[src] ?? 0}`).join(", ") +
      ` (${tariffs.length} network tariffs)`,
  );
  applyStale(fresh, previous, prevDate);
  const daily = reuseGeneratedAtIfUnchanged(previous, fresh);
  writeJson(join(PRICES, `${date}.json`), daily);
  writeJson(join(REPORTS, "validation.json"), log);

  const removed = prunePriceFiles(PRICES, date);
  if (removed.length)
    console.log(`Pruned ${removed.length} price files older than ${HISTORY_KEEP_DAYS} days`);

  const storedHistory = readJson<unknown>(join(DATA, "history.json"), null);
  const previousHistory = isHistoryFile(storedHistory) ? storedHistory : null;
  const spotChart = spotSeries(spot.points);
  // Chargers too: EV history is per charging network.
  let history = recomputeHistory(
    PRICES,
    [...stations, ...chargers],
    previousHistory,
    runAt,
    spotChart,
  );
  writeJson(join(DATA, "history.json"), history);
  writeJson(join(DATA, "stations.json"), stations);
  writeJson(join(DATA, "chargers.json"), chargers);

  const priced = Object.keys(daily.prices).length;
  const checkedAt = new Date().toISOString();
  const usage = summarizeSources(daily, policy.order);
  const sourceRanking = ranking.map((r) => {
    const run = runs.find((x) => x.name === r.name);
    return {
      name: r.name,
      score: Math.round(r.score * 1000) / 1000,
      ok: run?.ok ?? false,
      rows: run?.rows ?? 0,
      chosen: usage.find((u) => u.name === r.name)?.chosen ?? 0,
    };
  });
  logRanking(ranking, sourceRanking, runs);
  const meta: DataMeta = {
    date,
    generatedAt: daily.generatedAt,
    checkedAt,
    observedAt: latestObservedAt(daily),
    stationCount: stations.length,
    pricedStationCount: priced,
    sources: usage.map((u) => u.name),
    sourceRanking,
    cheapestHours: cheapestHoursByFuel(history, [], checkedAt),
    chargerCount: chargers.length,
    ...(spot.fetchedAt ? { spotUpdatedAt: spot.fetchedAt } : {}),
  };
  writeJson(join(DATA, "meta.json"), meta);
  console.log(
    `Wrote ${stations.length} stations, ${priced} with prices for ${date}. Checked ${checkedAt}; prices generated ${daily.generatedAt}${meta.observedAt ? `; observed ${meta.observedAt}` : ""}. Unmatched groups: ${matched.unmatched.length}`,
  );

  const byDate = ctx.leaByDate;
  const otherDates = [...byDate.keys()].filter((d) => d !== date);
  const backfill = args.has("--backfill");
  if (backfill && otherDates.length && Object.keys(matched.sourceToStation).length) {
    const recent = datesWithinDays(otherDates, date);
    let prev: DailyPrices | null = null;
    for (const d of recent) {
      const rows = (byDate.get(d) ?? [])
        .map((o) => {
          const sid = matched.sourceToStation[o.sourceStationId];
          return sid ? { ...o, sourceStationId: sid } : null;
        })
        .filter((o): o is Observation => o !== null);
      const snap = observationsToDaily(d, rows, prev);
      writeJson(join(PRICES, `${d}.json`), snap.daily);
      prev = snap.daily;
      console.log(`Backfilled ${d}: ${Object.keys(snap.daily.prices).length} stations`);
    }
    prunePriceFiles(PRICES, date);
    history = recomputeHistory(
      PRICES,
      [...stations, ...chargers],
      previousHistory,
      runAt,
      spotChart,
    );
    writeJson(join(DATA, "history.json"), history);
    meta.cheapestHours = cheapestHoursByFuel(history, [], checkedAt);
    writeJson(join(DATA, "meta.json"), meta);
  }
}

function logRun(run: SourceRun & { name: string }): void {
  if (run.ok) {
    const newest = run.newestObservedAt ? `, newest ${run.newestObservedAt}` : "";
    console.log(`  ${run.name}: ${run.rows} rows in ${run.ms} ms${newest}`);
    return;
  }
  console.error(`  ${run.name} failed after ${run.ms} ms: ${run.error}`);
  // Surfaces in the Actions run summary without failing the build.
  if (process.env.GITHUB_ACTIONS) console.log(`::warning::Source ${run.name} failed: ${run.error}`);
}

function logRanking(
  ranking: RankedSource[],
  summary: NonNullable<DataMeta["sourceRanking"]>,
  runs: Array<SourceRun & { name: string }>,
): void {
  console.log("Source ranking (7-day hourly reliability):");
  ranking.forEach((r, i) => {
    const s = summary.find((x) => x.name === r.name);
    const run = runs.find((x) => x.name === r.name);
    console.log(
      `  ${i + 1}. ${r.name.padEnd(9)} score ${r.score.toFixed(3)} over ${r.runs} runs · this run ${run?.ok ? "ok" : "failed"}, ${s?.rows ?? 0} rows · chosen ${s?.chosen ?? 0} prices`,
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
