/** Shields.io endpoint badge. CI uploads this JSON; the README URL stays the same. */
export interface CoverageBadge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: "brightgreen" | "green" | "yellow" | "orange" | "red";
  cacheSeconds: number;
}

/** Line percentage from an Istanbul / Vitest `coverage-summary.json`. */
export function linePercent(summary: unknown): number {
  if (!summary || typeof summary !== "object") throw new Error("coverage summary is not an object");
  const pct = (summary as { total?: { lines?: { pct?: unknown } } }).total?.lines?.pct;
  if (typeof pct !== "number" || !Number.isFinite(pct)) {
    throw new Error("coverage summary has no line percentage");
  }
  return pct;
}

/**
 * Colour follows the rounded percentage the badge shows, so 79.96% is green
 * (it reads 80%) and 49.94% is red (it reads 49.9%).
 */
export function coverageBadge(pct: number, label: string): CoverageBadge {
  const shown = Math.round(pct * 10) / 10;
  return {
    schemaVersion: 1,
    label,
    message: Number.isInteger(shown) ? `${shown}%` : `${shown.toFixed(1)}%`,
    color: colorFor(shown),
    cacheSeconds: 300,
  };
}

function colorFor(pct: number): CoverageBadge["color"] {
  if (pct >= 90) return "brightgreen";
  if (pct >= 80) return "green";
  if (pct >= 70) return "yellow";
  if (pct >= 50) return "orange";
  return "red";
}
