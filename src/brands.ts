export const BRAND_ALIASES: Record<string, string> = {
  "circle k": "circle-k",
  circlek: "circle-k",
  "circle-k": "circle-k",
  statoil: "circle-k",
  viada: "viada",
  orlen: "orlen",
  "orlen lietuva": "orlen",
  pkn: "orlen",
  neste: "neste",
  "neste lietuva": "neste",
  "baltic petroleum": "baltic-petroleum",
  balticpetroleum: "baltic-petroleum",
  alausa: "alausa",
  alauša: "alausa",
  emsi: "emsi",
  jozita: "jozita",
  stateta: "stateta",
  ecoil: "ecoil",
  kvistija: "kvistija",
  astreja: "astreja",
  "kuro operatorius": "kuro-operatorius",
  lukoil: "lukoil",
  shell: "shell",
  q1: "q1",
  "sks degalinė": "sks",
  "sks degaline": "sks",
  // EV charging networks (OSM `network` / `operator` on charging stations).
  "ignitis on": "ignitis-on",
  ignitis: "ignitis-on",
  eleport: "eleport",
  "enefit volt": "enefit",
  enefit: "enefit",
  supercharger: "tesla",
  tesla: "tesla",
  ionity: "ionity",
  lidl: "lidl",
  virta: "virta",
};

const ORDERED = Object.entries(BRAND_ALIASES).sort((a, b) => b[0].length - a[0].length);

export function normalizeBrand(...parts: (string | undefined)[]): string {
  const hay = parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[„“"']/g, "");
  for (const [alias, brand] of ORDERED) {
    const needle = alias.normalize("NFD").replace(/\p{M}/gu, "");
    if (hay.includes(needle)) return brand;
  }
  return "independent";
}

/** Brand ids the app knows by name (fuel chains and the larger EV networks). */
export const KNOWN_BRANDS = new Set([...Object.values(BRAND_ALIASES), "independent"]);

// Company forms dropped from network names (after diacritics are stripped, so "VšĮ" is "vsi").
const LEGAL_FORMS = /\b(?:uab|ab|mb|vsi|sia|oy|gmbh|ltd)\b/g;

/**
 * Provider id for a charging network the alias list does not know, e.g. `In Balance grid, UAB`
 * → `in-balance-grid`. Same shape as brand ids, so settings can store it.
 */
export function networkSlug(name: string | undefined): string {
  const slug = (name ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(LEGAL_FORMS, " ")
    // The register spells one network both "Inbalance grid" and "In Balance grid, UAB".
    .replace(/\bin balance\b/g, "inbalance")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "independent";
}

export function displayBrandName(brand: string): string {
  const map: Record<string, string> = {
    "circle-k": "Circle K",
    viada: "Viada",
    orlen: "Orlen",
    neste: "Neste",
    "baltic-petroleum": "Baltic Petroleum",
    alausa: "Alauša",
    emsi: "Emsi",
    jozita: "Jozita",
    stateta: "Stateta",
    ecoil: "Ecoil",
    kvistija: "Kvistija",
    astreja: "Astrėja",
    "kuro-operatorius": "Kuro operatorius",
    lukoil: "Lukoil",
    shell: "Shell",
    q1: "Q1",
    sks: "SKS",
    "ignitis-on": "Ignitis ON",
    eleport: "Eleport",
    enefit: "Enefit",
    tesla: "Tesla",
    ionity: "IONITY",
    lidl: "Lidl",
    virta: "Virta",
    independent: "Kita",
  };
  return map[brand] ?? brand;
}

export function osmFuels(tags: Record<string, string>): Array<"95" | "98" | "D" | "LPG"> {
  const fuels = new Set<"95" | "98" | "D" | "LPG">();
  const blob = Object.entries(tags)
    .filter(([k]) => k.startsWith("fuel:") || k === "fuel")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")
    .toLowerCase();
  if (!blob) return ["95", "D"];
  if (/fuel:octane_95=yes|fuel:e10=yes|95/.test(blob)) fuels.add("95");
  if (/fuel:octane_98=yes|98/.test(blob)) fuels.add("98");
  if (/fuel:diesel=yes|diesel|dyzel/.test(blob)) fuels.add("D");
  if (/fuel:lpg=yes|lpg|snd/.test(blob)) fuels.add("LPG");
  if (fuels.size === 0) return ["95", "D"];
  return [...fuels];
}
