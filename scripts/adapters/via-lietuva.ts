import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { normalizeBrand } from "../../src/brands.ts";
import { round3 } from "../../src/calc.ts";
import { haversineKm, inLithuania } from "../../src/geo.ts";
import type { ChargerInfo, Station } from "../../src/types.ts";
import { FETCH_UA } from "./types.ts";

/**
 * Lithuania's register of public charge points (AFIR national access point), run by Via Lietuva.
 * Operators report each charge point and its ad hoc price here. Data: CC BY 4.0 / ODC-BY.
 */
export const VIA_LIETUVA_BASE = "https://ev.vialietuva.lt";
export const VIA_LIETUVA_SOURCE = "via-lietuva";
/** Below this many sites the report is truncated or the columns moved; keep the cache instead. */
export const MIN_REGISTER_SITES = 200;
/** A cached register stays usable this long when fresh downloads fail. */
export const REGISTER_MAX_AGE_HOURS = 7 * 24;
const REQUEST_TIMEOUT_MS = 120_000;

export interface RegisterCache {
  fetchedAt: string;
  reportUrl: string;
  chargers: Station[];
}

/** Columns found by header text, so a reordered report still parses. */
const COLUMNS = {
  station: /stotelės identifikacinis kodas/i,
  vehicle: /skirta lengvajam/i,
  owner: /savininkas/i,
  operator: /operatorius/i,
  location: /stotelės\/prieigos vieta/i,
  x: /X koordinat/i,
  y: /Y koordinat/i,
  connector: /jungčių tipas/i,
  current: /srovės rūšis/i,
  maxPower: /maksimali atiduodamoji galia/i,
  price: /įkrovimo kaina/i,
} as const;
type Column = keyof typeof COLUMNS;
/** "Kitos vietovės savybės" holds `Miesto mazgas - <town>`; only `foldMisplaced` reads it. */
const FEATURES_COLUMN = /kitos vietovės savybės/i;

/** A site farther than this from its stated town's other chargers is outside that town. */
export const TOWN_KM = 15;

/** Newest `/report/<id>` link on the register's home page. */
export function reportUrlFromHome(html: string): string | null {
  const ids = [...html.matchAll(/\/report\/(\d+)/g)].map((m) => Number(m[1]));
  return ids.length ? `${VIA_LIETUVA_BASE}/report/${Math.max(...ids)}` : null;
}

export interface RegisterPrice {
  /** €/kWh; 0 when the register says the charge point is free. */
  kwh?: number;
  /** Flat fee per session in €, e.g. `0.48 €/kWh ir 0.3 €`. */
  sessionFee?: number;
}

/** Parses the register's "average charging price" text. */
export function parseRegisterPrice(text: string): RegisterPrice {
  const s = text.replace(/\s+/g, " ").replace(/,/g, ".").trim();
  if (!s) return {};
  if (/nemokam/i.test(s)) return { kwh: 0 };
  const kwh = s.match(/(\d+(?:\.\d+)?)\s*(?:€|eur)\s*\/\s*kwh/i);
  const fee = s.match(/\bir\s+(\d+(?:\.\d+)?)\s*(?:€|eur)(?!\s*\/)/i);
  return {
    ...(kwh ? { kwh: round3(Number(kwh[1])) } : {}),
    ...(fee ? { sessionFee: round3(Number(fee[1])) } : {}),
  };
}

export function socketKey(label: string): string {
  const s = label.toLowerCase();
  if (/chademo/.test(s)) return "chademo";
  if (/ccs|combo/.test(s)) return "type2_combo";
  if (/type\s*2|tipas\s*2|mennekes/.test(s)) return "type2";
  if (/type\s*1/.test(s)) return "type1";
  if (/schuko/.test(s)) return "schuko";
  return s.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "other";
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object" && "text" in (value as object)) {
    return String((value as { text: unknown }).text ?? "");
  }
  if (typeof value === "object" && "result" in (value as object)) {
    return String((value as { result: unknown }).result ?? "");
  }
  return String(value);
}

function num(text: string): number | undefined {
  const n = Number(text.replace(",", ".").trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Location text without a `|` is often a place and its address joined by a comma, so the address
 * comes twice: `Kauno g. 10, Kauno g. 10` → `Kauno g. 10`, and
 * `Norfa XL Tilžės g. 58, Tilžės g. 58` → `Norfa XL` at `Tilžės g. 58`.
 */
function splitRepeated(text: string): { name: string; address: string } | null {
  const parts = text.split(",").map((p) => p.replace(/\s+/g, " ").trim());
  for (let i = 1; i < parts.length; i++) {
    const head = parts.slice(0, i).join(", ");
    const tail = parts.slice(i).join(", ");
    if (head === tail) return { name: tail, address: tail };
    if (head.endsWith(` ${tail}`)) {
      return { name: head.slice(0, -tail.length).replace(/[\s,]+$/, ""), address: tail };
    }
  }
  return null;
}

/** `IKI Mindaugo | Inbalance grid, Mindaugo str. 25` → name and address. */
function splitLocation(text: string, operator: string): { name?: string; address?: string } {
  const [head, ...rest] = text.split("|").map((p) => p.trim());
  if (!rest.length && head) return splitRepeated(head) ?? { name: head, address: head };
  let address = rest.join(" | ").trim();
  if (operator && address.toLowerCase().startsWith(`${operator.toLowerCase()},`)) {
    address = address.slice(operator.length + 1).trim();
  }
  return { name: head || undefined, address: address || undefined };
}

/** Lower case, no accents, single spaces: `Elektrinės g.  21` and `elektrines g. 21` match. */
function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();
}

/** `UAB "Rar transportas"`, `Lietuvos oro uostai, AB` → `Rar transportas`, `Lietuvos oro uostai`. */
export function companyName(text: string): string {
  return text
    .replace(/[„“”"]/g, "")
    .replace(/(^|[\s,])(UAB|AB|VĮ|VšĮ|MB|IĮ)(?=$|[\s,])/g, "$1")
    .replace(/\s*,\s*$|^\s*,\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Why the register lists a charger as free, from its owner and location. Owners named here were
 * looked up by hand (October 2026); see provider-mistakes.md. Anything else owned by a company
 * other than the operator reads as a workplace charger.
 */
export function freeReason(owner: string, operator: string, location: string): ChargerInfo["free"] {
  const o = fold(owner);
  const company = companyName(owner);
  if (/savivaldyb/.test(o)) return { reason: "municipal" };
  if (/ignitis gamyba/.test(o)) return { reason: "powerPlant", owner: company };
  if (/oro uostai/.test(o)) return { reason: "airport", owner: company };
  if (/transport/.test(o)) return { reason: "fleet", owner: company };
  // Vilniaus apšvietimas street-light chargers cost 0.29 €/kWh everywhere else.
  if (/vilniaus apsvietimas/.test(fold(location))) return { reason: "networkPaid" };
  // Inbalance grid owns and runs the chargers at SEB's head office.
  if (/^seb\b/.test(fold(location))) return { reason: "workplace", owner: "SEB" };
  const key = (s: string) => fold(companyName(s)).replace(/[^a-z0-9]/g, "");
  if (owner && key(owner) !== key(operator)) return { reason: "workplace", owner: company };
  return { reason: "unknown" };
}

interface SiteDraft {
  station: Station;
  stations: Set<string>;
  ac: number[];
  dc: number[];
  fees: number[];
  /** Owner as written in the register. */
  owner: string;
  /** Location text as written in the register. */
  location: string;
  /** Operator, folded. */
  operator: string;
  /** Location text as typed, folded. */
  label: string;
  /** `Miesto mazgas` town, folded; empty when not given. */
  town: string;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Some operators type the right address but drop the pin somewhere else: five Ignitis gamyba
 * points labelled `Elektrinės g. 21, Elektrėnai` sit in Vilnius Old Town, 40 km away, while two
 * more with that label sit at the Elektrėnai plant. When the operator gave the same location text
 * to a site inside the stated town (judged by other operators' chargers there), a namesake site
 * far outside it is folded into that site. Sites with no in-town namesake stay where they are.
 */
function foldMisplaced(drafts: SiteDraft[]): SiteDraft[] {
  const centres = new Map<string, { lat: number; lon: number } | null>();
  const centre = (town: string, operator: string) => {
    const key = `${town}|${operator}`;
    if (!centres.has(key)) {
      const others = drafts.filter((d) => d.town === town && d.operator !== operator);
      centres.set(
        key,
        others.length >= 3
          ? {
              lat: median(others.map((d) => d.station.lat)),
              lon: median(others.map((d) => d.station.lon)),
            }
          : null,
      );
    }
    return centres.get(key)!;
  };
  const groups = new Map<string, SiteDraft[]>();
  for (const d of drafts) {
    if (!d.town || !d.label) continue;
    const key = `${d.operator}|${d.town}|${d.label}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const folded = new Set<SiteDraft>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const c = centre(group[0]!.town, group[0]!.operator);
    if (!c) continue;
    const km = new Map(group.map((d) => [d, haversineKm(d.station, c)]));
    const inside = group.filter((d) => km.get(d)! <= TOWN_KM);
    if (!inside.length) continue;
    const home = inside.reduce((a, b) => (km.get(b)! < km.get(a)! ? b : a));
    for (const d of group) {
      if (km.get(d)! <= TOWN_KM) continue;
      for (const id of d.stations) home.stations.add(id);
      home.ac.push(...d.ac);
      home.dc.push(...d.dc);
      home.fees.push(...d.fees);
      const ev = home.station.ev!;
      for (const k of d.station.ev!.sockets) if (!ev.sockets.includes(k)) ev.sockets.push(k);
      const kw = d.station.ev!.maxKw;
      if (kw != null && (ev.maxKw == null || kw > ev.maxKw)) ev.maxKw = kw;
      folded.add(d);
    }
  }
  return drafts.filter((d) => !folded.has(d));
}

/**
 * One charger per site (operator + coordinates, ~10 m): the register lists every charge point,
 * and a car park often has several at the same spot. The site's price is its cheapest €/kWh;
 * AC and DC prices are kept for the popup.
 */
export function parseRegisterRows(rows: string[][]): Station[] {
  const [header, ...body] = rows;
  if (!header) throw new Error("Via Lietuva report is empty");
  const col = {} as Record<Column, number>;
  for (const [key, re] of Object.entries(COLUMNS) as [Column, RegExp][]) {
    const i = header.findIndex((h) => re.test(h));
    if (i === -1) throw new Error(`Via Lietuva report has no "${key}" column`);
    col[key] = i;
  }
  const featuresCol = header.findIndex((h) => FEATURES_COLUMN.test(h));
  const sites = new Map<string, SiteDraft>();
  for (const r of body) {
    const get = (k: Column) => (r[col[k]] ?? "").trim();
    const vehicle = get("vehicle");
    if (vehicle && !/lengv/i.test(vehicle)) continue;
    const x = num(get("x"));
    const y = num(get("y"));
    if (x == null || y == null) continue;
    // The register calls latitude "X"; accept either order.
    const p = x > y ? { lat: x, lon: y } : { lat: y, lon: x };
    if (!inLithuania(p)) continue;
    const operator = get("operator") || get("owner");
    const key = `${operator.toLowerCase()}|${p.lat.toFixed(4)}|${p.lon.toFixed(4)}`;
    const stationId = get("station");
    let site = sites.get(key);
    if (!site) {
      const location = get("location");
      const { name, address } = splitLocation(location, operator);
      const town = (r[featuresCol] ?? "").match(/miesto mazgas\s*-\s*([^\n]+)/i)?.[1] ?? "";
      site = {
        station: {
          id: "",
          name: name || operator || "Įkrovimo stotelė",
          // Not the owner: Ignitis gamyba owns chargers Stuart Energy runs, outside Ignitis ON.
          brand: normalizeBrand(operator, name),
          lat: p.lat,
          lon: p.lon,
          ...(address ? { address } : {}),
          fuels: ["EV"],
          sourceIds: {},
          ev: { sockets: [], ...(operator ? { network: operator } : {}) },
        },
        stations: new Set(),
        ac: [],
        dc: [],
        fees: [],
        owner: get("owner"),
        location,
        operator: fold(operator),
        label: fold(location),
        town: fold(town),
      };
      sites.set(key, site);
    }
    if (stationId) site.stations.add(stationId);
    const ev = site.station.ev!;
    const socket = get("connector");
    if (socket) {
      const k = socketKey(socket);
      if (!ev.sockets.includes(k)) ev.sockets.push(k);
    }
    const kw = num(get("maxPower"));
    if (kw != null && kw > 0 && (ev.maxKw == null || kw > ev.maxKw)) ev.maxKw = kw;
    const price = parseRegisterPrice(get("price"));
    if (price.kwh != null) (/nuolat/i.test(get("current")) ? site.dc : site.ac).push(price.kwh);
    if (price.sessionFee != null) site.fees.push(price.sessionFee);
  }

  const out: Station[] = [];
  for (const site of foldMisplaced([...sites.values()])) {
    const ids = [...site.stations].sort();
    const s = site.station;
    s.id = `vl:${ids[0] ?? `${s.lat.toFixed(5)},${s.lon.toFixed(5)}`}`;
    s.sourceIds = { [VIA_LIETUVA_SOURCE]: ids.join(",") };
    const ev = s.ev!;
    ev.sockets.sort();
    const ac = site.ac.length ? Math.min(...site.ac) : undefined;
    const dc = site.dc.length ? Math.min(...site.dc) : undefined;
    const all = [ac, dc].filter((v): v is number => v != null);
    if (all.length) ev.registerPrice = Math.min(...all);
    if (ev.registerPrice === 0) ev.free = freeReason(site.owner, ev.network ?? "", site.location);
    if (ac != null || dc != null) {
      ev.prices = { ...(ac != null ? { ac } : {}), ...(dc != null ? { dc } : {}) };
    }
    if (site.fees.length) ev.sessionFee = Math.max(...site.fees);
    out.push(s);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export async function parseRegisterXlsx(buf: Buffer): Promise<Station[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Via Lietuva report has no sheet");
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as unknown[]).slice(1);
    rows.push(values.map(cellText));
  });
  return parseRegisterRows(rows);
}

export async function fetchRegister(
  fetchImpl: typeof fetch = fetch,
): Promise<{ reportUrl: string; chargers: Station[] }> {
  const headers = { "User-Agent": FETCH_UA, Referer: `${VIA_LIETUVA_BASE}/` };
  const home = await fetchImpl(`${VIA_LIETUVA_BASE}/`, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!home.ok) throw new Error(`Via Lietuva home HTTP ${home.status}`);
  const reportUrl = reportUrlFromHome(await home.text());
  if (!reportUrl) throw new Error("Via Lietuva home page links no report");
  const res = await fetchImpl(reportUrl, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Via Lietuva report HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10_000 || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`Via Lietuva report is not an XLSX file (${buf.length} bytes)`);
  }
  const chargers = await parseRegisterXlsx(buf);
  if (chargers.length < MIN_REGISTER_SITES) {
    throw new Error(`Via Lietuva report has too few sites (${chargers.length})`);
  }
  return { reportUrl, chargers };
}

export function loadRegisterCache(path: string): RegisterCache | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RegisterCache;
    if (typeof raw?.fetchedAt !== "string" || !Array.isArray(raw.chargers)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** The cached register, if it is recent enough to stand in for a failed download. */
export function usableCache(cache: RegisterCache | null, now: Date): RegisterCache | null {
  if (!cache) return null;
  const age = now.getTime() - Date.parse(cache.fetchedAt);
  return age >= 0 && age <= REGISTER_MAX_AGE_HOURS * 3_600_000 ? cache : null;
}
