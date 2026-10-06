// Temporary: profiles OSM chargers that have no register site nearby. Removed after the run.
import { existsSync, readFileSync } from "node:fs";
import { haversineKm } from "../src/geo.ts";
import type { Station } from "../src/types.ts";

const read = <T>(p: string, fb: T): T => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : fb);
const osm = read<Station[]>("data/cache/osm-chargers.json", []);
const reg = read<{ chargers: Station[] }>("data/cache/via-lietuva.json", { chargers: [] }).chargers;
console.log(`osm=${osm.length} register=${reg.length}`);

const rows = osm.map((o) => {
  let best = Infinity;
  let near: Station | undefined;
  for (const s of reg) {
    const km = haversineKm(s, o);
    if (km < best) {
      best = km;
      near = s;
    }
  }
  return { o, km: best, near };
});
const only = rows.filter((r) => r.km > 0.1);
const bucket = (km: number) => (km <= 0.3 ? "0.1-0.3km" : km <= 1 ? "0.3-1km" : km <= 5 ? "1-5km" : ">5km");
const count = (xs: string[]) =>
  Object.entries(xs.reduce<Record<string, number>>((a, x) => ((a[x] = (a[x] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]);
console.log(`osm-only=${only.length}`);
console.log(`distance to nearest register site: ${JSON.stringify(count(only.map((r) => bucket(r.km))))}`);
console.log(`network: ${JSON.stringify(count(only.map((r) => r.o.ev?.network ?? "(none)")))}`);
console.log(`sockets: ${JSON.stringify(count(only.flatMap((r) => r.o.ev?.sockets.length ? r.o.ev.sockets : ["(none)"])))}`);

const ids = only.map((r) => r.o.sourceIds.osm).filter(Boolean);
const nodes = ids.filter((i) => i.startsWith("node/")).map((i) => i.slice(5));
const ways = ids.filter((i) => i.startsWith("way/")).map((i) => i.slice(4));
const q = `[out:json][timeout:60];(${nodes.length ? `node(id:${nodes.join(",")});` : ""}${ways.length ? `way(id:${ways.join(",")});` : ""});out meta tags center;`;
const meta = new Map<string, { ts: string; tags: Record<string, string> }>();
for (const url of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
  try {
    const res = await fetch(url, { method: "POST", body: `data=${encodeURIComponent(q)}`, headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(60_000) });
    const j = (await res.json()) as { elements: Array<{ type: string; id: number; timestamp: string; tags?: Record<string, string> }> };
    for (const e of j.elements) meta.set(`${e.type}/${e.id}`, { ts: e.timestamp, tags: e.tags ?? {} });
    break;
  } catch (e) {
    console.log(`overpass ${url} failed ${String(e)}`);
  }
}
const year = (ts?: string) => (ts ? ts.slice(0, 4) : "?");
console.log(`last OSM edit year: ${JSON.stringify(count(only.map((r) => year(meta.get(r.o.sourceIds.osm)?.ts))))}`);
const tag = (k: string) => count(only.map((r) => meta.get(r.o.sourceIds.osm)?.tags[k] ?? "(none)"));
for (const k of ["access", "fee", "operator", "brand", "operational_status", "opening_hours", "capacity", "motorcar", "charge"]) {
  console.log(`tag ${k}: ${JSON.stringify(tag(k).slice(0, 12))}`);
}
console.log("--- each OSM-only charger: id | name | operator/network | km to nearest register site (its name) | last edit | access/fee");
for (const r of only.sort((a, b) => a.km - b.km)) {
  const m = meta.get(r.o.sourceIds.osm);
  const t = m?.tags ?? {};
  console.log(
    [r.o.sourceIds.osm, r.o.name, t.operator ?? t.network ?? "-", `${r.km.toFixed(2)} (${r.near?.name ?? "-"})`, m?.ts?.slice(0, 10) ?? "?", `${t.access ?? "-"}/${t.fee ?? "-"}`].join(" | "),
  );
}
