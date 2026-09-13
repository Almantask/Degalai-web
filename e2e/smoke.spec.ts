import { test, expect } from "@playwright/test";

test("Lithuanian map shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".logo")).toContainText("Kur degalai");
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.getByRole("button", { name: /Dyzelinas|Diesel/ })).toBeVisible();
  await expect(page.getByPlaceholder("Kur važiuojate?")).toBeVisible();
  await expect(page.getByText("Nuo mano vietos")).toBeVisible();
  await expect(page.getByRole("link", { name: "Istorija" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Apie" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Maršrutas" })).toHaveCount(0);
});

test("English locale loads without history or about", async ({ page }) => {
  await page.goto("/en/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByPlaceholder("Where are you going?")).toBeVisible();
  await expect(page.getByRole("link", { name: "Stripe" })).toHaveAttribute(
    "href",
    "https://github.com/sponsors/Almantask",
  );
  await expect(page.getByRole("link", { name: "About" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "History" })).toHaveCount(0);
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

test("around me with mocked geolocation (Vilnius)", async ({ page }) => {
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
  await page.goto("/");
  const first = page.locator(".station-row").first();
  await expect(first).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".station-eta")).toHaveCount(0);
  await expect(page.getByText(/max\. greičiu/)).toHaveCount(0);
  await page.getByRole("button", { name: "Aplink mane" }).click();
  await expect(page.getByRole("heading", { name: "Aplink mane" })).toBeVisible();
});

test("fuel filter has no 95/98 petrol grades", async ({ page }) => {
  await page.goto("/?fuel=petrol");
  await page.getByRole("button", { name: "Benzinas" }).click();
  await expect(page.getByRole("button", { name: "95", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "98", exact: true })).toHaveCount(0);
  await expect(page.locator(".fuel-filter button")).toHaveCount(3);
});

test("donate button is a GitHub Sponsors Stripe link", async ({ page }) => {
  await page.goto("/");
  const donate = page.getByRole("link", { name: "Stripe" });
  await expect(donate).toBeVisible();
  await expect(donate).toHaveAttribute("href", "https://github.com/sponsors/Almantask");
  await expect(donate).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("heading", { name: "Paremkite projektą" })).toHaveCount(0);
  await expect(page.getByText("almantusk@gmail.com")).toHaveCount(0);
  await expect(page.locator("a[href*='revolut.me']")).toHaveCount(0);
});

test("zoom controls sit in the top-right", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".maplibregl-ctrl-top-right .maplibregl-ctrl-zoom-in")).toBeVisible();
  await expect(page.locator(".maplibregl-ctrl-bottom-left .maplibregl-ctrl-zoom-in")).toHaveCount(
    0,
  );
});
