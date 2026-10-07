export const FUEL_TYPES = ["95", "98", "D", "LPG", "EV"] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

/** Fuels sold at the pump (€/l), priced per station by LEA and the other ranked sources. */
export const PUMP_FUELS = ["95", "98", "D", "LPG"] as const satisfies readonly FuelType[];
export type PumpFuel = (typeof PUMP_FUELS)[number];

/** Fuels with per-provider price history: pump fuels by brand, EV chargers by network. */
export const HISTORY_FUELS = [...PUMP_FUELS, "EV"] as const satisfies readonly FuelType[];

/** Series id of the Nord Pool LT spot price in `HistoryFile.spot`. */
export const SPOT_SERIES = "spot";

export const HISTORY_KEEP_DAYS = 7;

export const HISTORY_STATS = ["avg", "min", "max", "median"] as const;
export type HistoryStat = (typeof HISTORY_STATS)[number];

export interface BrandStat {
  min: number;
  max: number;
  avg: number;
  median: number;
}

export const FUEL_GROUPS = ["diesel", "petrol", "gas", "ev"] as const;
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
  /** Charging point details; set only on EV chargers (`data/chargers.json`). */
  ev?: ChargerInfo;
}

export interface ChargerInfo {
  /** Socket kinds from OSM `socket:*` tags, e.g. `type2`, `type2_combo`, `chademo`. */
  sockets: string[];
  /** Highest output in kW across sockets, when tagged. */
  maxKw?: number;
  /** Highest output in kW of each socket kind, e.g. `{ type2: 22, type2_combo: 150 }`. */
  kwBySocket?: Record<string, number>;
  /** Network or operator as tagged in OSM. */
  network?: string;
  /** Price in €/kWh parsed from the OSM `charge` tag. */
  chargeTag?: number;
  /** Cheapest ad hoc €/kWh reported to the national register (Via Lietuva); 0 means free. */
  registerPrice?: number;
  /** Register prices by current type, for the popup. */
  prices?: { ac?: number; dc?: number };
  /** Flat € per charging session on top of the €/kWh price. */
  sessionFee?: number;
  /** Why the register lists this charger as free; set only when `registerPrice` is 0. */
  free?: { reason: FreeReason; owner?: string };
}

/** Likely reason a register charger is free, read from its owner and site (`free.*` messages). */
export type FreeReason =
  "municipal" | "powerPlant" | "airport" | "fleet" | "workplace" | "networkPaid" | "unknown";

/** Plug choices in the EV settings; `other` is Tesla, Type 1, CCS1, Schuko and CEE. */
export const PLUG_GROUPS = ["type2", "ccs", "chademo", "other"] as const;
export type PlugGroup = (typeof PLUG_GROUPS)[number];

/** Charging power presets on the EV chip row: any, fast and ultra-fast. */
export const EV_MIN_KW = [0, 50, 150] as const;
export type EvMinKw = (typeof EV_MIN_KW)[number];

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
  byFuel: Partial<Record<FuelType, Record<string, BrandStat>>>;
}

export interface HistoryHourSeries {
  /** Calendar dates (`YYYY-MM-DD`, Europe/Vilnius) aligned with `hours` and brand values. */
  dates?: string[];
  /** Hour of day in Europe/Vilnius for each sample (not a 24-hour clock profile). */
  hours: number[];
  /** Average prices; used by cheap-hours and as the default chart series. */
  brands: Record<string, Array<number | null>>;
  /** Per-stat brand series. Missing stats fall back to `brands`. */
  stats?: Partial<Record<HistoryStat, Record<string, Array<number | null>>>>;
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
  /** Nord Pool LT spot price by hour, including tomorrow once published. */
  spot?: HistoryHourSeries;
}

export interface DataMeta {
  date: string | null;
  generatedAt: string;
  /** When the pipeline last fetched sources, even if prices did not change. Not shown in the UI. */
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
  /** EV chargers in `chargers.json`. */
  chargerCount?: number;
  /** When the Nord Pool LT spot price series was last fetched successfully. */
  spotUpdatedAt?: string;
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
  /** EV consumption in kWh/100 km. */
  evConsumption: number;
  /** Energy per charging stop in kWh, used like `litres` for EV savings. */
  evKwh: number;
  timeValue: number;
  roadFactor: number;
  aroundRadiusKm: number;
  aroundReturn: boolean;
  /** A station is on the way when stopping there adds less than this much road (km). */
  maxDetourKm: number;
  hideUnpriced: boolean;
  /** Use GPS (`enableHighAccuracy`) for a more precise browser location. */
  highAccuracyLocation: boolean;
  /** Brand ids the user turned off. Empty means every provider is included. */
  excludedBrands: string[];
  /** Charging networks the user turned off; kept apart so EV and fuel filters never mix. */
  excludedEvBrands: string[];
  /** Plugs the user's car cannot take. Empty means any plug. */
  excludedPlugs: PlugGroup[];
  /** Only chargers with a fitting plug this powerful (kW); 0 means any power. */
  evMinKw: EvMinKw;
  /** Statistic plotted on the history chart. */
  historyStat: HistoryStat;
  locale?: "lt" | "en";
}

export const DEFAULT_SETTINGS: UserSettings = {
  fuel: "D",
  routePreference: "fastest",
  consumption: 7,
  litres: 40,
  evConsumption: 17,
  evKwh: 30,
  timeValue: 0,
  roadFactor: 1.3,
  aroundRadiusKm: 15,
  aroundReturn: true,
  maxDetourKm: 1,
  hideUnpriced: true,
  highAccuracyLocation: true,
  excludedBrands: [],
  excludedEvBrands: [],
  excludedPlugs: [],
  evMinKw: 0,
  historyStat: "avg",
};

export const LT_BOUNDS = {
  minLon: 20.84,
  minLat: 53.88,
  maxLon: 26.84,
  maxLat: 56.46,
};

export const LT_CENTER: [number, number] = [23.88, 55.2];
