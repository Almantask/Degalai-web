// Temporary: dumps the Via Lietuva register (gzip + base64) into the CI log. Removed before merge.
import { gzipSync } from "node:zlib";
import ExcelJS from "exceljs";
import { VIA_LIETUVA_BASE } from "./adapters/via-lietuva.ts";
import { FETCH_UA } from "./adapters/types.ts";

const headers = { "User-Agent": FETCH_UA, Referer: `${VIA_LIETUVA_BASE}/` };
const home = await (await fetch(`${VIA_LIETUVA_BASE}/`, { headers })).text();
const ids = [...home.matchAll(/\/report\/(\d+)/g)].map((m) => Number(m[1]));
const url = `${VIA_LIETUVA_BASE}/report/${Math.max(...ids)}`;
const buf = Buffer.from(await (await fetch(url, { headers })).arrayBuffer());
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf as unknown as ArrayBuffer);
const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "object" && "text" in (v as object)) return String((v as { text: unknown }).text);
  if (typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result);
  return String(v);
};
const rows: string[][] = [];
wb.worksheets[0]!.eachRow({ includeEmpty: false }, (row) =>
  rows.push((row.values as unknown[]).slice(1).map(text)),
);
const b64 = gzipSync(JSON.stringify({ url, rows })).toString("base64");
console.log(`DUMP-BEGIN ${b64.length}`);
for (let i = 0; i < b64.length; i += 4000) console.log(`DUMP ${b64.slice(i, i + 4000)}`);
console.log("DUMP-END");
