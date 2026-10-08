import { configDefaults, defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": resolve("src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Dependency tests call outside services; they run with `npm run test:deps`.
    exclude: [...configDefaults.exclude, "tests/deps/**"],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage/unit",
      include: ["src/**/*.ts", "scripts/**/*.ts", "worker/src/**/*.ts"],
      exclude: ["**/*.d.ts"],
    },
  },
});
