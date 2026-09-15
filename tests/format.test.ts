import { describe, expect, it } from "vitest";
import { escapeHtml, formatDateTime, shortAddress } from "../src/format.ts";
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
