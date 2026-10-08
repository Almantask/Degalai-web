/** Cloudflare Web Analytics beacon. GitHub Pages reports to cloudflareinsights.com. */
export const CF_BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

/**
 * The dashboard snippet, or "" when no site token is set.
 * The beacon measures same-document route changes itself (Navigation API, otherwise
 * `pushState` and `popstate`). It stores the path without the query string.
 */
export function webAnalyticsTag(token: string | undefined): string {
  const siteToken = token?.trim() ?? "";
  if (!siteToken) return "";
  // The token is interpolated into a single-quoted attribute. Anything else is rejected
  // so a bad secret fails the build instead of breaking the page.
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(siteToken)) {
    throw new Error("VITE_CF_BEACON_TOKEN is not a Cloudflare Web Analytics site token");
  }
  const beacon = JSON.stringify({ token: siteToken });
  return `<script type="module" src="${CF_BEACON_SRC}" data-cf-beacon='${beacon}'></script>`;
}

/** Inserts the beacon before `</body>`. Leaves the page unchanged when no token is set. */
export function injectWebAnalytics(html: string, token: string | undefined): string {
  const tag = webAnalyticsTag(token);
  if (!tag) return html;
  const line = `    ${tag}`;
  if (html.includes("</body>")) return html.replace("</body>", `${line}\n  </body>`);
  return `${html}\n${line}\n`;
}
