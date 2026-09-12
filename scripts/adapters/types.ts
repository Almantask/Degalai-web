import type { FuelType, Observation } from "../../src/types.ts";

export interface PriceSource {
  name: string;
  enabled: boolean;
  fetch(): Promise<Observation[]>;
}

export function mapLeaFuel(label: string): FuelType | null {
  const s = label.trim().toLowerCase();
  if (s === "95 benzinas" || s === "95") return "95";
  if (s === "98 benzinas" || s === "98") return "98";
  if (s === "dyzelinas" || s === "diesel") return "D";
  if (s === "snd" || s === "lpg") return "LPG";
  return null;
}

export function parsePrice(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 1000) / 1000;
  if (typeof value === "string") {
    const v = value.trim().replace(",", ".");
    if (!v || v === "-" || v === "—" || v === "–") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
  }
  return null;
}
