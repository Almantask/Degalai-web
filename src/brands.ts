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
