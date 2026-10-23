import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";

// Keep install assets at stable, scope-relative URLs and precache the actual
// build output, never development /app/*.js paths.
export function oldtimePwa(): Plugin {
  let base = "/";
  return {
    name: "oldtime-production-pwa",
    apply: "build",
    configResolved(config) { base = config.base; },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        // Vite otherwise hashes the manifest under /assets/, which changes
        // how its relative start URL, scope and icon URLs resolve.
        return html.replace(/<link rel="manifest" href="[^"]*"\s*\/?>/,
          `<link rel="manifest" href="${base}manifest.json" />`);
      },
    },
    async generateBundle(_options, bundle) {
      const root = new URL("./", import.meta.url);
      const digest = createHash("sha256");
      const stableFiles = ["manifest.json", "app-icon.svg", "app-icon-180.png", "app-icon-192.png", "app-icon-512.png"];
      for (const file of stableFiles) {
        const source = await readFile(new URL(file, root));
        digest.update(source);
        this.emitFile({ type: "asset", fileName: file, source });
      }
      const files = ["index.html", ...stableFiles, ...Object.keys(bundle)
        .filter(name => /\.(?:js|css)$/.test(name))];
      const template = await readFile(new URL("service-worker.js", root), "utf8");
      const version = digest.update(JSON.stringify(files)).update(template).digest("hex").slice(0, 16);
      this.emitFile({ type: "asset", fileName: "service-worker.js", source: template
        .replace('"__BUILD_VERSION__"', JSON.stringify(version))
        .replace('["__PRECACHE_FILES__"]', JSON.stringify(files.map(name => `./${name}`))) });
    },
  };
}
