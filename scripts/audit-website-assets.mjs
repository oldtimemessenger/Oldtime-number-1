import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
const root = resolve("artifacts/oldtimehive"), publicRoot = resolve(root, "public");
async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(resolve(path, entry.name)) : [resolve(path, entry.name)]))).flat();
}
const sources = (await walk(resolve(root, "app"))).filter(path => /\.(js|css|tsx?|jsx|html)$/.test(path));
const missing = new Set();
for (const source of sources) {
  const text = await readFile(source, "utf8");
  for (const match of text.matchAll(/(?:["'`(])(?:\.\/|\/)?assets\/([^"'`\s?#${}()]+\.(?:png|jpe?g|svg|webp|gif|mp4|webm|woff2?|wasm|task|json))/g)) {
    try { await stat(resolve(publicRoot, "assets", match[1])); }
    catch {
      try { await stat(resolve(dirname(source), "assets", match[1])); }
      catch { missing.add(`${relative(root, source)}: assets/${match[1]}`); }
    }
  }
}
const assets = await walk(publicRoot);
console.log(`Public assets: ${assets.length}. Literal source references checked: ${sources.length} source files.`);
if (missing.size) { console.error([...missing].join("\n")); process.exitCode = 1; }
else console.log("No missing literal public asset references. Dynamic and user-uploaded media need separate verification.");
