import { describe, expect, it } from "vitest";
import { injectWebAnalytics, webAnalyticsTag } from "../src/web-analytics.ts";

const TOKEN = "a".repeat(32);
const PAGE = `<!doctype html>
<html>
  <body>
    <div id="app"></div>
  </body>
</html>
`;

describe("webAnalyticsTag", () => {
  it("is omitted when the token is unset", () => {
    expect(webAnalyticsTag(undefined)).toBe("");
    expect(webAnalyticsTag("")).toBe("");
    expect(webAnalyticsTag("   ")).toBe("");
  });

  it("embeds the dashboard snippet", () => {
    expect(webAnalyticsTag(TOKEN)).toBe(
      `<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${TOKEN}"}'></script>`,
    );
  });

  it("rejects a token that could break out of the attribute", () => {
    expect(() => webAnalyticsTag(`${TOKEN}'`)).toThrow(/site token/);
    expect(() => webAnalyticsTag("<script>")).toThrow(/site token/);
    expect(() => webAnalyticsTag("short")).toThrow(/site token/);
  });
});

describe("injectWebAnalytics", () => {
  it("leaves the page alone without a token", () => {
    expect(injectWebAnalytics(PAGE, undefined)).toBe(PAGE);
  });

  it("places the beacon before the closing body tag", () => {
    const out = injectWebAnalytics(PAGE, TOKEN);
    expect(out).toContain(`data-cf-beacon='{"token":"${TOKEN}"}'`);
    expect(out.indexOf("beacon.min.js")).toBeLessThan(out.indexOf("</body>"));
    expect(out).toContain('<div id="app"></div>');
  });
});
