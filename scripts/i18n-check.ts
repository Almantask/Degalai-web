import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isCliEntry, runCli } from "./cli.ts";

export interface CatalogDiff {
  keyCount: number;
  missingInEn: string[];
  missingInLt: string[];
}

/** Keys present in one catalog and absent from the other. */
export function compareCatalogs(
  lt: Record<string, string>,
  en: Record<string, string>,
): CatalogDiff {
  const ltKeys = Object.keys(lt).sort();
  const enKeys = Object.keys(en).sort();
  return {
    keyCount: ltKeys.length,
    missingInEn: ltKeys.filter((k) => !(k in en)),
    missingInLt: enKeys.filter((k) => !(k in lt)),
  };
}

/** Logs the diff and returns 0 when the catalogs match, 1 when they do not. */
export function reportCatalogDiff(diff: CatalogDiff): number {
  if (diff.missingInEn.length || diff.missingInLt.length) {
    console.error("i18n key mismatch");
    if (diff.missingInEn.length) console.error("Missing in en.json:", diff.missingInEn.join(", "));
    if (diff.missingInLt.length) console.error("Missing in lt.json:", diff.missingInLt.join(", "));
    return 1;
  }
  console.log(`i18n OK: ${diff.keyCount} keys`);
  return 0;
}

/** Reads the catalogs shipped with the site. */
export function checkBundledCatalogs(): number {
  const root = join(import.meta.dirname, "..", "src", "i18n");
  const lt = JSON.parse(readFileSync(join(root, "lt.json"), "utf8")) as Record<string, string>;
  const en = JSON.parse(readFileSync(join(root, "en.json"), "utf8")) as Record<string, string>;
  return reportCatalogDiff(compareCatalogs(lt, en));
}

/** Ends the process when the catalogs differ. */
export function exitIfMismatch(status: number): void {
  if (status !== 0) process.exit(status);
}

export function runI18nCheck(): void {
  exitIfMismatch(checkBundledCatalogs());
}

runCli(isCliEntry(import.meta.url, process.argv[1]), runI18nCheck);
