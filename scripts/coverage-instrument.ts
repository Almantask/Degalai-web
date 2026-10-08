import { relative, resolve } from "node:path";
import { createInstrumenter } from "istanbul-lib-instrument";
import type { Plugin } from "vite";

const SRC = resolve("src");

const instrumenter = createInstrumenter({
  esModules: true,
  compact: true,
  produceSourceMap: false,
  coverageVariable: "__coverage__",
  // `globalThis`, not `this`: a module's top-level `this` is undefined.
  coverageGlobalScope: "globalThis",
  coverageGlobalScopeFunc: false,
});

/**
 * A runtime file of the site (`src/`), not `worker/src` or anything under
 * `node_modules`. Paths are compared to this checkout's `src` directory.
 */
export function isAppSource(filePath: string): boolean {
  const rel = relative(SRC, filePath.split("?")[0]);
  return (
    rel !== "" &&
    !rel.startsWith("..") &&
    !rel.includes("node_modules") &&
    !rel.endsWith(".d.ts") &&
    /\.tsx?$/.test(rel)
  );
}

/** Absolute `src` TypeScript file to instrument, without a Vite query. */
export function instrumentPath(id: string): string | undefined {
  const file = id.split("?")[0];
  if (!isAppSource(file)) return undefined;
  return file;
}

/** Instruments one already-transpiled module. Same options as the Vite plugin. */
export function instrumentSource(code: string, filename: string): string {
  return instrumenter.instrumentSync(code, filename);
}

/**
 * Istanbul counters for the Playwright build only (`VITE_COVERAGE=1`).
 * The hourly deploy does not set that, so the counters never ship.
 */
export function coverageInstrumentPlugin(): Plugin {
  return {
    name: "e2e-coverage",
    apply: "build",
    enforce: "post",
    transform(code, id) {
      const file = instrumentPath(id);
      if (!file) return null;
      return { code: instrumentSource(code, file) };
    },
  };
}
