import { test, expect, type Page } from "@playwright/test";

test("PWA can be installed as a standalone mobile app", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    /manifest-lt\.webmanifest/,
  );
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    "content",
    "yes",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    /apple-touch-icon/,
  );
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBeTruthy();
  const manifest = await page.evaluate(async (href) => {
    const res = await fetch(href!);
    return res.json() as Promise<{
      display: string;
      icons: Array<{ sizes: string; type: string }>;
    }>;
  }, manifestHref);
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.some((i) => i.sizes === "192x192" && i.type === "image/png")).toBe(true);
  expect(manifest.icons.some((i) => i.sizes === "512x512" && i.type === "image/png")).toBe(true);
  const icon = await page.request.get("/icons/icon-192.png");
  expect(icon.ok()).toBe(true);
  const apple = await page.request.get("/icons/apple-touch-icon.png");
  expect(apple.ok()).toBe(true);

  await page.evaluate(() => {
    const ev = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
    };
    ev.prompt = () => Promise.resolve();
    window.dispatchEvent(ev);
  });
  await expect(page.getByRole("button", { name: "Įdiegti" })).toBeVisible();
  await expect(page.getByText("Įdiekite programėlę greitesniam naudojimui.")).toBeVisible();
  await page.locator(".install-dismiss").click();
  await expect(page.getByRole("button", { name: "Įdiegti" })).toHaveCount(0);
});

test("Lithuanian map shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".logo")).toContainText("Kur degalai");
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.getByRole("button", { name: /Dyzelinas|Diesel/ })).toBeVisible();
  await expect(page.getByPlaceholder("Kur važiuojate?")).toBeVisible();
  await expect(page.getByPlaceholder("Nuo mano vietos")).toBeVisible();
  await expect(page.getByRole("link", { name: "Degalinės" })).toBeVisible();
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
    "https://almantask.github.io/donate-me/",
  );
  await expect(page.getByRole("link", { name: "Stations" })).toBeVisible();
  await expect(page.getByRole("link", { name: "History" })).toBeVisible();
  await expect(page.getByRole("link", { name: "About" })).toHaveCount(0);
  await expect(page.locator(".list-updated")).toContainText(/Last updated/);
});

test("settings button stays inside the header when switching language", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Nustatymai" })).toBeVisible();
  await expectSettingsInsideHeader(page);
  await page.getByRole("link", { name: "EN", exact: true }).click();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expectSettingsInsideHeader(page);
  await page.getByRole("link", { name: "LT", exact: true }).click();
  await expect(page.getByRole("button", { name: "Nustatymai" })).toBeVisible();
  await expectSettingsInsideHeader(page);
});

test("feedback asks bug or idea, checks the text, then opens a prefilled GitHub issue", async ({
  page,
  context,
}) => {
  // Built without VITE_REPORT_URL, as in CI: the form falls back to GitHub's new-issue page.
  await context.route("https://github.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<p>issue form</p>" }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const open = page.getByRole("button", { name: "Atsiliepimai" });
  await expect(open).toBeVisible();
  await expectInsideHeader(page, ".icon-report");
  await expectSettingsInsideHeader(page);
  await open.click();
  await expect(open).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "Atsiliepimai" })).toBeVisible();

  // Nothing to type until a category is picked.
  const bug = page.getByRole("radio", { name: "Klaida" });
  const idea = page.getByRole("radio", { name: "Pasiūlymas" });
  await expect(bug).toBeFocused();
  await expect(bug).not.toBeChecked();
  await expect(idea).not.toBeChecked();
  await expect(page.getByRole("textbox")).toHaveCount(0);

  await page.getByText("Klaida", { exact: true }).click();
  const bugText = page.getByRole("textbox", { name: "Kas neveikia arba rodoma neteisingai?" });
  await expect(bugText).toBeVisible();
  await bugText.fill("Neveikia");
  await page.getByRole("button", { name: "Tęsti GitHub'e" }).click();
  await expect(page.getByRole("alert")).toContainText("bent 10 simbolių");

  // Switching category keeps the text and changes the question.
  await bugText.fill("Žemėlapyje nerodoma degalinė Vilniuje");
  await page.getByText("Pasiūlymas", { exact: true }).click();
  await expect(idea).toBeChecked();
  const ideaText = page.getByRole("textbox", { name: "Ką programėlė galėtų daryti?" });
  await expect(ideaText).toHaveValue("Žemėlapyje nerodoma degalinė Vilniuje");
  await ideaText.fill("Pranešti, kai degalai atpinga");

  const popupOpened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Tęsti GitHub'e" }).click();
  const popup = await popupOpened;
  const url = new URL(popup.url());
  expect(`${url.origin}${url.pathname}`).toBe(
    "https://github.com/Almantask/Degalai-web/issues/new",
  );
  expect(url.searchParams.get("title")).toBe("[feature] Pranešti, kai degalai atpinga");
  expect(url.searchParams.get("labels")).toBe("enhancement");
  expect(url.searchParams.get("body")).toContain("Fuel: D");

  // The settings button swaps the panel; category and text are still there when coming back.
  await page.getByRole("button", { name: "Nustatymai" }).click();
  await expect(page.getByRole("heading", { name: "Nustatymai" })).toBeVisible();
  await open.click();
  await expect(idea).toBeChecked();
  await expect(ideaText).toHaveValue("Pranešti, kai degalai atpinga");
  await expect(ideaText).toBeFocused();
});

test("history button opens provider averages by date and time", async ({ page }) => {
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
  await expect(page.locator(".history-head .list-updated")).toContainText(/Atnaujinta/);
  await expect(page.locator(".history-caption")).toHaveCount(0);
  await expect(page.locator(".history-cheap")).toHaveCount(0);
  await expect.poll(() => historyUrls.length).toBe(1);
  await expect(page.locator("#history-chart .uplot")).toBeVisible();
  expect(priceUrls).toHaveLength(1);
  await expectHistoryFitsScreen(page);
  await page.getByRole("button", { name: "Sutraukti istoriją" }).click();
  await expect(page.locator(".history-panel")).toHaveClass(/is-min/);
  await expect(page.locator("#history-chart")).toBeHidden();
  await expect(page.locator(".map-wrap")).toHaveCSS("visibility", "visible");
  await page.getByRole("button", { name: "Išskleisti istoriją" }).click();
  await expect(page.locator("#history-chart .uplot")).toBeVisible();
  await expect(page.locator(".map-wrap")).toHaveCSS("visibility", "hidden");
  await page.getByRole("link", { name: "Degalinės" }).click();
  await expect(page).not.toHaveURL(/istorija/);
  await expect(page.getByPlaceholder("Kur važiuojate?")).toBeVisible();
  await expect(page.locator(".station-row").first()).toBeVisible();
  await expect(page.locator(".history-panel")).toHaveCount(0);
});

test("history prices stay inside the panel on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto("/istorija");
  await expect(page.locator("#history-chart .uplot")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Degalinės" })).toBeVisible();
  await expectHistoryFitsScreen(page);
});

test("history chart scrolls left and right on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto("/istorija");
  const scroll = page.locator(".history-chart-scroll");
  await expect(page.locator("#history-chart .uplot")).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeGreaterThan(80);
  await scroll.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const startLeft = await scroll.evaluate((el) => el.scrollLeft);
  expect(startLeft).toBe(0);

  const box = await scroll.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(180, 0);
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(startLeft + 40);

  await page.mouse.wheel(-240, 0);
  await expect
    .poll(async () => scroll.evaluate((el) => el.scrollLeft))
    .toBeLessThan(startLeft + 20);
  await expectHistoryFitsScreen(page);
});

test("history chart switches min max avg and median modes", async ({ page }) => {
  await page.goto("/istorija");
  await expect(page.locator("#history-chart .uplot")).toBeVisible({ timeout: 15_000 });
  const modes = page.locator(".history-stat button");
  await expect(modes).toHaveCount(4);
  await expect(page.getByRole("button", { name: "Vidurkis", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Min", exact: true }).click();
  await expect(page.getByRole("button", { name: "Min", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Vidurkis", exact: true })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator("#history-chart .uplot")).toBeVisible();
  await page.getByRole("button", { name: "Max", exact: true }).click();
  await expect(page.getByRole("button", { name: "Max", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Mediana", exact: true }).click();
  await expect(page.getByRole("button", { name: "Mediana", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".history-caption")).toHaveCount(0);
});

test("history legend toggles all providers then a single line", async ({ page }) => {
  await page.goto("/istorija");
  await expect(page.locator("#history-chart .uplot")).toBeVisible({ timeout: 15_000 });
  const all = page.getByRole("button", { name: "Visi" });
  await expect(all).toHaveAttribute("aria-pressed", "true");
  const brands = page.locator("#history-legend [data-act='history-brand']");
  await expect(brands.first()).toBeVisible();
  expect(await brands.count()).toBeGreaterThan(1);
  await expect(brands.first()).toHaveAttribute("aria-pressed", "true");
  await expect(brands.nth(1)).toHaveAttribute("aria-pressed", "true");

  await brands.first().click();
  await expect(brands.first()).toHaveAttribute("aria-pressed", "false");
  await expect(brands.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(all).toHaveAttribute("aria-pressed", "false");

  await brands.first().click();
  await expect(brands.first()).toHaveAttribute("aria-pressed", "true");
  await expect(all).toHaveAttribute("aria-pressed", "true");

  await all.click();
  await expect(all).toHaveAttribute("aria-pressed", "false");
  await expect(brands.first()).toHaveAttribute("aria-pressed", "false");
  await expect(brands.nth(1)).toHaveAttribute("aria-pressed", "false");

  await all.click();
  await expect(all).toHaveAttribute("aria-pressed", "true");
  await expect(brands.first()).toHaveAttribute("aria-pressed", "true");
  await expect(brands.nth(1)).toHaveAttribute("aria-pressed", "true");
});

test("history legend only lists providers enabled in settings", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".station-row").first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Nustatymai" }).click();
  await page.locator("#set-brand-viada").uncheck();
  await page.getByRole("button", { name: "Uždaryti" }).click();
  await page.getByRole("link", { name: "Istorija" }).click();
  await expect(page.locator("#history-chart .uplot")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#history-legend [data-brand='viada']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Visi" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#history-legend [data-act='history-brand']").first()).toBeVisible();
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

test("minimised search chip keeps a long destination inside the card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: /Sutraukti paiešką|Išskleisti paiešką/ }).click();
  await expect(page.locator("#header")).toHaveClass(/is-min/);
  await page.locator(".header-min-label").evaluate((el) => {
    el.textContent = "Kooperatyvinės sodininkystės bazė, Vydūno al. 4, Kaunas";
  });
  await expect(page.locator(".maplibregl-ctrl-top-right")).toBeVisible();
  const fit = await page.evaluate(() => {
    const header = document.querySelector("#header");
    const label = document.querySelector(".header-min-label");
    const ctrl = document.querySelector(".maplibregl-ctrl-top-right");
    if (!header || !label || !ctrl) return null;
    const h = header.getBoundingClientRect();
    const l = label.getBoundingClientRect();
    const c = ctrl.getBoundingClientRect();
    const overlap = !(
      l.right <= c.left + 1 ||
      c.right <= l.left + 1 ||
      l.bottom <= c.top + 1 ||
      c.bottom <= l.top + 1
    );
    return {
      labelInsideHeader:
        l.left >= h.left - 1 &&
        l.right <= h.right + 1 &&
        l.top >= h.top - 1 &&
        l.bottom <= h.bottom + 1,
      headerOnScreen: h.left >= -1 && h.right <= window.innerWidth + 1,
      overlap,
    };
  });
  expect(fit).toEqual({
    labelInsideHeader: true,
    headerOnScreen: true,
    overlap: false,
  });
});

async function expectSettingsInsideHeader(page: Page): Promise<void> {
  await expectInsideHeader(page, ".icon-settings");
}

async function expectInsideHeader(page: Page, selector: string): Promise<void> {
  const fit = await page.evaluate((selector) => {
    const header = document.querySelector("#header");
    const btn = document.querySelector(selector);
    if (!header || !btn) return false;
    const h = header.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    return (
      b.left >= h.left - 1 &&
      b.right <= h.right + 1 &&
      b.top >= h.top - 1 &&
      b.bottom <= h.bottom + 1 &&
      h.right <= window.innerWidth + 1
    );
  }, selector);
  expect(fit).toBe(true);
}

async function expectHistoryFitsScreen(page: Page): Promise<void> {
  const panel = page.locator(".history-panel");
  await expect(panel).toBeVisible();
  await expect(page.locator("#history-legend")).toBeVisible();
  await expect(page.getByRole("button", { name: "Visi" })).toBeVisible();
  await expect(page.locator(".map-wrap")).toHaveCSS("visibility", "hidden");
  await expect
    .poll(async () => {
      return panel.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const inside = (node: Element) => {
          const b = node.getBoundingClientRect();
          if (b.width < 1 || b.height < 1) return true;
          return (
            b.left >= r.left - 2 &&
            b.right <= r.right + 2 &&
            b.top >= r.top - 2 &&
            b.bottom <= r.bottom + 2
          );
        };
        const chart = el.querySelector("#history-chart");
        const legend = el.querySelector("#history-legend");
        const caption = el.querySelector(".history-caption");
        const stat = el.querySelector(".history-stat");
        return (
          r.top >= -1 &&
          r.left <= 1 &&
          r.right >= vw - 1 &&
          r.bottom >= vh - 1 &&
          r.bottom <= vh + 1 &&
          (!chart || inside(chart)) &&
          (!legend || inside(legend)) &&
          (!caption || inside(caption)) &&
          (!stat || inside(stat))
        );
      });
    })
    .toBe(true);
}

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

  await page.getByRole("button", { name: /Išskleisti paiešką/ }).click();
  await page.getByRole("link", { name: "Istorija" }).click();
  await expect(page.locator(".history-panel")).toBeVisible();
  await expect(page.locator(".history-handle")).toBeVisible();
  await expect(page.locator(".history-chevron")).toBeHidden();
  await expect(page.locator("#history-chart .uplot")).toBeVisible();
  await expectHistoryFitsScreen(page);
  const historyHead = page.locator(".history-head");
  const historyBox = await historyHead.boundingBox();
  expect(historyBox).toBeTruthy();
  await dragVertically(page, historyBox!, 90);
  await expect(page.locator(".history-panel")).toHaveClass(/is-min/);
  await expect(page.locator(".history-body")).toBeHidden();
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
  await expect(page.locator(".fuel-filter button")).toHaveCount(4);
});

test("donate button links to the donate page", async ({ page }) => {
  await page.goto("/");
  const donate = page.getByRole("link", { name: "Remti" });
  await expect(donate).toBeVisible();
  await expect(donate.locator(".donate-heart")).toBeVisible();
  await expect(donate).toHaveAttribute("href", "https://almantask.github.io/donate-me/");
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
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".list-updated")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".list-updated")).toContainText(/Atnaujinta/);
  await expect(page.locator(".list-updated")).toContainText(/\d{1,2}:\d{2}/);
  await expect(page.locator(".list-source")).toHaveCount(0);
  await expect(page.locator(".list-cheap-hour")).toHaveCount(0);
  await expect(page.locator(".list-prices-as-of")).toHaveCount(0);
  await expect(page.locator(".list-meta")).toBeVisible();
  const metaLines = await page.locator(".list-meta").evaluate((el) => {
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
    return el.getBoundingClientRect().height / lineHeight;
  });
  expect(metaLines).toBeLessThanOrEqual(1.15);
});

test("station list keeps last updated when a later check found the same prices", async ({
  page,
}) => {
  await page.route("**/data/meta.json", async (route) => {
    const res = await route.fetch();
    const meta = (await res.json()) as {
      generatedAt?: string;
      checkedAt?: string;
      observedAt?: string;
    };
    await route.fulfill({
      json: {
        ...meta,
        generatedAt: "2026-09-15T07:46:15.859Z",
        checkedAt: "2026-09-15T13:17:00.000Z",
        observedAt: "2026-09-15T10:00:00+03:00",
      },
    });
  });
  await page.route("**/data/prices/*.json", async (route) => {
    const res = await route.fetch();
    const prices = (await res.json()) as { generatedAt?: string };
    await route.fulfill({ json: { ...prices, generatedAt: "2026-09-15T07:46:15.859Z" } });
  });
  await page.goto("/");
  await expect(page.locator(".list-updated")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".list-updated")).toContainText(/Atnaujinta/);
  await expect(page.locator(".list-updated")).toContainText("10:46");
  await expect(page.locator(".list-updated")).not.toContainText("16:17");
  await expect(page.locator(".list-prices-as-of")).toHaveCount(0);
});

test("settings include consumption, time value, and provider checkboxes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Nustatymai" }).click();
  await expect(page.getByRole("heading", { name: "Nustatymai" })).toBeVisible();
  await expect(page.getByText("Sąnaudos (l/100 km)")).toBeVisible();
  await expect(page.getByText("Laiko vertė (€/h)")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Tikslesnė vieta" })).toBeChecked();
  await expect(page.getByText("GPS nustato vietą tiksliau")).toBeVisible();
  await expect(page.getByRole("group", { name: "Tiekėjai" })).toBeVisible();
  const boxes = page.locator(".brand-filter input[type=checkbox]");
  await expect(boxes.first()).toBeChecked();
  expect(await boxes.count()).toBeGreaterThan(3);
  await expect(page.getByRole("group", { name: "Duomenų šaltiniai" })).toBeVisible();
  const sources = page.locator(".data-sources");
  await expect(
    sources.getByRole("link", { name: "LEA (Lietuvos energetikos agentūra)" }),
  ).toHaveAttribute("href", "https://degalukainos.ena.lt/");
  await expect(sources.getByRole("link", { name: "Circle K" })).toHaveAttribute(
    "href",
    "https://www.circlek.lt/privatiems/degalu-kainos",
  );
  await expect(sources.getByRole("link", { name: "OpenStreetMap" })).toHaveAttribute(
    "href",
    "https://www.openstreetmap.org/copyright",
  );
  await expect(sources.getByRole("link", { name: "Vartotojų pranešimai" })).toHaveAttribute(
    "href",
    "https://github.com/Almantask/Degalai-web/issues/new?template=wrong-price.yml",
  );
  await expect(page.getByText("Planuojama pripilti")).toHaveCount(0);
  await expect(page.getByText("Kelio koeficientas")).toHaveCount(0);
  await expect(page.getByText("Grįžtu į tą pačią vietą")).toHaveCount(0);
  await expect(page.getByText("Slėpti degalines")).toHaveCount(0);
  await expect(page.getByText("Užsukimo")).toHaveCount(0);
});

test("precise location setting persists and is sent to the geolocation API", async ({ page }) => {
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
    const calls: PositionOptions[] = [];
    (window as unknown as { __geoOpts: PositionOptions[] }).__geoOpts = calls;
    navigator.geolocation.getCurrentPosition = (ok, _err, opts) => {
      calls.push(opts ?? {});
      ok(pos as GeolocationPosition);
    };
  });

  await page.goto("/");
  await expect
    .poll(async () =>
      page.evaluate(() => (window as unknown as { __geoOpts: PositionOptions[] }).__geoOpts.length),
    )
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __geoOpts: PositionOptions[] }).__geoOpts[0].enableHighAccuracy,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "Nustatymai" }).click();
  const box = page.getByRole("checkbox", { name: "Tikslesnė vieta" });
  await expect(box).toBeChecked();
  await box.uncheck();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calls = (window as unknown as { __geoOpts: PositionOptions[] }).__geoOpts;
        return calls[calls.length - 1]?.enableHighAccuracy;
      }),
    )
    .toBe(false);

  await page.reload();
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const calls = (window as unknown as { __geoOpts: PositionOptions[] }).__geoOpts;
        return calls[0]?.enableHighAccuracy;
      }),
    )
    .toBe(false);
  await page.getByRole("button", { name: "Nustatymai" }).click();
  await expect(page.getByRole("checkbox", { name: "Tikslesnė vieta" })).not.toBeChecked();
});

test("provider checkboxes hide those stations from the list", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".station-row").first()).toBeVisible({ timeout: 15_000 });
  const before = await page.locator(".station-row").count();
  expect(before).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Nustatymai" }).click();
  const boxes = page.locator(".brand-filter input[type=checkbox]");
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).uncheck();
  await expect(page.locator(".station-row")).toHaveCount(0);
  await boxes.first().check();
  await expect(page.locator(".station-row").first()).toBeVisible();
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
  await expect(page.locator(".maplibregl-popup")).not.toContainText(/Tikrinta/);
  await expect(page.locator(".maplibregl-popup")).not.toContainText(/Atnaujinta/);
  const fuelLabels = await page
    .locator(".maplibregl-popup .popup-row > span:first-child")
    .allTextContents();
  expect(fuelLabels).not.toContain("98");
  await expect(page.locator(".list-updated")).toContainText(/Atnaujinta/);
  const addr = page.locator(".popup-addr");
  await expect(addr).toBeVisible();
  const fit = await page.evaluate(() => {
    const box = document.querySelector(".maplibregl-popup-content");
    const line = document.querySelector(".popup-addr");
    if (!box || !line) return false;
    const a = box.getBoundingClientRect();
    const b = line.getBoundingClientRect();
    return (
      b.left >= a.left - 1 &&
      b.right <= a.right + 1 &&
      b.top >= a.top - 1 &&
      b.bottom <= a.bottom + 1 &&
      a.right <= window.innerWidth + 1 &&
      a.bottom <= window.innerHeight + 1
    );
  });
  expect(fit).toBe(true);
});

type LonLat = [number, number];

function haversineM([lon1, lat1]: LonLat, [lon2, lat2]: LonLat): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** OSRM table answer for the request: straight-line metres, plus `penaltyM` per leg touching a stop. */
function osrmTable(url: string, penaltyM: (p: LonLat) => number = () => 0) {
  const u = new URL(url);
  const pts = u.pathname
    .split("/driving/")[1]
    .split(";")
    .map((c) => c.split(",").map(Number) as LonLat);
  const sources = u.searchParams.get("sources")!.split(";").map(Number);
  const destinations = u.searchParams.get("destinations")!.split(";").map(Number);
  const distances = sources.map((i) =>
    destinations.map((j) => haversineM(pts[i], pts[j]) + penaltyM(pts[i]) + penaltyM(pts[j])),
  );
  return { code: "Ok", distances, durations: distances.map((row) => row.map((m) => m / 15)) };
}

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
  let tables = 0;
  await page.route("https://router.project-osrm.org/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/table/")) {
      tables += 1;
      await route.fulfill({ json: osrmTable(url) });
      return;
    }
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
  expect(tables).toBeGreaterThan(0);
  await expect(page.locator(".station-row.is-detour")).toHaveCount(0);
  await expect(page.locator(".station-row.is-on-route")).toHaveCount(routeStations);
  const mapCount = Number(await page.locator("#map").getAttribute("data-station-count"));
  expect(mapCount).toBe(Math.min(5, routeStations));
  expect(viaRoutes).toBe(mapCount);
  await expect(page.getByText(/max\. greičiu|at max speed/)).toHaveCount(0);
  const metas = await page.locator(".station-eta").allTextContents();
  expect(metas.length).toBe(routeStations);
  for (const text of metas) {
    expect(text).toContain("km");
    expect(text).not.toMatch(/max\. greičiu|at max speed|\bmin\b|val\./);
  }
  await page.getByRole("button", { name: /Išskleisti sąrašą/ }).click();
  await expect(page.locator(".list-body")).toBeVisible();
  if (routeStations > 5) {
    await page.locator(".station-row").last().click();
    await expect.poll(() => viaRoutes).toBe(mapCount + 1);
    await expect(page.locator("#map")).toHaveAttribute("data-station-count", String(mapCount + 1));
    await page.getByRole("button", { name: /Išskleisti sąrašą/ }).click();
    await expect(page.locator(".list-body")).toBeVisible();
  }
  await page.locator(".station-row").first().click();
  await expect(page.locator("#header")).toHaveClass(/is-min/);
  await expect(page.locator(".sheet")).toHaveClass(/is-min/);
  await expect(page.locator(".list-body")).toBeHidden();
  await expect(page.locator(".maplibregl-popup")).toBeVisible();
});

test("on the way means a short road detour, not closeness to the route line", async ({ page }) => {
  // Vienybės a. → Pramonės pr. 3, Kaunas. The fastest route crosses Žaliakalnis 400 m from
  // Circle K on K. Baršausko g., which is down the hill and across the road. Neste on Tunelio g.
  // is 800 m from that line but on the riverside road home.
  await page.addInitScript(() => {
    const pos = {
      coords: {
        latitude: 54.8987,
        longitude: 23.9118,
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
    const reverse = route.request().url().includes("/reverse");
    await route.fulfill({
      json: {
        features: [
          reverse
            ? { geometry: { coordinates: [23.9118, 54.8987] }, properties: { name: "Vienybės a." } }
            : {
                geometry: { coordinates: [23.9764, 54.9045] },
                properties: { street: "Pramonės pr.", housenumber: "3", city: "Kaunas" },
              },
        ],
      },
    });
  });
  const circleK: LonLat = [23.9599257, 54.8990483];
  const tableUrls: string[] = [];
  await page.route("https://router.project-osrm.org/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/table/")) {
      tableUrls.push(url);
      // Pumps on the far side: a turnaround to get in and another to get out.
      const turnaround = (p: LonLat) => (haversineM(p, circleK) < 1 ? 1500 : 0);
      await route.fulfill({ json: osrmTable(url, turnaround) });
      return;
    }
    await route.fulfill({
      json: {
        code: "Ok",
        routes: [
          {
            distance: 5500,
            duration: 660,
            geometry: {
              coordinates: [
                [23.9118, 54.8987],
                [23.93, 54.901],
                [23.95, 54.9025],
                [23.965, 54.9025],
                [23.9764, 54.9045],
              ],
            },
          },
        ],
      },
    });
  });
  await page.goto("/");
  const dest = page.getByPlaceholder("Kur važiuojate?");
  await dest.fill("Pramonės pr. 3");
  await dest.press("Enter");
  await expect(page.locator(".app")).toHaveClass(/has-route/, { timeout: 15_000 });
  const neste = page.locator(".station-row", { hasText: "Neste „Tunelio“" });
  await expect(neste).toHaveCount(1);
  await expect(neste.locator(".station-eta")).toContainText("nusukimas +");
  await expect(page.locator(".station-row", { hasText: "Circle K „Baršausko“" })).toHaveCount(0);
  expect(new URL(tableUrls[0]).searchParams.get("approaches")).toContain("curb");
});

test.describe("EV", () => {
  // The PWA service worker would answer data requests before page.route sees them.
  test.use({ serviceWorkers: "block" });

  test("EV chip loads chargers only when picked and lists them", async ({ page }) => {
    const chargerUrls: string[] = [];
    await page.route("**/data/chargers.json", async (route) => {
      chargerUrls.push(route.request().url());
      await route.fulfill({
        json: [
          {
            id: "ev:node:1",
            name: "Test charger",
            brand: "ignitis-on",
            lat: 54.687,
            lon: 25.28,
            fuels: ["EV"],
            ev: { sockets: ["type2_combo"], maxKw: 150, network: "Ignitis ON" },
          },
        ],
      });
    });
    await page.goto("/en/");
    await expect(page.getByRole("button", { name: "EV", exact: true })).toBeVisible();
    expect(chargerUrls).toEqual([]);
    await page.getByRole("button", { name: "EV", exact: true }).click();
    await expect(page).toHaveURL(/[?&]fuel=ev/);
    await expect.poll(() => chargerUrls.length).toBe(1);
    await expect(page.locator(".list-head h2")).toContainText("Chargers");
    await expect(page.locator(".station-row.is-unpriced")).toContainText("Test charger");
  });

  test("a free charger explains why behind a ?", async ({ page }) => {
    await page.route("**/data/chargers.json", (route) =>
      route.fulfill({
        json: [
          {
            id: "vl:STR-1",
            name: "Elektrinės g. 21, Elektrėnai",
            brand: "independent",
            lat: 54.687,
            lon: 25.28,
            address: "Elektrinės g. 21, Elektrėnai",
            fuels: ["EV"],
            sourceIds: { "via-lietuva": "STR-1" },
            ev: {
              sockets: ["type2"],
              maxKw: 22,
              network: "Stuart Energy",
              registerPrice: 0,
              prices: { ac: 0 },
              free: { reason: "powerPlant", owner: "Ignitis gamyba" },
            },
          },
        ],
      }),
    );
    await page.route("**/data/prices/*.json", async (route) => {
      const daily = (await (await route.fetch()).json()) as { prices: Record<string, unknown> };
      daily.prices["vl:STR-1"] = {
        EV: { price: 0, source: "via-lietuva", observedAt: "2026-10-06T12:00:00Z" },
      };
      await route.fulfill({ json: daily });
    });
    await page.goto("/en/?fuel=ev");
    const row = page.locator(".station-row", { hasText: "Elektrinės g. 21" });
    await expect(row.locator(".station-price")).toContainText("Free");
    await expect(row.locator(".free-why-mark")).toHaveAttribute("title", /Ignitis gamyba/);
    await row.click();
    const why = page.locator(".maplibregl-popup .free-why-btn");
    const tip = page.locator(".maplibregl-popup .free-why-tip");
    await expect(why).toBeVisible();
    await expect(why).toHaveAttribute("title", /Ignitis gamyba power plant/);
    await expect(tip).toBeHidden();
    await why.click();
    await expect(why).toHaveAttribute("aria-expanded", "true");
    await expect(tip).toBeVisible();
    await expect(tip).toContainText("On the grounds of a Ignitis gamyba power plant");
  });

  test("EV settings list charging networks and EV data sources only", async ({ page }) => {
    const charger = (id: string, brand: string, network: string, lat: number) => ({
      id,
      name: id,
      brand,
      lat,
      lon: 25.28,
      fuels: ["EV"],
      ev: { sockets: ["type2"], network },
    });
    await page.route("**/data/chargers.json", (route) =>
      route.fulfill({
        json: [
          charger("vl:A", "in-balance-grid", "Inbalance grid", 54.687),
          charger("vl:B", "eldrive-lithuania", "Eldrive Lithuania", 54.688),
          charger("vl:C", "independent", "Hotel Charger", 54.689),
        ],
      }),
    );
    await page.goto("/en/?fuel=ev");
    await expect(page.locator(".station-row")).toHaveCount(3);
    await page.getByRole("button", { name: "Settings" }).click();
    const networks = page.getByRole("group", { name: "Charging networks" });
    await expect(networks.getByRole("checkbox")).toHaveCount(3);
    await expect(networks.getByRole("checkbox", { name: "Inbalance grid" })).toBeChecked();
    await expect(networks.getByRole("checkbox", { name: "Eldrive Lithuania" })).toBeChecked();
    await expect(networks.getByRole("checkbox", { name: "Other" })).toBeChecked();
    const sources = page.getByRole("group", { name: "Data sources" });
    await expect(sources.getByRole("link")).toHaveText([
      "Via Lietuva charge point register (CC BY 4.0)",
      "OpenStreetMap",
      "Nord Pool power exchange (Elering)",
    ]);

    await networks.getByRole("checkbox", { name: "Other" }).uncheck();
    await expect(page.locator(".station-row")).toHaveCount(2);

    // Unticking "Other" for chargers leaves independent fuel stations alone.
    await page.getByRole("button", { name: "Diesel", exact: true }).click();
    const providers = page.getByRole("group", { name: "Providers" });
    await expect(providers.getByRole("checkbox", { name: "Other" })).toBeChecked();
    await expect(page.getByRole("group", { name: "Data sources" }).getByRole("link")).toHaveText([
      "LEA (Lithuanian Energy Agency)",
      "Circle K",
      "OpenStreetMap",
      "User reports",
    ]);
  });

  test("EV history has stat tabs by network, and the spot price under its own tab", async ({
    page,
  }) => {
    const now = Date.now();
    const hours = Array.from({ length: 30 }, (_, i) => new Date(now + (i - 20) * 3_600_000));
    const vilnius = (d: Date, opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vilnius", ...opts }).format(d);
    const dates = hours.map((d) =>
      vilnius(d, { year: "numeric", month: "2-digit", day: "2-digit" }),
    );
    const hourOf = hours.map((d) => Number(vilnius(d, { hour: "2-digit", hourCycle: "h23" })));
    const networks = { "ignitis-on": [0.39, 0.37], "inbalance-grid": [0.29, 0.28] };
    await page.route("**/data/history.json", (route) =>
      route.fulfill({
        json: {
          generatedAt: new Date(now).toISOString(),
          keepDays: 7,
          byFuel: {
            EV: {
              dates: dates.slice(0, 2),
              hours: hourOf.slice(0, 2),
              brands: networks,
              stats: {
                avg: networks,
                min: { "ignitis-on": [0.29, 0.27], "inbalance-grid": [0.18, 0.18] },
                max: networks,
                median: networks,
              },
            },
          },
          spot: {
            dates,
            hours: hourOf,
            brands: { spot: hours.map((_, i) => (i === 25 ? 0.01 : 0.1 + (i % 5) / 100)) },
          },
        },
      }),
    );
    await page.goto("/en/history?fuel=ev");
    await expect(page.locator("#history-chart .uplot")).toBeVisible({ timeout: 15_000 });
    const stat = page.locator(".history-stat");
    await expect(stat.locator("[data-act='history-stat']")).toHaveCount(4);
    await expect(page.locator("#history-legend [data-act='history-brand']")).toHaveCount(2);
    await expect(page.locator("#history-legend")).toContainText("Ignitis ON");
    await expect(page.locator("#history-legend")).toContainText("Inbalance Grid");
    await expect(page.locator(".history-caption")).toContainText("Free chargers are left out");

    await stat.getByRole("button", { name: "Min" }).click();
    await expect(stat.getByRole("button", { name: "Min" })).toHaveAttribute("aria-pressed", "true");

    await stat.getByRole("button", { name: "Spot" }).click();
    await expect(stat.getByRole("button", { name: "Spot" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(stat.getByRole("button", { name: "Min" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.locator("#history-legend [data-act='history-brand']")).toHaveCount(0);
    await expect(page.locator(".history-cheap")).toContainText("Cheapest power");
    await expect(page.locator(".history-caption").last()).toContainText("excluding VAT");
  });
});

test.describe("route fields", () => {
  test.use({ serviceWorkers: "block" });

  test("swap start and destination, and clear with the browser's own ✕", async ({ page }) => {
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
      const reverse = route.request().url().includes("/reverse");
      await route.fulfill({
        json: {
          features: [
            reverse
              ? { geometry: { coordinates: [25.28, 54.687] }, properties: { name: "Vilnius" } }
              : { geometry: { coordinates: [23.9, 54.9] }, properties: { name: "Kaunas" } },
          ],
        },
      });
    });
    await page.route("https://router.project-osrm.org/**", (route) =>
      route.fulfill({
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
      }),
    );
    await page.goto("/");
    const swap = page.getByRole("button", { name: "Sukeisti pradžią ir tikslą" });
    await expect(swap).toBeDisabled();
    for (const clear of await page.locator(".dest-clear").all()) await expect(clear).toBeHidden();

    const dest = page.locator("#dest");
    await dest.fill("Kaunas");
    await dest.press("Enter");
    await expect(page.locator(".app")).toHaveClass(/has-route/, { timeout: 15_000 });
    await expect(page.locator(".dest-clear")).toBeHidden();

    await page.locator(".header-toggle").click();
    await swap.click();
    await expect(page.locator("#start")).toHaveValue(/Kaunas/);
    await expect(page.locator("#dest")).toHaveValue("Mano vieta");
    await expect(page.locator(".app")).toHaveClass(/has-route/);

    await page.locator(".header-toggle").click();
    await swap.click();
    await expect(page.locator("#dest")).toHaveValue(/Kaunas/);
    await expect(page.locator("#start")).not.toHaveValue(/Kaunas/);

    // What the native ✕ does: empty the field, fire `input`, then a non-bubbling `search`.
    await page.locator(".header-toggle").click();
    await dest.evaluate((el: HTMLInputElement) => {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("search"));
    });
    await expect(page.locator(".app")).not.toHaveClass(/has-route/);
    await expect(dest).toHaveValue("");
  });
});
