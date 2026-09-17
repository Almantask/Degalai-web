import { existsSync, readFileSync } from "node:fs";
import { normalizeBrand } from "../../src/brands.ts";
import type { Observation, PriceReport, Station } from "../../src/types.ts";
import { matchByAddress } from "../match.ts";

export const REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function loadPriceReports(path: string): PriceReport[] {
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return Array.isArray(raw) ? raw.filter(isPriceReport) : [];
}

function isPriceReport(value: unknown): value is PriceReport {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<PriceReport>;
  return (
    (v.fuel === "95" || v.fuel === "98" || v.fuel === "D" || v.fuel === "LPG") &&
    typeof v.price === "number" &&
    typeof v.observedAt === "string" &&
    Boolean(v.stationId || v.address)
  );
}

export function reportStillFresh(report: PriceReport, now = new Date()): boolean {
  const expires = report.expiresAt
    ? Date.parse(report.expiresAt)
    : Date.parse(report.observedAt) + REPORT_MAX_AGE_MS;
  return Number.isFinite(expires) && expires > now.getTime();
}

export function reportsToObservations(
  reports: PriceReport[],
  stations: Station[],
  now = new Date(),
): Observation[] {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const out: Observation[] = [];
  for (const report of reports) {
    if (!reportStillFresh(report, now)) continue;
    const station =
      (report.stationId ? byId.get(report.stationId) : undefined) ??
      matchByAddress(stations, {
        sourceStationId: report.stationId ?? "report",
        brand: report.brand ?? "",
        name: report.name,
        address: report.address,
        city: report.city,
        fuel: report.fuel,
        price: report.price,
        observedAt: report.observedAt,
      });
    const lat = report.lat ?? station?.lat;
    const lon = report.lon ?? station?.lon;
    if (!station && (lat == null || lon == null)) continue;
    out.push({
      sourceStationId: station?.id ?? `report:${report.address}`,
      brand: station?.brand ?? normalizeBrand(report.brand, report.name),
      name: station?.name ?? report.name,
      address: station?.address ?? report.address,
      city: station?.city ?? report.city,
      lat,
      lon,
      fuel: report.fuel,
      price: report.price,
      observedAt: report.observedAt,
      source: "report",
    });
  }
  return out;
}
