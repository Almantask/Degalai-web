import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

export const ROOT = join(import.meta.dirname, "..", "..");

/** A repository file as text; `path` is relative to the repository root. */
export function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/** Every file under `dir` (recursively) whose name ends in `ext`, keyed by repo-relative path. */
export function readAll(dir: string, ext: string): Map<string, string> {
  const files = readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" });
  return new Map(
    files
      .filter((f) => f.endsWith(ext))
      .sort()
      .map((f) => [`${dir}/${f}`, read(`${dir}/${f}`)]),
  );
}

export function workflow(name: string): string {
  return read(`.github/workflows/${name}`);
}

export interface WranglerConfig {
  name?: string;
  workers_dev?: boolean;
  vars?: Record<string, string>;
  triggers?: { crons?: string[] };
  ratelimits?: Array<{ name: string; namespace_id: string }>;
  kv_namespaces?: Array<{ binding: string; id: string }>;
}

/** `worker/wrangler.jsonc`, which allows comments and trailing commas. */
export function wrangler(): WranglerConfig {
  const { config, error } = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    read("worker/wrangler.jsonc"),
  );
  if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
  return config as WranglerConfig;
}

/** A `vars` entry of the cron worker; throws when it is not set. */
export function workerVar(name: string): string {
  const value = wrangler().vars?.[name];
  if (!value) throw new Error(`worker/wrangler.jsonc sets no ${name}`);
  return value;
}

/** Origins the worker takes reports from (`REPORT_ORIGINS`). */
export function reportOrigins(): string[] {
  return workerVar("REPORT_ORIGINS")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Worker secrets the deploy sets: `wrangler secret put` scripts that worker.yml runs. */
export function workerSecrets(): string[] {
  const { scripts } = JSON.parse(read("worker/package.json")) as {
    scripts: Record<string, string>;
  };
  const deploy = workflow("worker.yml");
  return Object.entries(scripts).flatMap(([name, command]) => {
    const secret = command.match(/wrangler secret put ([A-Z][A-Z0-9_]*)/)?.[1];
    const runs = new RegExp(`npm run (?:--silent )?${escapeRegExp(name)}(?![\\w:-])`).test(deploy);
    return secret && runs ? [secret] : [];
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
