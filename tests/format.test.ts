import { describe, expect, it } from "vitest";
import { escapeHtml, formatDateTime } from "../src/format.ts";
import { setLocale } from "../src/i18n/index.ts";

describe("escapeHtml", () => {
  it("encodes markup and quotes", () => {
    expect(escapeHtml(`<img src=x onerror="alert('xss')">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;",
    );
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
