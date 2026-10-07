import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Dependency tests (`npm run test:deps`): everything the site, the data pipeline and the cron
 * worker need to call their dependencies is there. `wiring` is offline; the rest call the services.
 */
export default defineConfig({
  resolve: {
    alias: { "@": resolve("src") },
  },
  test: {
    environment: "node",
    include: ["tests/deps/**/*.test.ts"],
    globals: true,
    testTimeout: 60_000,
    // One retry absorbs a dropped connection; a service that fails twice is down.
    retry: 1,
  },
});
