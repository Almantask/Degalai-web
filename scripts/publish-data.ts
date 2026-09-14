/** Relative paths from `data/`, with or without a leading slash. */
export function includePublishedDataFile(rel: string, latestPrice: string): boolean {
  const normalized =
    `/${rel.replaceAll("\\", "/")}`.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  if (normalized === "/" || normalized === "/.") return true;
  if (normalized.includes("/cache") || normalized.includes("/downloads")) return false;
  if (normalized === "/prices" || normalized.startsWith("/prices/")) {
    if (!latestPrice) return normalized === "/prices";
    return normalized === "/prices" || normalized === `/prices/${latestPrice}.json`;
  }
  return true;
}
