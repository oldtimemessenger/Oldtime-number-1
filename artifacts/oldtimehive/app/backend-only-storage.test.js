import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
async function modules(directory = root) {
  const files = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(files.map(file => file.isDirectory() ? modules(join(directory, file.name))
    : file.name.endsWith(".js") && !file.name.includes(".test.") ? [join(directory, file.name)] : []))).flat();
}
test("release modules cannot add browser content databases or local durable feature writers", async () => {
  for (const file of await modules()) {
    const source = await readFile(file, "utf8");
    if (/indexedDB/.test(source)) {
      assert.doesNotMatch(source, /(?:objectStore\([^)]*\)|\bstore)\s*\.\s*(?:put|add)\s*\(/, file);
    }
    if (/localStorage\.setItem/.test(source)) {
      if (file.endsWith("/store.js")) {
        assert.match(source, /if \(!allowsTestOnlyLocalAccount\(\) \|\| getCloudSession\(\)\) return;/);
      } else if (/\/blast-(?:store|video-note-store)\.js$/.test(file)) {
        // This write only removes confirmed entries, preserving other owners.
        assert.match(source, /localStorage\.setItem\(STORAGE_KEY, JSON\.stringify\(remaining\)\)/);
      } else {
        assert.ok(file.endsWith("/tournaments.js"), `Unexpected browser feature writer: ${file}`);
        // Deferred tournament onboarding markers are UI state, never content.
        assert.match(source, /localStorage\.setItem\([^,]+,\s*"seen"\)/);
      }
    }
  }
});
