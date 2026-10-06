// Temporary: prints raw Via Lietuva register rows behind a misplaced "free" charger. Removed before merge.
import ExcelJS from "exceljs";
import { haversineKm } from "../src/geo.ts";
import { parseRegisterRows, VIA_LIETUVA_BASE } from "./adapters/via-lietuva.ts";
import { FETCH_UA } from "./adapters/types.ts";

const headers = { "User-Agent": FETCH_UA, Referer: `${VIA_LIETUVA_BASE}/` };
const home = await (await fetch(`${VIA_LIETUVA_BASE}/`, { headers })).text();
const ids = [...home.matchAll(/\/report\/(\d+)/g)].map((m) => Number(m[1]));
const url = `${VIA_LIETUVA_BASE}/report/${Math.max(...ids)}`;
const buf = Buffer.from(await (await fetch(url, { headers })).arrayBuffer());
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf as unknown as ArrayBuffer);
const ws = wb.worksheets[0]!;
const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text);
  if (typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result);
  return String(v);
};
const rows: string[][] = [];
ws.eachRow({ includeEmpty: false }, (row) => rows.push((row.values as unknown[]).slice(1).map(text)));
const [header, ...body] = rows;
console.log(`report=${url} rows=${body.length}`);
header!.forEach((h, i) => console.log(`col ${i}: ${h}`));
const ci = (re: RegExp) => header!.findIndex((h) => re.test(h));
const C = {
  loc: ci(/stotelės\/prieigos vieta/i),
  op: ci(/operatorius/i),
  x: ci(/X koordinat/i),
  y: ci(/Y koordinat/i),
  price: ci(/įkrovimo kaina/i),
  station: ci(/stotelės identifikacinis kodas/i),
};
const pt = (r: string[]) => {
  const x = Number((r[C.x] ?? "").replace(",", "."));
  const y = Number((r[C.y] ?? "").replace(",", "."));
  return x > y ? { lat: x, lon: y } : { lat: y, lon: x };
};

console.log("\n### rows mentioning Elektrin / Elektrėn");
for (const r of body) {
  if (/elektrin|elektrėn/i.test(r.join(" "))) console.log(JSON.stringify(r));
}

console.log("\n### rows within 1.5 km of 54.687,25.283 (Vilnius centre)");
for (const r of body) {
  const p = pt(r);
  if (haversineKm(p, { lat: 54.687, lon: 25.283 }) < 1.5) {
    console.log(`${p.lat},${p.lon} | ${r[C.op]} | ${r[C.loc]} | ${r[C.price]}`);
  }
}

console.log("\n### price texts mentioning nemokam (count)");
const free = new Map<string, number>();
for (const r of body) {
  const v = (r[C.price] ?? "").trim();
  if (/nemokam/i.test(v)) free.set(v, (free.get(v) ?? 0) + 1);
}
for (const [v, n] of [...free].sort((a, b) => b[1] - a[1])) console.log(`${n}× ${JSON.stringify(v)}`);

console.log("\n### coordinates shared by several different locations");
const byPoint = new Map<string, Set<string>>();
for (const r of body) {
  const p = pt(r);
  const k = `${(r[C.op] ?? "").toLowerCase()}|${p.lat.toFixed(4)}|${p.lon.toFixed(4)}`;
  if (!byPoint.has(k)) byPoint.set(k, new Set());
  byPoint.get(k)!.add((r[C.loc] ?? "").trim());
}
const shared = [...byPoint].filter(([, s]) => s.size > 1).sort((a, b) => b[1].size - a[1].size);
console.log(`sites with >1 location text: ${shared.length}`);
for (const [k, s] of shared.slice(0, 25)) console.log(`${k} → ${s.size}: ${JSON.stringify([...s].slice(0, 6))}`);

console.log("\n### parsed site(s) for Elektrinės");
for (const s of parseRegisterRows(rows)) {
  if (/elektrin|elektrėn/i.test(`${s.name} ${s.address ?? ""}`)) console.log(JSON.stringify(s));
}
