import { describe, expect, it } from "vitest";
import {
  CIRCLE_K_PRICES_URL,
  circleKFuel,
  circleKSourceId,
  fetchCircleK,
  parseCircleKDate,
  parseCircleKPage,
} from "../scripts/adapters/circle-k.ts";

/** One product card in the markup circlek.lt/privatiems/degalu-kainos serves. */
const card = (image: string, alt: string, price: string, lines: string[]): string => `
  <div class="atom-card uk-width-1-1">
    <div class="inner-wrapper">
      <div class="uk-card-media-top"><picture>
        <source srcset="/media-assets/styles/original_image/s3/${image}.webp?itok=x 1x" type="image/webp"/>
        <img class="uk-width-1-1" srcset="/media-assets/styles/original_image/s3/${image}?itok=x 1x" width="665" height="374" src="/media-assets/${image}" alt="${alt}" loading="lazy" uk-img />
      </picture></div>
      <div class="uk-card-body uk-padding uk-padding-remove-bottom">
        <h2 class="uk-heading-large">                    <div>
                      ${price}
                  </div>
            </h2>
        <div class="field-textarea"><p>${lines.join("<br />\n")}</p></div>
      </div>
    </div>
  </div>`;

const page = (preamble: string): string => `
  <h1>Degalų kainos</h1>
  <div class="atom-preamble">Apačioje rasite žemiausias mūsų degalinių tinklo produktų kainas. ${preamble}</div>
  ${card("card/2025-12/Miles_95.jpg.png", "95miles", "1,919", ["Circle K Automatas Riešė", "Molėtų g. 15,  Didžiosios Riešės k.", "Vilnius"])}
  ${card("card/2025-12/MilesPlus_95.jpg.png", "95miles+", "2,033", ["Circle K Aplinkkelis II", "Panevėžio aplinkl. 20, Šilagalio k.", "Panevėžys"])}
  ${card("card/2025-12/MilesPlus_98.jpg%20%281%29.png", "98miles+", "2,043", ["Circle K Šilainiai", "Žemaičių pl. 19", "Kaunas"])}
  ${card("card/2025-12/LPG_665x374.jpg.jpg", "lpg", "0,789", ["Circle K Lazdijai", "Nekrūnų k. 1", "Lazdijai"])}
  ${card("card/2024-10/Miles_D.png", "miles+ Diesel", "2,229", ["Circle K Automatas Tauragė", "Dariaus ir Girėno g. 83A", "Tauragė"])}
  ${card("card/2024-10/MilesPlus_D.jpg", "miles+ Diesel", "2,338", ["Circle K Lazdijai", "Nekrūnų k. 1", "Lazdijai"])}
  ${card("card/2025-12/xtl.png", "xtl", "2,573", ["Circle K Murava II", "Savanorių pr. 404B", "Kaunas"])}
  ${card("card/2020-05/Adblue2_665x374.jpg?VersionId=abc", "AdBlue", "0,964", ["Visos prekiaujančios degalinės."])}
`;

const now = new Date("2026-09-17T09:30:00Z");

describe("circleKFuel", () => {
  it("reads the product from the image file name, not the mislabelled alt text", () => {
    expect(circleKFuel("/media-assets/card/2024-10/Miles_D.png", "miles+ Diesel")).toBe("D");
    expect(circleKFuel("/media-assets/card/2024-10/MilesPlus_D.jpg", "miles+ Diesel")).toBeNull();
    expect(circleKFuel("/media-assets/card/2025-12/MilesPlus_98.jpg%20%281%29.png", "")).toBe("98");
  });

  it("falls back to alt text for a renamed image and flags unknown cards", () => {
    expect(circleKFuel("/media-assets/card/2027-01/new-95.png", "95miles")).toBe("95");
    expect(circleKFuel("/media-assets/card/2027-01/new.png", "95miles+")).toBeNull();
    expect(circleKFuel("/media-assets/card/2027-01/car-wash.png", "Plovykla")).toBeUndefined();
  });
});

describe("parseCircleKDate", () => {
  it("parses the Lithuanian genitive month in Vilnius time", () => {
    expect(parseCircleKDate("Kainos atnaujintos rugsėjo 17-ą dieną.", now)).toBe("2026-09-17");
  });

  it("rolls back a year when a December page is read in January", () => {
    const january = new Date("2027-01-01T08:00:00Z");
    expect(parseCircleKDate("Kainos atnaujintos gruodžio 31-ą dieną.", january)).toBe("2026-12-31");
  });

  it("returns null when the sentence is missing", () => {
    expect(parseCircleKDate("<h1>Degalų kainos</h1>", now)).toBeNull();
  });
});

describe("parseCircleKPage", () => {
  it("keeps the fuels the app shows, with station address lines and a start-of-day stamp", () => {
    const rows = parseCircleKPage(page("Kainos atnaujintos rugsėjo 17-ą dieną."), now);
    expect(rows.map((r) => [r.fuel, r.price, r.city])).toEqual([
      ["95", 1.919, "Vilnius"],
      ["98", 2.043, "Kaunas"],
      ["LPG", 0.789, "Lazdijai"],
      ["D", 2.229, "Tauragė"],
    ]);
    expect(rows[0]).toEqual({
      sourceStationId: circleKSourceId("Vilnius", "Molėtų g. 15, Didžiosios Riešės k."),
      brand: "circle-k",
      name: "Circle K Automatas Riešė",
      address: "Molėtų g. 15, Didžiosios Riešės k.",
      city: "Vilnius",
      fuel: "95",
      price: 1.919,
      observedAt: "2026-09-17T00:00:00+03:00",
      source: "circle-k",
    });
  });

  it("throws when the page has no date or no usable prices", () => {
    expect(() => parseCircleKPage(page(""), now)).toThrow(/date not found/);
    expect(() =>
      parseCircleKPage(`<div>Kainos atnaujintos rugsėjo 17-ą dieną.</div>`, now),
    ).toThrow(/0 prices/);
  });
});

describe("fetchCircleK", () => {
  it("fetches the price page and reports HTTP errors", async () => {
    const ok: typeof fetch = async (input) =>
      String(input) === CIRCLE_K_PRICES_URL
        ? new Response(page("Kainos atnaujintos rugsėjo 17-ą dieną."), { status: 200 })
        : new Response("missing", { status: 404 });
    await expect(fetchCircleK(ok, now)).resolves.toHaveLength(4);

    const down: typeof fetch = async () => new Response("", { status: 503 });
    await expect(fetchCircleK(down, now)).rejects.toThrow(/HTTP 503/);
  });
});
