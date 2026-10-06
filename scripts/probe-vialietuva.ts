// Temporary: prints the shape of Via Lietuva's open data endpoints. Removed before merge.
import ExcelJS from "exceljs";

const BASE = "https://ev.vialietuva.lt";
const UA = "KurDegalai/0.1 (https://github.com/Almantask/Degalai-web; probe)";

async function show(path: string, max = 3500): Promise<string> {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json, */*" },
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.text();
    const hdr = ["content-type", "x-total-count", "x-limit", "link", "content-length"]
      .map((h) => `${h}=${res.headers.get(h) ?? ""}`)
      .join(" | ");
    console.log(`\n### ${url}\nHTTP ${res.status} ${hdr}\nbytes=${body.length}\n${body.slice(0, max)}`);
    return body;
  } catch (e) {
    console.log(`\n### ${url}\nERROR ${String(e)}`);
    return "";
  }
}

await show("/ocpi/versions", 1500);
await show("/ocpi/2.3.0", 3000);
const locs = await show("/ocpi/2.3.0/locations?offset=0&limit=2", 6000);
try {
  const j = JSON.parse(locs) as { data?: unknown[] };
  console.log(`locations data length=${Array.isArray(j.data) ? j.data.length : "n/a"}`);
} catch {
  /* not JSON */
}
await show("/ocpi/2.3.0/tariffs?offset=0&limit=3", 5000);
await show("/ocpi/2.2.1/tariffs?offset=0&limit=2", 2500);
await show("/publicdata/EnergyInfrastructureTablePublication", 2500);
const terms = await show("/en/data-provision", 0);
const text = terms.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
console.log(`\n### data-provision text\n${text.slice(0, 4000)}`);

const home = await show("/", 0);
const ids = [...home.matchAll(/\/report\/(\d+)/g)].map((m) => Number(m[1]));
console.log(`report ids: ${ids.join(",")}`);
if (ids.length) {
  const url = `${BASE}/report/${Math.max(...ids)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Referer: `${BASE}/` } });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`\n### ${url} HTTP ${res.status} bytes=${buf.length}`);
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    console.log(`sheet=${ws.name} rows=${ws.rowCount} cols=${ws.columnCount}`);
    for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
      const vals = (ws.getRow(r).values as unknown[]).slice(1).map((v) => String(v ?? "").slice(0, 60));
      console.log(`row ${r}: ${JSON.stringify(vals)}`);
    }
    const priceCol = 21;
    const samples = new Set<string>();
    for (let r = 2; r <= ws.rowCount && samples.size < 25; r++) {
      const v = String(ws.getRow(r).getCell(priceCol).value ?? "").trim();
      if (v) samples.add(v.slice(0, 120));
    }
    console.log(`price samples: ${JSON.stringify([...samples], null, 1)}`);
  } catch (e) {
    console.log(`xlsx parse error ${String(e)}`);
  }
}
