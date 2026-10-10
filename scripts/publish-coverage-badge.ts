import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isCliEntry, runCli } from "./cli.ts";
import { coverageBadge, linePercent } from "./coverage-badge.ts";

export function publishCoverageBadge(kind: string): void {
  mkdirSync("coverage", { recursive: true });
  if (kind === "unit") {
    // Paths are literals. The argument only selects a branch, so it cannot name a file.
    const badge = coverageBadge(
      linePercent(JSON.parse(readFileSync("coverage/unit/coverage-summary.json", "utf8"))),
      "unit coverage",
    );
    writeFileSync("coverage/unit.json", `${JSON.stringify(badge)}\n`);
    console.log(`unit coverage: ${badge.message}`);
  } else if (kind === "e2e") {
    const badge = coverageBadge(
      linePercent(JSON.parse(readFileSync("coverage/e2e/coverage-summary.json", "utf8"))),
      "e2e coverage",
    );
    writeFileSync("coverage/e2e.json", `${JSON.stringify(badge)}\n`);
    console.log(`e2e coverage: ${badge.message}`);
  } else {
    console.error("usage: publish-coverage-badge.ts unit|e2e");
    process.exit(1);
  }
}

/** Publishes the badge selected by `argv[2]` (`unit` or `e2e`). */
export function publishArgvBadge(kind = process.argv[2] ?? ""): void {
  publishCoverageBadge(kind);
}

runCli(isCliEntry(import.meta.url, process.argv[1]), publishArgvBadge);
