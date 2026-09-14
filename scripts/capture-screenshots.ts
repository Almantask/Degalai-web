import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.SCREENSHOT_BASE_URL ?? "http://127.0.0.1:4173";
const OUT = "docs/screenshots";

const VILNIUS = { latitude: 54.6872, longitude: 25.2797 };

async function waitForStations(page: Page): Promise<void> {
  await page.locator("#map .maplibregl-canvas").waitFor();
  await page.locator(".station-row").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2500);
}

async function locateInVilnius(page: Page): Promise<void> {
  await page.locator(".maplibregl-ctrl-geolocate").click();
  await page.waitForTimeout(2500);
}

async function zoomBy(page: Page, selector: string, times: number): Promise<void> {
  const btn = page.locator(selector);
  for (let i = 0; i < times; i++) {
    await btn.click();
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(1800);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: "en-GB",
    geolocation: VILNIUS,
    permissions: ["geolocation"],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/en/`, { waitUntil: "domcontentloaded" });
  await waitForStations(page);
  await locateInVilnius(page);
  await zoomBy(page, ".maplibregl-ctrl-zoom-out", 2);
  await page.screenshot({ path: `${OUT}/map.png`, animations: "disabled" });

  const dest = page.getByPlaceholder("Where are you going?");
  await dest.click();
  await dest.fill("Kaunas");
  await dest.press("Enter");
  await page.waitForFunction(
    () => document.querySelector(".app")?.classList.contains("has-route"),
    {
      timeout: 30_000,
    },
  );
  await page.waitForTimeout(2500);
  const expandSearch = page.getByRole("button", { name: /Expand search/ });
  if (await expandSearch.isVisible()) await expandSearch.click();
  const expandList = page.getByRole("button", { name: /Expand list/ });
  if (await expandList.isVisible()) await expandList.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/route.png`, animations: "disabled" });

  await page.getByRole("link", { name: "History" }).click();
  await page.locator("#history-chart .uplot").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/history.png`, animations: "disabled" });

  await context.close();

  const mobile = await browser.newContext({
    locale: "en-GB",
    geolocation: VILNIUS,
    permissions: ["geolocation"],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const phone = await mobile.newPage();
  await phone.goto(`${BASE}/en/`, { waitUntil: "domcontentloaded" });
  await waitForStations(phone);
  await locateInVilnius(phone);
  await zoomBy(phone, ".maplibregl-ctrl-zoom-out", 2);
  await phone.screenshot({ path: `${OUT}/mobile.png`, animations: "disabled" });
  await mobile.close();
  await browser.close();
  console.log(`Wrote screenshots to ${OUT}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
