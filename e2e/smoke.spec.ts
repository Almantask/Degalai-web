import { test, expect } from "@playwright/test";

test("Lithuanian map shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".logo")).toContainText("Kur degalai");
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.getByRole("button", { name: /Dyzelinas|Diesel/ })).toBeVisible();
});

test("English locale and about page", async ({ page }) => {
  await page.goto("/en/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("link", { name: "About" }).click();
  await expect(page.getByRole("heading", { name: "About" })).toBeVisible();
  await expect(page.getByText(/Lithuanian Energy Agency/)).toBeVisible();
});

test("history page in Lithuanian", async ({ page }) => {
  await page.goto("/istorija");
  await expect(page.getByRole("heading", { name: "Kainų istorija" })).toBeVisible();
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
  await page.getByRole("button", { name: "Aplink mane" }).click();
  await expect(page.getByRole("heading", { name: "Aplink mane" })).toBeVisible();
});

test("fuel filter switches petrol grades", async ({ page }) => {
  await page.goto("/?fuel=petrol");
  await page.getByRole("button", { name: "Benzinas" }).click();
  await expect(page.getByRole("button", { name: "95" })).toBeVisible();
  await page.getByRole("button", { name: "98" }).click();
  await expect(page).toHaveURL(/fuel=98/);
});
