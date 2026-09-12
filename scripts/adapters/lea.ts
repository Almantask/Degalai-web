import ExcelJS from "exceljs";
import { normalizeBrand } from "../../src/brands.ts";
import type { Observation } from "../../src/types.ts";
import { mapLeaFuel, parsePrice, type PriceSource } from "./types.ts";

const DATA_PAGE = "https://www.ena.lt/dk-pr-pr-duomenys/";
const ENA_MAP_PAGE = "https://www.ena.lt/degalu-kainos-degalinese/";
const UA =
  "KurDegalai/0.1 (https://github.com/Almantask/Degalai-web; fuel-price research; contact via GitHub)";

export function leaSourceId(company: string, municipality: string, address: string): string {
  const raw = `${municipality}|${address}|${company}`.toLowerCase().replace(/\u00a0/g, " ");
  const tokens = raw.match(/[0-9a-ząčęėįšųūž]+/gi) ?? [];
  return `lea:${tokens.sort().join("-")}`;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "text" in value) {
    return String((value as { text: string }).text);
  }
  if (typeof value === "object" && value !== null && "result" in value) {
    return cellText((value as { result: unknown }).result);
  }
  return String(value);
}

function cellDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = cellText(value);
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const n = Number(s);
  if (Number.isFinite(n) && n > 40000 && n < 60000) {
    // Excel serial date
    const ms = Math.round((n - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

async function downloadWithCookies(url: string): Promise<Buffer> {
  let current = url;
  const cookies: string[] = [];
  for (let i = 0; i < 8; i++) {
    const res = await fetch(current, {
      redirect: "manual",
      headers: {
        "User-Agent": UA,
        ...(cookies.length ? { Cookie: cookies.join("; ") } : {}),
      },
    });
    const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const c of set) {
      const pair = c.split(";")[0];
      if (pair) cookies.push(pair);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect without location");
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ctype = res.headers.get("content-type") ?? "";
    if (ctype.includes("html") || buf.subarray(0, 8).toString("utf8").includes("<html")) {
      throw new Error("SharePoint returned HTML instead of Excel");
    }
    return buf;
  }
  throw new Error("Too many redirects downloading LEA Excel");
}

export async function findLeaExcelUrl(): Promise<string> {
  const html = await (await fetch(DATA_PAGE, { headers: { "User-Agent": UA } })).text();
  const m = html.match(/https:\/\/ltenergagen\.sharepoint\.com\/:x:\/s\/[^"'\\\s>]+/);
  if (!m) throw new Error("No SharePoint Excel link found on ena.lt data page");
  const url = m[0].replace(/&amp;/g, "&");
  const u = new URL(url);
  u.searchParams.set("download", "1");
  return u.toString();
}

function observationFromRow(
  company: string,
  muni: string,
  addr: string,
  fuelLabel: string,
  priceRaw: unknown,
  date: string,
): Observation | null {
  const fuel = mapLeaFuel(fuelLabel);
  const price = parsePrice(priceRaw);
  if (!fuel || price == null || !company || !addr) return null;
  return {
    sourceStationId: leaSourceId(company, muni, addr),
    brand: normalizeBrand(company),
    address: addr,
    city: muni,
    name: company,
    fuel,
    price,
    observedAt: `${date}T07:00:00+03:00`,
  };
}

export async function fetchLeaWorkbook(): Promise<Map<string, Observation[]>> {
  const url = await findLeaExcelUrl();
  console.log(`Downloading LEA Excel…`);
  const buf = await downloadWithCookies(url);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("LEA Excel has no sheets");

  let headerRow = 0;
  const col: Record<string, number> = {};
  ws.eachRow((row, i) => {
    if (headerRow) return;
    const texts = (row.values as unknown[] | undefined)?.map((v) => cellText(v).trim()) ?? [];
    if (texts.includes("Adresas") && texts.some((t) => t.includes("Degalų tipas"))) {
      headerRow = i;
      texts.forEach((t, idx) => {
        if (t === "Įmonė") col.company = idx;
        else if (t.startsWith("Savivaldyb")) col.muni = idx;
        else if (t === "Adresas") col.addr = idx;
        else if (t.startsWith("Degalų tipas")) col.fuel = idx;
        else if (t.startsWith("Kaina")) col.price = idx;
        else if (t.toLowerCase().includes("data")) col.date = idx;
      });
    }
  });
  if (!headerRow) throw new Error("Could not find LEA header row");

  const byDate = new Map<string, Observation[]>();
  ws.eachRow((row, i) => {
    if (i <= headerRow) return;
    const company = cellText(row.getCell(col.company).value).trim();
    const muni = cellText(row.getCell(col.muni).value).trim();
    const addr = cellText(row.getCell(col.addr).value).trim();
    const fuel = cellText(row.getCell(col.fuel).value);
    const price = row.getCell(col.price).value;
    const date = cellDate(row.getCell(col.date).value);
    if (!date) return;
    const obs = observationFromRow(company, muni, addr, fuel, price, date);
    if (!obs) return;
    const list = byDate.get(date) ?? [];
    list.push(obs);
    byDate.set(date, list);
  });
  if (byDate.size === 0) throw new Error("LEA Excel parsed 0 rows");
  return byDate;
}

export async function fetchLeaRange(start: string, endExclusive: string): Promise<Map<string, Observation[]>> {
  const all = await fetchLeaWorkbook();
  const out = new Map<string, Observation[]>();
  for (const [date, rows] of all) {
    if (date >= start && date < endExclusive) out.set(date, rows);
  }
  return out;
}

export function leaAdapter(date: string): PriceSource {
  return {
    name: "lea",
    enabled: true,
    async fetch() {
      const all = await fetchLeaWorkbook();
      const dates = [...all.keys()].sort();
      return all.get(date) ?? all.get(dates.at(-1) ?? "") ?? [];
    },
  };
}

/** Kept so CI can still try the Power BI embed if ena.lt puts it back. */
export async function leaPowerBiAvailable(): Promise<boolean> {
  const html = await (await fetch(ENA_MAP_PAGE, { headers: { "User-Agent": UA } })).text();
  return /app\.powerbi\.com\/view\?r=/.test(html);
}
