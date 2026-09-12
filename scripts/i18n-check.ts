import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "src", "i18n");
const lt = JSON.parse(readFileSync(join(root, "lt.json"), "utf8")) as Record<string, string>;
const en = JSON.parse(readFileSync(join(root, "en.json"), "utf8")) as Record<string, string>;
const ltKeys = Object.keys(lt).sort();
const enKeys = Object.keys(en).sort();
const missingInEn = ltKeys.filter((k) => !(k in en));
const missingInLt = enKeys.filter((k) => !(k in lt));
if (missingInEn.length || missingInLt.length) {
  console.error("i18n key mismatch");
  if (missingInEn.length) console.error("Missing in en.json:", missingInEn.join(", "));
  if (missingInLt.length) console.error("Missing in lt.json:", missingInLt.join(", "));
  process.exit(1);
}
console.log(`i18n OK: ${ltKeys.length} keys`);
