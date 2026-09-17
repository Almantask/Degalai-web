export const FUEL_TYPES = ["95", "98", "D", "LPG"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const HISTORY_KEEP_DAYS = 7;

export const FUEL_GROUPS = ["diesel", "petrol", "gas"] as const;
export type FuelGroup = (typeof FUEL_GROUPS)[number];

export interface Station {
  id: string;
  name: string;
  brand: string;
  lat: number;
  lon: number;
  address?: string;
  city?: string;
  fuels: FuelType[];
  sourceIds: Record<string, string>;
}

export interface PriceEntry {
  price: number;
  source: string;
  observedAt: string;
  stale?: boolean;
  suspicious?: boolean;
}

export interface DailyPrices {
  date: string;
  generatedAt: string;
  prices: Record<string, Partial<Record<FuelType, PriceEntry>>>;
}

export interface HistorySample {
  at: string;
  hour: number;
  byFuel: Partial<Record<FuelType, Record<string, number>>>;
}

export interface HistoryHourSeries {
  /** Calendar dates (`YYYY-MM-DD`, Europe/Vilnius) aligned with `hours` and brand values. */
  dates?: string[];
  /** Hour of day in Europe/Vilnius for each sample (not a 24-hour clock profile). */
  hours: number[];
  brands: Record<string, Array<number | null>>;
}

export interface CheapHourRange {
  /** Inclusive sample index on the chart x-axis. May wrap midnight on a 24-hour profile. */
  start: number;
  end: number;
  price: number;
  /** Inclusive Europe/Vilnius wall times (`YYYY-MM-DDTHH:mm`). */
  from?: string;
  to?: string;
}

export interface HistoryFile {
  generatedAt: string;
  keepDays: number;
  samples?: HistorySample[];
  byFuel: Partial<Record<FuelType, HistoryHourSeries>>;
}

export interface DataMeta {
  date: string | null;
  generatedAt: string;
  /** When the pipeline last fetched sources, even if prices did not change. */
  checkedAt?: string;
  /** Newest price observation in the snapshot (LEA Excel 10:00, or later live/report). */
  observedAt?: string;
  stationCount: number;
  pricedStationCount: number;
  /** Sources behind the snapshot's prices, most reliable first (`lea-live`, `lea`, `circle-k`, `report`). */
  sources: string[];
  /** Ranked sources after this run: 7-day hourly reliability, this run's result, prices chosen. */
  sourceRanking?: Array<{ name: string; score: number; ok: boolean; rows: number; chosen: number }>;
  cheapestHours?: Partial<Record<FuelType, CheapHourRange[]>>;
}

export interface Observation {
  sourceStationId: string;
  brand: string;
  lat?: number;
  lon?: number;
  address?: string;
  city?: string;
  name?: string;
  fuel: FuelType;
  price: number;
  observedAt: string;
  /** Adapter that produced this row (`lea`, `lea-live`, `report`, …). */
  source?: string;
}

/** Pump price reported by a user; applied on top of fetched sources until it expires. */
export interface PriceReport {
  stationId?: string;
  brand?: string;
  name?: string;
  address?: string;
  city?: string;
  lat?: number;
  lon?: number;
  fuel: FuelType;
  price: number;
  observedAt: string;
  /** ISO time after which the report is ignored. Defaults to 24 h after `observedAt`. */
  expiresAt?: string;
  note?: string;
}

export interface UserSettings {
  fuel: FuelType;
  routePreference: "shortest" | "fastest";
  consumption: number;
  litres: number;
  timeValue: number;
  roadFactor: number;
  aroundRadiusKm: number;
  aroundReturn: boolean;
  routeDetourKm: number;
  hideUnpriced: boolean;
  /** Use GPS (`enableHighAccuracy`) for a more precise browser location. */
  highAccuracyLocation: boolean;
  /** Brand ids the user turned off. Empty means every provider is included. */
  excludedBrands: string[];
  locale?: "lt" | "en";
}

export const DEFAULT_SETTINGS: UserSettings = {
  fuel: "D",
  routePreference: "fastest",
  consumption: 7,
  litres: 40,
  timeValue: 0,
  roadFactor: 1.3,
  aroundRadiusKm: 15,
  aroundReturn: true,
  routeDetourKm: 5,
  hideUnpriced: true,
  highAccuracyLocation: true,
  excludedBrands: [],
};

export const LT_BOUNDS = {
  minLon: 20.84,
  minLat: 53.88,
  maxLon: 26.84,
  maxLat: 56.46,
};

export const LT_CENTER: [number, number] = [23.88, 55.2];
