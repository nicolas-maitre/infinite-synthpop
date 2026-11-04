import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Dev-only: `window.renderToDisk(seed)` (src/render.ts) renders a song offline and POSTs the WAV
 * here, so it can be measured with scripts/analyze_reference.py against the reference recordings.
 */
function saveRenders(): Plugin {
  return {
    name: "save-renders",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__renders", (req, res) => {
        const name = (req.url ?? "").replace(/^\//, "");
        if (req.method !== "POST" || !/^[\w.-]+\.wav$/.test(name)) {
          res.statusCode = 400;
          res.end("POST /__renders/<name>.wav");
          return;
        }
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", async () => {
          const dir = join(server.config.root, "renders");
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, name), Buffer.concat(chunks));
          res.end(`renders/${name}`);
        });
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages serves the site from /infinite-synthpop/ (set by .github/workflows/pages.yml).
  base: process.env.BASE_PATH ?? "/",
  plugins: [saveRenders()],
  build: { target: "es2022" },
  test: { include: ["src/**/*.test.ts"] },
});
