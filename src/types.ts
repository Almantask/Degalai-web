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
  hours: number[];
  brands: Record<string, Array<number | null>>;
}

export interface CheapHourRange {
  /** Inclusive hour 0–23. May be greater than `end` when the range wraps midnight. */
  start: number;
  end: number;
  price: number;
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
  stationCount: number;
  pricedStationCount: number;
  sources: string[];
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
  excludedBrands: [],
};

export const LT_BOUNDS = {
  minLon: 20.84,
  minLat: 53.88,
  maxLon: 26.84,
  maxLat: 56.46,
};

export const LT_CENTER: [number, number] = [23.88, 55.2];
