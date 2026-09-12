# Kur degalai – kūrimo planas

Nemokama statinė svetainė (PWA), kuri kasdien perstatoma su aktualiomis degalų kainomis
visose Lietuvos degalinėse. Vartotojas gali:

1. matyti degalines žemėlapyje su kainomis;
2. įvesti maršrutą ir pamatyti, kur pakeliui pigiausia bei ar apsimoka nusukti;
3. paspausti „Aplink mane“ ir gauti pigiausias degalines, įvertinus nuvažiavimo sąnaudas;
4. peržiūrėti istorinį pigiausių kainų grafiką.

Už Lietuvos ribų nieko nedengiame.

---

## 1. Architektūra

```
┌──────────────────────────────┐   kasdien (cron, GitHub Actions)
│  Duomenų konvejeris (Node)   │
│  OSM degalinės + kainų       │──► data/stations.json
│  adapteriai → normalizavimas │──► data/prices/YYYY-MM-DD.json
│  → validacija → istorija     │──► data/history.json
└──────────────┬───────────────┘
               │ commit + build
               ▼
┌──────────────────────────────┐
│  Statinė svetainė (Vite+TS)  │  MapLibre GL, PWA, be backend'o
│  – žemėlapis                 │
│  – „Aplink mane“             │  ← geolokacija, haversine + kelio koef.
│  – maršrutas                 │  ← geokodavimas + maršrutų API
│  – istorijos grafikas        │
└──────────────────────────────┘
        hostinama GitHub Pages / Cloudflare Pages (nemokamai)
```

Pagrindinis principas: **git yra duomenų bazė**. Kiekviena diena – vienas JSON failas,
istorija – agreguotas failas. Serverio (backend) nėra; vienintelės išorinės užklausos
iš naršyklės – žemėlapio plytelės, geokodavimas ir maršrutas.

### Technologijos

| Sritis | Pasirinkimas | Kodėl |
|---|---|---|
| Statinis build'as | Vite + TypeScript (be framework'o arba Preact) | maži bundle'ai, paprasta |
| Žemėlapis | MapLibre GL JS + OpenFreeMap / Protomaps PMTiles | nemokama, vektorinės plytelės, be API rakto |
| Degalinių sąrašas | OpenStreetMap (Overpass API, `amenity=fuel`, LT ribos) | atviri duomenys, koordinatės, brand'ai |
| Geokodavimas | Photon (komoot) arba Nominatim (su LT filtru) | nemokama, ribotas naudojimas – tinka |
| Maršrutai | OSRM (žr. 5 sk. – variantai) | greitas, atviras |
| Grafikas | uPlot (arba Chart.js) | mažas, greitas dideliems laiko intervalams |
| PWA | vite-plugin-pwa (manifest + service worker) | „veikia kaip programėlė“, offline paskutiniai duomenys |
| CI | GitHub Actions cron (kasdien ~06:00 LT) | nemokama, commit'ina duomenis ir deploy'ina |
| Testai | Vitest (konvejeris, skaičiavimai), Playwright (kritiniai UI srautai) | |

---

## 2. Duomenų modelis

```ts
// data/stations.json – retai kinta, generuojama iš OSM + rankinių pataisymų
interface Station {
  id: string;            // stabilus: "osm:node:123456"
  name: string;
  brand: string;         // normalizuota: "circle-k", "viada", "orlen", "neste", ...
  lat: number; lon: number;
  address?: string;
  city?: string;
  fuels: FuelType[];     // kokius degalus siūlo
  sourceIds: Record<string, string>; // susiejimas su kainų šaltinių ID
}

type FuelType = "95" | "98" | "D" | "LPG"; // vėliau: "HVO", "D+", "95+"

// data/prices/YYYY-MM-DD.json – dienos momentinė nuotrauka
interface DailyPrices {
  date: string;                           // "2026-09-12"
  generatedAt: string;                    // ISO
  prices: Record<string /*stationId*/, Partial<Record<FuelType, PriceEntry>>>;
}
interface PriceEntry {
  price: number;        // EUR/l, 3 skaitmenys po kablelio
  source: string;       // adapterio pavadinimas
  observedAt: string;   // kada šaltinis matė kainą
}

// data/history.json – agreguota, naudojama grafikui
interface HistoryPoint {
  date: string;
  byFuel: Record<FuelType, {
    min: number; median: number; max: number;
    minStationId: string;
    byBrand: Record<string, { min: number; median: number }>;
  }>;
}
```

Svetainė kraunasi `stations.json` (~1 000 degalinių, ~150 KB gzip) + naujausią
`prices/*.json` + `history.json`. Visa filtravimo/skaičiavimo logika – kliente.

---

## 3. Duomenų konvejeris (`scripts/`)

### 3.1 Degalinių sąrašas
- Overpass užklausa: `amenity=fuel` Lietuvos administracinėje riboje (relation 72596).
- Brand'o normalizavimas pagal `brand`, `operator`, `name` (žodynas `brands.ts`).
- Rankinių pataisymų failas `data/overrides/stations.json` (klaidingos koordinatės, trūkstamos degalinės).
- Atnaujinama kartą per savaitę (ne kasdien) – OSM kinta lėtai.

### 3.2 Kainų adapteriai
Bendras interfeisas:

```ts
interface PriceSource {
  name: string;
  fetch(): Promise<Observation[]>; // { sourceStationId, brand, lat?, lon?, address?, fuel, price, observedAt }
}
```

Kandidatai (kiekvienam – atskiras adapteris, atskirai įjungiamas/išjungiamas):

| Šaltinis | Tipas | Pastabos |
|---|---|---|
| Tinklų svetainės (Circle K, Viada, Orlen, Neste, Baltic Petroleum, Alauša, Emsi, Jozita ir kt.) | oficialios kainos pagal degalinę | tiksliausia; reikia peržiūrėti kiekvienos svetainės naudojimo sąlygas ir `robots.txt` |
| Kainų agregatoriai (pvz. degalu-kainos.lt tipo) | vartotojų/tinklų pranešimai | platesnė aprėptis, bet reikia leidimo ir kokybės kontrolės |
| EU Weekly Oil Bulletin | šalies vidurkis | tik kontekstui / validacijai, ne pagal degalinę |

Svarbu: prieš įjungiant šaltinį – patikrinti teisinę pusę (ToS, atribucija). Pirmame etape
pradedame nuo 2–3 didžiausių tinklų, kurie kainas skelbia viešai pagal degalinę.

### 3.3 Susiejimas (matching)
- Šaltinio degalinė → OSM degalinė: tas pats brand'as + atstumas < 300 m; jei koordinatių
  nėra – geokoduojamas adresas (cache'inamas `data/cache/geocode.json`).
- Nesusietos degalinės patenka į `reports/unmatched.json` – peržiūrima rankomis, papildomas
  `overrides`.

### 3.4 Validacija
- Kainų diapazonai pagal degalų tipą (pvz. 95: 0,90–2,50 €/l); už ribų – atmetama, logas.
- Šuolio kontrolė: >15 % pokytis per dieną toje pačioje degalinėje – pažymima `suspicious`.
- Šviežumas: jei šaltinis nedavė duomenų >48 h – naudojama paskutinė žinoma kaina su
  žyma `stale`, po 7 d. – nerodoma.
- Jei adapteris grąžina 0 įrašų arba nukrenta – build'as nesulūžta, bet CI sukuria
  GitHub Issue / praneša (workflow `failure()` žingsnis).

### 3.5 Istorija
- Po kiekvienos dienos snapshot'o perskaičiuojamas `history.json` (min/mediana/max pagal
  degalų tipą, pagal tinklą, pigiausia degalinė).
- Senų dienų failai lieka repozitorijoje (≈ 100–200 KB/d.; po metų ~50 MB – priimtina;
  jei išaugs – archyvuojama į metinius failus).

### 3.6 CI (`.github/workflows/daily.yml`)
1. `cron: "0 3 * * *"` (06:00 LT) + rankinis `workflow_dispatch`.
2. `npm run pipeline` → generuoja `data/`.
3. `git commit -m "data: YYYY-MM-DD"` (tik jei kas nors pasikeitė).
4. `npm run build` → deploy į Pages.
5. Klaidos atveju – pranešimas.

---

## 4. Vartotojo sąsaja

### 4.1 Žemėlapis (pagrindinis vaizdas)
- Lietuvos ribos, pradinis zoom'as – visa šalis; žemėlapio `maxBounds` – LT.
- Degalinės kaip MapLibre sluoksnis (GeoJSON) su klasteriais mažuose zoom'uose.
- Žymeklio spalva pagal kainos percentilę (pigu → brangu) pasirinktam degalų tipui.
- Viršuje: degalų tipo pasirinkimas (95 / 98 / D / LPG), paieškos laukas, mygtukai
  „Aplink mane“ ir „Maršrutas“.
- Paspaudus degalinę – popup: pavadinimas, tinklas, visos kainos, atnaujinimo laikas,
  „Nuvykti“ (nuoroda į išorinę navigaciją), kainos mini-grafikas (iš dienų failų – pasirinktinai).
- Apačioje (mobile – „bottom sheet“): sąrašas matomų degalinių, rūšiuojamas pagal kainą.

### 4.2 Vartotojo nustatymai (localStorage)
- Degalų tipas.
- Automobilio sąnaudos (l/100 km), numatyta 7,0.
- Kiek litrų planuoja pilti, numatyta 40.
- Laiko vertė €/h (numatyta 0 – tada vertinamos tik degalų sąnaudos; galima įsijungti, pvz. 10 €/h).
- Kelio koeficientas (haversine → kelio atstumas), numatyta 1,3 – kai nėra maršrutų API.

### 4.3 „Aplink mane“
1. `navigator.geolocation` (arba rankinis taškas žemėlapyje, jei neleidžia).
2. Atrenkamos degalinės R = 15 km spinduliu (keičiamas: 5 / 15 / 30 km).
3. Kiekvienai skaičiuojama **grynoji nauda** (žr. 6 sk.), bazinė kaina = artimiausios
   degalinės su pasirinktais degalais kaina.
4. Sąrašas rūšiuojamas pagal grynąją naudą; rodoma: kaina, atstumas, „sutaupysi ~X €“ arba
   „neapsimoka (−Y €)“.

### 4.4 Maršrutas
1. Pradžia (numatyta – mano vieta) ir tikslas – geokodavimas su LT filtru, autocompletion.
2. Gaunamas maršrutas (geometrija + trukmė).
3. **Koridorius**: degalinės iki 500 m nuo maršruto laikomos „pakeliui“ (nusukimas ≈ 0);
   degalinės iki N km (numatyta 5 km, keičiama) – kandidatės nusukti.
4. Bazinė kaina = pigiausia degalinė koridoriuje. Kandidatėms skaičiuojamas nusukimas:
   - tiksliai: maršrutų API `table`/`route` per tarpinį tašką (papildomas atstumas ir laikas);
   - pigiai (fallback): 2 × haversine iki maršruto artimiausio taško × kelio koef., laikas
     pagal 50 km/h.
5. Rezultatas: maršrutas žemėlapyje, degalinės pakeliui + rekomenduojami nusukimai su
   „+X km, +Y min, sutaupai Z €“. Aiškiai pažymima „verta“ / „neverta“.
6. Kad neapkrauti API – nusukimas skaičiuojamas tik 10–15 geriausių kandidačių pagal kainą.

### 4.5 Istorinis grafikas
- Atskiras skydelis / puslapis `/istorija`.
- Linijos: pigiausia kaina šalyje ir mediana pasirinktam degalų tipui; laikotarpis
  1 mėn / 3 mėn / 1 m / viskas.
- Papildomai: pagal tinklą (perjungiama), tooltip'e – kurioje degalinėje tą dieną buvo pigiausia.
- Duomenys iš `history.json` – vienas failas, be papildomų užklausų.

### 4.6 PWA, našumas, kalba
- Manifest, ikonos, „Įdiegti“ užuomina; service worker cache'ina app shell ir paskutinius
  `data/*.json` (offline rodo paskutines žinomas kainas su data).
- Tikslas: < 300 KB JS gzip, LCP < 2,5 s mobiliajame 4G.
- Kalba: lietuvių (numatyta), tekstai atskirame `i18n/lt.json`, kad vėliau būtų galima pridėti EN.
- Prieinamumas: klaviatūros navigacija sąraše, kontrastai, ARIA žemėlapio valdikliams.
- SEO: statiniai puslapiai `/`, `/istorija`, `/apie`; „apie“ – šaltiniai, atribucija
  (OSM, OpenFreeMap, Photon/OSRM), atnaujinimo laikas, atsakomybės apribojimas.

---

## 5. Maršrutų servisas – variantai

Statinei svetainei tai vienintelė vieta, kur reikia „gyvo“ serviso.

| Variantas | Pliusai | Minusai |
|---|---|---|
| **A. OSRM viešas demo serveris** | nulis darbo | ne produkcijai, nepatikima |
| **B. OpenRouteService / kitas nemokamas API su raktu** | patikima, `matrix` endpoint'as | dienos limitai (~2 000 užklausų), raktas viešas kliente (riboti domenu) |
| **C. Savas OSRM LT ekstraktui (Docker, nemokamas tier'as – Fly.io / Oracle free)** | pilna kontrolė, LT grafas ~200 MB RAM | jau ne 100 % statinis, priežiūra |
| **D. Maršrutai naršyklėje (LT kelių grafas → WASM Dijkstra/CH)** | jokio serverio, tikrai nemokama | sudėtinga, ~10–20 MB parsisiuntimas |

Rekomendacija: **pradėti nuo B** su fallback'u į haversine heuristiką (svetainė veikia ir be
API); jei naudojimas išauga – pereiti į C. D – tik jei norisi visiškai be išorinių servisų.

---

## 6. Sąnaudų / naudos skaičiavimas

```
sutaupymas      = (bazinė_kaina − degalinės_kaina) × litrai
degalų_sąnaudos = papildomi_km × (sąnaudos_l_100km / 100) × degalinės_kaina
laiko_sąnaudos  = papildomos_min / 60 × laiko_vertė_eur_h
grynoji_nauda   = sutaupymas − degalų_sąnaudos − laiko_sąnaudos
```

- „Aplink mane“: papildomi_km = kelio atstumas iki degalinės (ir atgal, jei vartotojas
  pažymi „grįžtu į tą pačią vietą“ – numatyta taip).
- Maršrute: papildomi_km / min = (maršrutas per degalinę) − (tiesioginis maršrutas).
- Rodyti skaidriai: „Pigiau 0,05 €/l × 40 l = 2,00 €; nusukimas 3,2 km ≈ 0,35 € degalų,
  +4 min → grynoji nauda +1,65 €“.
- Vienetų testai su fiksuotais pavyzdžiais (`calc.test.ts`).

---

## 7. Etapai

### 0. Pagrindas
- Repo struktūra (`scripts/`, `src/`, `data/`, `public/`), Vite + TS, ESLint/Prettier, Vitest.
- GitHub Actions: lint + test PR'ams; Pages deploy iš `main`.
- Rezultatas: tuščia svetainė su Lietuvos žemėlapiu deploy'inta.

### 1. Duomenų konvejeris MVP
- OSM degalinių importas + brand'ų normalizavimas.
- 2–3 kainų adapteriai, matching, validacija, `prices/` + `history.json`.
- Kasdienis cron workflow su commit'u.
- Rezultatas: repo kasdien pasipildo duomenimis; `reports/unmatched.json` peržiūra.

### 2. Žemėlapis
- Degalinių sluoksnis su kainomis, klasteriai, degalų tipo perjungimas, popup'ai, sąrašas.
- Rezultatas: naudinga svetainė be maršrutų.

### 3. „Aplink mane“
- Geolokacija, nustatymai (sąnaudos, litrai), grynosios naudos skaičiavimas su haversine.
- Rezultatas: pirmas „ar apsimoka“ funkcionalumas.

### 4. Maršrutas
- Geokodavimas, maršrutų API integracija (variantas B) + fallback, koridorius, nusukimų
  vertinimas, UI su rekomendacijomis.

### 5. Istorija
- `history.json` grafikas, laikotarpiai, tinklų palyginimas, mini-grafikas popup'e.

### 6. PWA ir kokybė
- Manifest / service worker / offline, našumo optimizacija, prieinamumas, SEO, „apie“ puslapis.
- Playwright testai: žemėlapis kraunasi, „aplink mane“ su mock geolokacija, maršruto srautas.

### 7. Priežiūra ir stebėjimas
- Adapterių gedimų pranešimai, duomenų kokybės ataskaita CI santraukoje.
- Likusių tinklų adapteriai, vartotojų pranešimų apie klaidingas kainas forma (GitHub Issue
  šablonas arba paprasta forma per nemokamą servisą).

---

## 8. Rizikos ir prielaidos

- **Duomenų šaltiniai** – didžiausia rizika. Lietuvoje nėra privalomo oficialaus kainų feed'o
  pagal degalinę (kaip DE/AT), tad remiamasi tinklų svetainėmis / agregatoriais. Kiekvienas
  šaltinis gali keisti struktūrą – adapteriai izoliuoti, gedimas neišjungia svetainės.
- **Teisiniai aspektai** – prieš įjungiant šaltinį patikrinti naudojimo sąlygas; visur rodyti
  atribuciją ir kainų datą/laiką; „kainos gali skirtis“ atsakomybės apribojimas.
- **Nemokamų servisų limitai** (geokodavimas, maršrutai) – cache'inti kliente, riboti užklausų
  skaičių (debounce, top-N kandidatės), turėti heuristinį fallback'ą.
- **Repo augimas** dėl dienos failų – stebėti; esant reikalui archyvuoti į metinius failus.
- **Prielaidos** (galima keisti): degalų tipai – 95, 98, D, LPG; kainos atnaujinamos 1×/d.;
  numatytosios sąnaudos 7 l/100 km, 40 l, laiko vertė 0 €/h; kalba – tik LT pirmame etape.
