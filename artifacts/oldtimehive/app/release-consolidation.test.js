import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

test("Oldtime owns its release implementation without importing another app", async () => {
  const entry = await readFile(new URL("./release-entry.js", import.meta.url), "utf8");
  assert.match(entry, /import "\.\/app\.js"/);
  assert.doesNotMatch(entry, /oldtime-technologies/);
  await access(new URL("./app.js", import.meta.url));
  const previousAddress = await readFile(new URL("../../oldtime-technologies/index.html", import.meta.url), "utf8");
  assert.match(previousAddress, /location\.replace/);
  assert.doesNotMatch(previousAddress, /src="app\/app\.js"/);
});
