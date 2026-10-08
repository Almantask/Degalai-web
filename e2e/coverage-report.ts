import { writeE2eCoverageSummary } from "../scripts/e2e-coverage.ts";

export default function globalTeardown(): void {
  writeE2eCoverageSummary();
}
