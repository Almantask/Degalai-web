import type { Page } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  launch: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("@playwright/test", () => ({
  chromium: { launch: () => h.launch() },
}));

vi.mock("node:fs", () => ({
  mkdirSync: (...args: unknown[]) => h.mkdirSync(...args),
}));

interface FakePage {
  calls: string[];
}

function makePage(visible: { search: boolean; list: boolean }): FakePage & Record<string, unknown> {
  const calls: string[] = [];
  return {
    calls,
    goto: async (url: string) => {
      calls.push(`goto ${url}`);
    },
    waitForTimeout: async (ms: number) => {
      calls.push(`wait ${ms}`);
    },
    waitForFunction: async (fn: () => unknown) => {
      calls.push("waitFn");
      const g = globalThis as {
        document?: {
          querySelector: (sel: string) => { classList: { contains: () => boolean } } | null;
        };
      };
      const had = Object.prototype.hasOwnProperty.call(g, "document");
      const previous = g.document;
      g.document = {
        querySelector: () => ({ classList: { contains: () => true } }),
      };
      try {
        fn();
        g.document = { querySelector: () => null };
        fn();
      } finally {
        if (had) g.document = previous;
        else delete g.document;
      }
    },
    screenshot: async (opts: { path: string }) => {
      calls.push(`shot ${opts.path}`);
    },
    locator(sel: string) {
      return {
        waitFor: async () => {
          calls.push(`waitFor ${sel}`);
        },
        click: async () => {
          calls.push(`click ${sel}`);
        },
        first: () => ({
          waitFor: async () => {
            calls.push(`first ${sel}`);
          },
        }),
      };
    },
    getByPlaceholder(text: string) {
      return {
        click: async () => {
          calls.push(`ph ${text}`);
        },
        fill: async (value: string) => {
          calls.push(`fill ${value}`);
        },
        press: async (key: string) => {
          calls.push(`press ${key}`);
        },
      };
    },
    getByRole(_role: string, opts: { name: string | RegExp }) {
      const name = String(opts.name);
      return {
        click: async () => {
          calls.push(`role ${name}`);
        },
        isVisible: async () => {
          if (name.includes("Expand search")) return visible.search;
          if (name.includes("Expand list")) return visible.list;
          return true;
        },
      };
    },
  };
}

function installBrowser(visible: { search: boolean; list: boolean }) {
  const contexts: Array<{ viewport?: { width: number } }> = [];
  const pages: Array<FakePage & Record<string, unknown>> = [];
  h.launch.mockResolvedValue({
    newContext: async (opts: { viewport?: { width: number } }) => {
      contexts.push(opts);
      return {
        newPage: async () => {
          const page = makePage(visible);
          pages.push(page);
          return page;
        },
        close: async () => {},
      };
    },
    close: async () => {},
  });
  return { contexts, pages };
}

async function load(base?: string) {
  vi.resetModules();
  if (base === undefined) delete process.env.SCREENSHOT_BASE_URL;
  else process.env.SCREENSHOT_BASE_URL = base;
  return import("../scripts/capture-screenshots.ts");
}

afterEach(() => {
  delete process.env.SCREENSHOT_BASE_URL;
  h.launch.mockReset();
  h.mkdirSync.mockReset();
});

describe("waitForStations", () => {
  it("waits for the map and the first station row", async () => {
    const { waitForStations } = await load();
    const page = makePage({ search: false, list: false });
    await waitForStations(page as unknown as Page);
    expect(page.calls).toEqual([
      "waitFor #map .maplibregl-canvas",
      "first .station-row",
      "wait 2500",
    ]);
  });
});

describe("locateInVilnius", () => {
  it("clicks the geolocate control", async () => {
    const { locateInVilnius } = await load();
    const page = makePage({ search: false, list: false });
    await locateInVilnius(page as unknown as Page);
    expect(page.calls).toEqual(["click .maplibregl-ctrl-geolocate", "wait 2500"]);
  });
});

describe("zoomBy", () => {
  it("clicks the control once per step", async () => {
    const { zoomBy } = await load();
    const page = makePage({ search: false, list: false });
    await zoomBy(page as unknown as Page, ".maplibregl-ctrl-zoom-out", 2);
    expect(page.calls).toEqual([
      "click .maplibregl-ctrl-zoom-out",
      "wait 350",
      "click .maplibregl-ctrl-zoom-out",
      "wait 350",
      "wait 1800",
    ]);
  });
});

describe("main", () => {
  it("expands search and uses the default base url", async () => {
    const browser = installBrowser({ search: true, list: false });
    const { main } = await load();
    await main();
    expect(h.mkdirSync).toHaveBeenCalledWith("docs/screenshots", { recursive: true });
    expect(browser.contexts.map((ctx) => ctx.viewport?.width)).toEqual([1440, 390]);
    expect(browser.pages[0].calls).toContain("goto http://127.0.0.1:4173/en/");
    expect(browser.pages[0].calls).toContain("role /Expand search/");
    expect(browser.pages[0].calls.some((call) => call.includes("Expand list"))).toBe(false);
    expect(browser.pages[0].calls).toContain("shot docs/screenshots/route.png");
    expect(browser.pages[1].calls).toContain("shot docs/screenshots/mobile.png");
  });

  it("expands the list and uses SCREENSHOT_BASE_URL", async () => {
    const browser = installBrowser({ search: false, list: true });
    const { main } = await load("http://shots.test");
    await main();
    expect(browser.pages[0].calls).toContain("goto http://shots.test/en/");
    expect(browser.pages[0].calls).toContain("role /Expand list/");
    expect(browser.pages[0].calls.some((call) => call.includes("Expand search"))).toBe(false);
  });
});
