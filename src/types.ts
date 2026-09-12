export const FUEL_TYPES = ["95", "98", "D", "LPG"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

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

export interface HistoryBrandStats {
  min: number;
  median: number;
}

export interface HistoryFuelStats {
  min: number;
  median: number;
  max: number;
  minStationId: string;
  byBrand: Record<string, HistoryBrandStats>;
}

export interface HistoryPoint {
  date: string;
  byFuel: Partial<Record<FuelType, HistoryFuelStats>>;
}

export interface DataMeta {
  date: string | null;
  generatedAt: string;
  stationCount: number;
  pricedStationCount: number;
  sources: string[];
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
  locale?: "lt" | "en";
}

export const DEFAULT_SETTINGS: UserSettings = {
  fuel: "D",
  routePreference: "shortest",
  consumption: 7,
  litres: 40,
  timeValue: 0,
  roadFactor: 1.3,
  aroundRadiusKm: 15,
  aroundReturn: true,
  routeDetourKm: 5,
  hideUnpriced: true,
};

export const LT_BOUNDS = {
  minLon: 20.84,
  minLat: 53.88,
  maxLon: 26.84,
  maxLat: 56.46,
};

export const LT_CENTER: [number, number] = [23.88, 55.2];
