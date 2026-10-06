import { existsSync, readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { normalizeBrand } from "../../src/brands.ts";
import { round3 } from "../../src/calc.ts";
import { inLithuania } from "../../src/geo.ts";
import type { Station } from "../../src/types.ts";
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

/** `IKI Mindaugo | Inbalance grid, Mindaugo str. 25` → name and address. */
function splitLocation(text: string, operator: string): { name?: string; address?: string } {
  const [head, ...rest] = text.split("|").map((p) => p.trim());
  let address = rest.join(" | ").trim();
  if (operator && address.toLowerCase().startsWith(`${operator.toLowerCase()},`)) {
    address = address.slice(operator.length + 1).trim();
  }
  return { name: head || undefined, address: address || (rest.length ? undefined : head) };
}

interface SiteDraft {
  station: Station;
  stations: Set<string>;
  ac: number[];
  dc: number[];
  fees: number[];
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
      const { name, address } = splitLocation(get("location"), operator);
      site = {
        station: {
          id: "",
          name: name || operator || "Įkrovimo stotelė",
          // The operator, not the host named in the location (an "IKI" or "Viada" car park).
          brand: normalizeBrand(operator, get("owner")),
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
  for (const site of sites.values()) {
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
