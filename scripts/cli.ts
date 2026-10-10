import { pathToFileURL } from "node:url";

/** True when Node was started with this module as the program. */
export function isCliEntry(moduleUrl: string, scriptPath: string | undefined): boolean {
  if (!scriptPath) return false;
  return moduleUrl === pathToFileURL(scriptPath).href;
}

/** Runs `task` for a direct invocation and exits 1 when it rejects. */
export function runCli(entry: boolean, task: () => unknown): void {
  if (!entry) return;
  Promise.resolve(task()).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
