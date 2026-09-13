import { describe, expect, it } from "vitest";
import { escapeHtml } from "../src/format.ts";

describe("escapeHtml", () => {
  it("encodes markup and quotes", () => {
    expect(escapeHtml(`<img src=x onerror="alert('xss')">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;",
    );
  });
});
