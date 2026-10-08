import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coverageBadge, linePercent } from "./coverage-badge.ts";

const kind = process.argv[2];
if (kind !== "unit" && kind !== "e2e") {
  console.error("usage: publish-coverage-badge.ts unit|e2e");
  process.exit(1);
}

const summary = JSON.parse(readFileSync(join("coverage", kind, "coverage-summary.json"), "utf8"));
const label = kind === "unit" ? "unit coverage" : "e2e coverage";
const badge = coverageBadge(linePercent(summary), label);
mkdirSync("coverage", { recursive: true });
const out = join("coverage", `${kind}.json`);
writeFileSync(out, `${JSON.stringify(badge)}\n`);
console.log(`${label}: ${badge.message}`);
