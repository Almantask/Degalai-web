# Provider data mistakes

Errors and quirks found in source data, with what the app does about each. Checked against the
Via Lietuva charge point register, report
[904](https://ev.vialietuva.lt/report/904) (5,814 charge points), on 2026‑10‑06.

IDs are the register's charge point codes (`Įkrovimo stotelės identifikacinis kodas`); the app's
charger id is `vl:` plus the lowest code at a site.

## Via Lietuva charge point register

### Pins far from the address typed for them

The operator typed the right address but dropped the pin elsewhere. In each case the same
operator gave the same address to another site that is in the right town.

| Codes                                                                                              | Address in the register      | Pin                                                                                                                          | Where the address is                                                              |
| -------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| STR-E-7922, STR-E-8457, STR-E-8821, STR-E-9373, STR-E-1338 (5 × Type 2, 22 kW, entered 2026‑08‑14) | Elektrinės g. 21, Elektrėnai | 54.6833, 25.2933 · 54.6906, 25.2807 · 54.6859, 25.2858 · 54.6739, 25.2887 · 54.6827, 25.2876 (Vilnius Old Town, ~40 km away) | STR-E-2835/2836 at the Elektrėnai plant, 54.7734, 24.6481                         |
| STR-E-2200 (2 × CCS, 150 kW)                                                                       | T. Masulio g. 22A, Kaunas    | 54.7786, 24.1257 (~13 km east of the street, ~19 km from Kaunas)                                                             | STR-E-6631 at 54.8816, 24.0062; T. Masiulio g. 21A (STR-E-BIKW) is 0.8 km from it |

Owner: AB „Ignitis gamyba“; operator: Stuart Energy. "Masulio" is also misspelt; the street is
T. Masiulio g.

**App:** `foldMisplaced` in `scripts/adapters/via-lietuva.ts` folds a site more than 15 km
outside its stated town (`Miesto mazgas`, located by other operators' chargers there) into the
operator's site with the same location text inside that town. On report 904 it moves exactly
these 6 sites.

### Wrong or misspelt town (`Miesto mazgas`)

| Codes                          | Location text                                  | Town given | Pin                                                                                                              |
| ------------------------------ | ---------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| LLT-E-E000, LLT-E-P8GO         | Lidl Kaunas Vytauto, Vilniaus g. 111, Raseniai | Kaunas     | 55.3810, 23.1095: Raseiniai, matches the street; "Kaunas Vytauto" and the town are wrong, "Raseniai" is misspelt |
| LLT-E-0017                     | Lidl Raseiniai, Vilniaus gatvė 111             | Kaunas     | 55.3808, 23.1103: Raseiniai                                                                                      |
| LLT-E-BZ2A                     | Kaunas Raseniai, Taikos prospektas 141         | Kaunas     | 54.9191, 24.0009: Kaunas, matches the street; "Raseniai" is stray                                                |
| LLT-E-2C09                     | Lidl Kaunas, Rokelių Gatvė 1                   | Kaunas     | 54.4848, 23.9660, 47 km south of Kaunas. Either the pin or the text is wrong; not resolved.                      |
| 9 Eldrive stations (21 points) |                                                | `Klaipeda` | Klaipėda, without the ė                                                                                          |

**App:** the town is only used by the misplaced-pin check, and none of these has a namesake
site to fold into, so they stay where their pins are.

### Location text with the address written twice

164 sites write the address twice, as `Kauno g. 10, Kauno g. 10` or
`Norfa XL Vilniaus g. 47B, Joniškis, Vilniaus g. 47B, Joniškis` (mostly Stuart Energy; also
Ignitis LT, Enefit Volt, Eleport, Eldrive and Virsi).

**App:** `splitRepeated` keeps the address once, and splits off a leading place name as the
name (`Norfa XL` at `Vilniaus g. 47B, Joniškis`). The popup does not repeat an address that is
already its title.

### Free chargers that are probably not public

52 points (22 sites) give the price as `Nemokama`. The register is meant for publicly accessible
charge points but has no field for limited access, and all Stuart Energy free points are listed
as open 24/7. Most free sites are on company or utility grounds:

| Owner                                           | Points               | Where                                                                                              | Likely reason                                                                                                                                        |
| ----------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| AB „Ignitis gamyba“                             | 13                   | Elektrėnai plant, Kaunas HPP, Kruonis PSHP (Marių g. 6, Maisiejūnai), Vilnius CHP (Jočionių g. 13) | Staff and visitors at power plants                                                                                                                   |
| Jonavos r. savivaldybė                          | 7                    | One per village: Žeimiai, Bukonys, Kulva, Upninkai, Užusaliai, Šveicarija, Šilai                   | Probably EU‑funded: municipal public chargers built with EU funds are free for 5 years. The same municipality's 16 points in Jonava cost 0.46 €/kWh. |
| SEB (owned and run by Inbalance grid)           | 10                   | Konstitucijos pr. 25, Vilnius                                                                      | Workplace or customer charging                                                                                                                       |
| Inbalance grid                                  | 4                    | Smiltynės perkėla, Klaipėda (entered 2026‑10‑01)                                                   | Unknown                                                                                                                                              |
| UAB „Rar transportas“                           | 6 (CCS, 120 kW)      | Tilžės g. 68, Šiauliai                                                                             | Fleet of a truck rental company                                                                                                                      |
| Lietuvos oro uostai                             | 2 (CCS, 60 kW)       | Rodūnios kl. 2, Vilnius Airport                                                                    | Airside charging for buses and service cars                                                                                                          |
| Klaipėdos vanduo, IDM Group, Iglu Tech Arnoldas | 4 + 3 + 2            | Company grounds                                                                                    | Workplace                                                                                                                                            |
| Inbalance grid (Vilniaus apšvietimas)           | 1 (IBG-E-4KLF, 4 kW) | Kapsų g. 26                                                                                        | Probably an error: the network's other street-light chargers cost 0.29 €/kWh                                                                         |

**App:** `freeReason` in `scripts/adapters/via-lietuva.ts` sets `ev.free` on free sites, and the
popup shows the reason behind a "?" next to "Nemokamai". The owners above are matched by name;
any other free charger owned by a company other than its operator reads as a workplace charger,
and the rest as "no reason given".

### Install date is the date the record was entered

Stuart Energy's `Įkrovimo stotelės/prieigos įrengimo data` comes in batches: 218 points on
2026‑03‑31, 170 on 2026‑07‑29, 124 on 2026‑09‑08. These are when the records were entered, not
when the chargers were installed.

**App:** not used.

### Payment methods left empty

None of Stuart Energy's 664 points list a payment method (`Atsiskaitymo už paslaugas būdai`),
paid or free; 1,871 points not marked free leave it empty. An empty field says nothing
about whether a charger is free.

**App:** not used.

### Quirks the parser handles

- The `X` coordinate column holds latitude and `Y` longitude (all 5,814 rows); the parser
  accepts either order.
- The operator is sometimes repeated at the start of the address after `|`
  (`Inbalance grid, Mindaugo g. 25`); the parser strips it.
- 20 points have an empty price.
