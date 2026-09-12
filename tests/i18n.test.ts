import { readFileSync } from "node:fs";
import { join } from "node:path";

it("lt.json and en.json have the same keys", () => {
  const dir = join(import.meta.dirname, "..", "src", "i18n");
  const lt = JSON.parse(readFileSync(join(dir, "lt.json"), "utf8")) as Record<string, string>;
  const en = JSON.parse(readFileSync(join(dir, "en.json"), "utf8")) as Record<string, string>;
  expect(Object.keys(lt).sort()).toEqual(Object.keys(en).sort());
});
