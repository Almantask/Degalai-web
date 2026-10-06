import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  formatChartDate,
  formatDateTime,
  formatPrice,
  formatPriceNumber,
  shortAddress,
} from "../src/format.ts";
import { setLocale } from "../src/i18n/index.ts";

describe("escapeHtml", () => {
  it("encodes markup and quotes", () => {
    expect(escapeHtml(`<img src=x onerror="alert('xss')">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;",
    );
  });
});

describe("shortAddress", () => {
  it("abbreviates street types and drops postal codes", () => {
    expect(shortAddress("Jono gatvė 10, Vilnius, 01100")).toBe("Jono g. 10, Vilnius");
    expect(shortAddress("Karaliaus Mindaugo prospektas 34A")).toBe("Karaliaus Mindaugo pr. 34A");
  });

  it("leaves already-short addresses alone", () => {
    expect(shortAddress("Oslo g. 12, Vilnius")).toBe("Oslo g. 12, Vilnius");
  });
});

describe("formatDateTime", () => {
  it("formats last-updated timestamps in Lithuania time", () => {
    setLocale("en");
    expect(formatDateTime("2026-09-12T19:09:22.245Z")).toMatch(/12 Sept 2026.*22:09/);
    setLocale("lt");
    expect(formatDateTime("2026-09-12T19:09:22.245Z")).toContain("22:09");
  });
});

describe("formatChartDate", () => {
  it("formats a calendar day without shifting the date", () => {
    setLocale("en");
    expect(formatChartDate("2026-09-15")).toMatch(/15/);
    setLocale("lt");
    expect(formatChartDate("2026-09-15")).toMatch(/15/);
  });
});

describe("formatPrice", () => {
  it("uses €/l for pump fuels and €/kWh for EV", () => {
    setLocale("en");
    expect(formatPrice(1.599, "D")).toBe("€1.599/l");
    expect(formatPrice(0.29, "EV")).toBe("€0.290/kWh");
    expect(formatPrice(0, "EV")).toBe("Free");
    setLocale("lt");
    expect(formatPrice(0.29, "EV")).toBe("0,290 €/kWh");
    expect(formatPriceNumber(1.5)).toBe("1,500");
  });
});
