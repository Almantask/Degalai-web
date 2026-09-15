import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installOffer, isIosSafari, isStandalone } from "../src/pwa.ts";

describe("isStandalone", () => {
  it("detects display-mode media queries and iOS navigator.standalone", () => {
    expect(isStandalone((q) => q.includes("standalone"))).toBe(true);
    expect(isStandalone(() => false, true)).toBe(true);
    expect(isStandalone(() => false, false)).toBe(false);
  });
});

describe("isIosSafari", () => {
  it("accepts iPhone Safari and rejects Chrome on iOS", () => {
    expect(
      isIosSafari(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(true);
    expect(
      isIosSafari(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
    expect(isIosSafari("Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0")).toBe(false);
    expect(
      isIosSafari(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
        {
          platform: "MacIntel",
          maxTouchPoints: 5,
        },
      ),
    ).toBe(true);
  });
});

describe("installOffer", () => {
  it("hides when already installed or dismissed", () => {
    expect(
      installOffer({ standalone: true, dismissed: false, canPrompt: true, iosSafari: true }),
    ).toBe("hidden");
    expect(
      installOffer({ standalone: false, dismissed: true, canPrompt: true, iosSafari: true }),
    ).toBe("hidden");
  });

  it("prefers the Chromium install prompt, then iOS instructions", () => {
    expect(
      installOffer({ standalone: false, dismissed: false, canPrompt: true, iosSafari: true }),
    ).toBe("prompt");
    expect(
      installOffer({ standalone: false, dismissed: false, canPrompt: false, iosSafari: true }),
    ).toBe("ios");
    expect(
      installOffer({ standalone: false, dismissed: false, canPrompt: false, iosSafari: false }),
    ).toBe("hidden");
  });
});

describe("web manifests", () => {
  const dir = join(import.meta.dirname, "..", "public");

  it("are standalone apps with PNG icons Chromium can install", () => {
    for (const file of ["manifest-lt.webmanifest", "manifest-en.webmanifest"]) {
      const manifest = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
        display: string;
        start_url: string;
        icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
      };
      expect(manifest.display).toBe("standalone");
      expect(manifest.icons.some((i) => i.sizes === "192x192" && i.type === "image/png")).toBe(
        true,
      );
      expect(manifest.icons.some((i) => i.sizes === "512x512" && i.type === "image/png")).toBe(
        true,
      );
      expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
      expect(manifest.start_url.startsWith("./")).toBe(true);
    }
  });
});
