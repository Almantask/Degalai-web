import { test, expect, type Page } from "@playwright/test";

test("Lithuanian map shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".logo")).toContainText("Kur degalai");
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.getByRole("button", { name: /Dyzelinas|Diesel/ })).toBeVisible();
  await expect(page.getByPlaceholder("Kur važiuojate?")).toBeVisible();
  await expect(page.getByPlaceholder("Nuo mano vietos")).toBeVisible();
  await expect(page.getByRole("link", { name: "Istorija" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Apie" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Maršrutas" })).toHaveCount(0);
});

test("English locale loads without about", async ({ page }) => {
  await page.goto("/en/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByPlaceholder("Where are you going?")).toBeVisible();
  await expect(page.getByPlaceholder("From my location")).toBeVisible();
  await expect(page.getByRole("link", { name: "Donate" })).toHaveAttribute(
    "href",
    "https://github.com/sponsors/Almantask",
  );
  await expect(page.getByRole("link", { name: "History" })).toBeVisible();
  await expect(page.getByRole("link", { name: "About" })).toHaveCount(0);
});

test("history button opens provider averages by hour", async ({ page }) => {
  const historyUrls: string[] = [];
  const priceUrls: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("history.json")) historyUrls.push(req.url());
    if (/prices\/\d{4}-\d{2}-\d{2}\.json/.test(req.url())) priceUrls.push(req.url());
  });
  await page.goto("/");
  await expect(page.locator(".station-row").first()).toBeVisible({ timeout: 15_000 });
  expect(historyUrls).toEqual([]);
  expect(priceUrls).toHaveLength(1);
  await page.getByRole("link", { name: "Istorija" }).click();
  await expect(page).toHaveURL(/istorija/);
  await expect(page.getByRole("heading", { name: "Istorinės kainos" })).toBeVisible();
  await expect(page.locator(".history-caption")).toContainText(/Tiekėjų vidutinės kainos/);
  await expect.poll(() => historyUrls.length).toBe(1);
  await expect(page.locator("#history-chart .uplot")).toBeVisible();
  expect(priceUrls).toHaveLength(1);
});

test("station list is cheapest-first with a badge on top", async ({ page }) => {
  await page.goto("/");
  const first = page.locator(".station-row").first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  await expect(first.locator(".badge")).toHaveText(/Pigiausia/);
  const last = page.locator(".station-row").last();
  await expect(last.locator(".badge")).toHaveText(/Brangiausia/);
  await expect(page.locator(".station-eta")).toHaveCount(0);
  const texts = await page.locator(".station-row .station-price").allTextContents();
  const values = texts.map((s) => Number(s.replace(/[^\d,.-]/g, "").replace(",", ".")));
  expect(values.length).toBeGreaterThan(1);
  const sorted = [...values].sort((a, b) => a - b);
  expect(values).toEqual(sorted);
});

test("station list can be minimised", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /Sutraukti sąrašą|Išskleisti sąrašą/ });
  await expect(toggle).toBeVisible();
  await expect(page.locator(".list-body")).toBeVisible();
  await toggle.click();
  await expect(page.locator(".sheet")).toHaveClass(/is-min/);
  await expect(page.locator(".list-body")).toBeHidden();
});

test("search header can be minimised for a full map", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /Sutraukti paiešką|Išskleisti paiešką/ });
  await expect(toggle).toBeVisible();
  await expect(page.getByPlaceholder("Kur važiuojate?")).toBeVisible();
  await toggle.click();
  await expect(page.locator("#header")).toHaveClass(/is-min/);
  await expect(page.getByPlaceholder("Kur važiuojate?")).toBeHidden();
  await expect(page.locator("#map")).toBeVisible();
  await page.getByRole("button", { name: /Išskleisti paiešką|Expand search/ }).click();
  await expect(page.getByPlaceholder("Kur važiuojate?")).toBeVisible();
});

async function dragVertically(
  page: Page,
  box: { x: number; y: number; width: number; height: number },
  dy: number,
): Promise<void> {
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(12, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy, { steps: 10 });
  await page.mouse.up();
}

test("mobile sheets use a grabber and minimise by dragging", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".list-body")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".list-handle")).toBeVisible();
  await expect(page.locator(".header-handle")).toBeVisible();
  await expect(page.locator(".list-chevron")).toBeHidden();
  await expect(page.locator(".header-chevron")).toBeHidden();

  const listHead = page.locator(".list-head");
  const listBox = await listHead.boundingBox();
  expect(listBox).toBeTruthy();
  await dragVertically(page, listBox!, 90);
  await expect(page.locator(".sheet")).toHaveClass(/is-min/);
  await expect(page.locator(".list-body")).toBeHidden();

  const headerToggle = page.locator(".header-toggle");
  const headerBox = await headerToggle.boundingBox();
  expect(headerBox).toBeTruthy();
  await dragVertically(page, headerBox!, -90);
  await expect(page.locator("#header")).toHaveClass(/is-min/);
  await expect(page.getByPlaceholder("Kur važiuojate?")).toBeHidden();
});

test("header has no Around me button", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Aplink mane" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Around me" })).toHaveCount(0);
  const first = page.locator(".station-row").first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".station-eta")).toHaveCount(0);
  await expect(page.getByText(/max\. greičiu/)).toHaveCount(0);
});

test("fuel filter has no 95/98 petrol grades", async ({ page }) => {
  await page.goto("/?fuel=petrol");
  await page.getByRole("button", { name: "Benzinas" }).click();
  await expect(page.getByRole("button", { name: "95", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "98", exact: true })).toHaveCount(0);
  await expect(page.locator(".fuel-filter button")).toHaveCount(3);
});

test("donate button is a GitHub Sponsors link", async ({ page }) => {
  await page.goto("/");
  const donate = page.getByRole("link", { name: "Paremk" });
  await expect(donate).toBeVisible();
  await expect(donate).toHaveAttribute("href", "https://github.com/sponsors/Almantask");
  await expect(donate).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("heading", { name: "Paremkite projektą" })).toHaveCount(0);
  await expect(page.getByText("almantusk@gmail.com")).toHaveCount(0);
  await expect(page.locator("a[href*='revolut.me']")).toHaveCount(0);
});

test("zoom and locate controls sit together in the top-right", async ({ page }) => {
  await page.goto("/");
  const corner = page.locator(".maplibregl-ctrl-top-right");
  await expect(corner.locator(".maplibregl-ctrl-zoom-in")).toBeVisible();
  await expect(corner.locator(".maplibregl-ctrl-zoom-out")).toBeVisible();
  await expect(corner.locator(".maplibregl-ctrl-geolocate")).toBeVisible();
  await expect(page.locator(".maplibregl-ctrl-bottom-left .maplibregl-ctrl-zoom-in")).toHaveCount(
    0,
  );
  await expect(page.locator(".maplibregl-ctrl-bottom-left .maplibregl-ctrl-geolocate")).toHaveCount(
    0,
  );
});

test("station list shows last updated time", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".list-updated")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".list-updated")).toContainText(/Atnaujinta/);
  await expect(page.locator(".list-updated")).toContainText(/\d{1,2}:\d{2}/);
});

test("settings keep only consumption and time value", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Nustatymai" }).click();
  await expect(page.getByRole("heading", { name: "Nustatymai" })).toBeVisible();
  await expect(page.getByText("Sąnaudos (l/100 km)")).toBeVisible();
  await expect(page.getByText("Laiko vertė (€/h)")).toBeVisible();
  await expect(page.getByText("Planuojama pripilti")).toHaveCount(0);
  await expect(page.getByText("Kelio koeficientas")).toHaveCount(0);
  await expect(page.getByText("Grįžtu į tą pačią vietą")).toHaveCount(0);
  await expect(page.getByText("Slėpti degalines")).toHaveCount(0);
  await expect(page.getByText("Užsukimo")).toHaveCount(0);
});

test("station popup has no navigate or updated text", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".station-row").first()).toBeVisible({ timeout: 15_000 });
  await page.locator(".station-row").first().click();
  await expect(page.locator("#header")).toHaveClass(/is-min/);
  await expect(page.locator(".sheet")).toHaveClass(/is-min/);
  await expect(page.locator(".maplibregl-popup")).toBeVisible();
  await expect(page.getByRole("link", { name: "Naviguoti" })).toHaveCount(0);
  await expect(page.locator(".popup-nav")).toHaveCount(0);
  await expect(page.locator(".popup-meta")).toHaveCount(0);
  await expect(page.locator(".maplibregl-popup")).not.toContainText(/Atnaujinta/);
  const fuelLabels = await page
    .locator(".maplibregl-popup .popup-row > span:first-child")
    .allTextContents();
  expect(fuelLabels).not.toContain("98");
  await expect(page.locator(".list-updated")).toContainText(/Atnaujinta/);
});

test("destination draws a route from the current location", async ({ page }) => {
  await page.addInitScript(() => {
    const pos = {
      coords: {
        latitude: 54.687,
        longitude: 25.28,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    };
    navigator.geolocation.getCurrentPosition = (ok) => ok(pos as GeolocationPosition);
  });
  await page.route("https://photon.komoot.io/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/reverse")) {
      await route.fulfill({
        json: {
          features: [
            {
              geometry: { coordinates: [25.28, 54.687] },
              properties: { name: "Vilnius", city: "Vilnius" },
            },
          ],
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        features: [
          {
            geometry: { coordinates: [23.9, 54.9] },
            properties: { name: "Kaunas", city: "Kaunas" },
          },
        ],
      },
    });
  });
  let viaRoutes = 0;
  await page.route("https://router.project-osrm.org/**", async (route) => {
    const url = route.request().url();
    const coords = url.split("/driving/")[1]?.split("?")[0] ?? "";
    if (coords.split(";").filter(Boolean).length >= 3) viaRoutes += 1;
    await route.fulfill({
      json: {
        code: "Ok",
        routes: [
          {
            distance: 100000,
            duration: 5400,
            geometry: {
              coordinates: [
                [25.28, 54.687],
                [24.6, 54.8],
                [23.9, 54.9],
              ],
            },
          },
        ],
      },
    });
  });
  await page.goto("/");
  await expect(page.getByPlaceholder("Nuo mano vietos")).toBeVisible();
  await expect(page.locator(".station-row").first()).toBeVisible({ timeout: 15_000 });
  const allStations = await page.locator(".station-row").count();
  expect(allStations).toBeGreaterThan(10);
  const dest = page.getByPlaceholder("Kur važiuojate?");
  await dest.fill("Kaunas");
  await dest.press("Enter");
  await expect(page.locator(".app")).toHaveClass(/has-route/, { timeout: 15_000 });
  await expect(page.locator("#header")).toHaveClass(/is-min/);
  await expect(page.locator(".sheet")).toHaveClass(/is-min/);
  await expect(page.getByPlaceholder("Kur važiuojate?")).toBeHidden();
  await expect(page.locator(".list-body")).toBeHidden();
  await expect(page.locator(".maplibregl-marker")).toHaveCount(2);
  const routeStations = await page.locator(".station-row").count();
  expect(routeStations).toBeGreaterThan(0);
  expect(routeStations).toBeLessThan(allStations);
  await expect(page.locator(".station-row.is-on-route, .station-row.is-detour")).toHaveCount(
    routeStations,
  );
  await expect(page.locator("#map")).toHaveAttribute("data-station-count", String(routeStations));
  expect(viaRoutes).toBeGreaterThan(0);
  expect(viaRoutes).toBeLessThanOrEqual(5);
  await expect(page.getByText(/max\. greičiu|at max speed/)).toHaveCount(0);
  const metas = await page.locator(".station-eta").allTextContents();
  expect(metas.length).toBe(routeStations);
  for (const text of metas) {
    expect(text).toContain("km");
    expect(text).not.toMatch(/max\. greičiu|at max speed|\bmin\b|val\./);
  }
  await page.getByRole("button", { name: /Išskleisti sąrašą/ }).click();
  await expect(page.locator(".list-body")).toBeVisible();
  await page.locator(".station-row").first().click();
  await expect(page.locator("#header")).toHaveClass(/is-min/);
  await expect(page.locator(".sheet")).toHaveClass(/is-min/);
  await expect(page.locator(".list-body")).toBeHidden();
  await expect(page.locator(".maplibregl-popup")).toBeVisible();
});
