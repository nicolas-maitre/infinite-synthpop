// Downloads the 80s drum-machine samples into public/samples/<kit>/<voice>.wav, so the app plays
// them from its own server. Without them it loads the same files from GitHub, then falls back to
// synthesized drums (src/drums.ts). Source: github.com/geikha/tidal-drum-machines (no
// license stated, so they aren't committed here). The list and the pinned commit live in
// src/sample-sources.json, shared with the app.
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = JSON.parse(await readFile(join(ROOT, "src", "sample-sources.json"), "utf8"));
const BASE = `https://raw.githubusercontent.com/${SOURCES.repo}/${SOURCES.commit}/${SOURCES.root}`;
const OUT = join(ROOT, "public", "samples");
const KITS = SOURCES.kits;

const force = process.argv.includes("--force");

async function exists(path) {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

let fetched = 0;
let skipped = 0;
for (const [kit, voices] of Object.entries(KITS)) {
  await mkdir(join(OUT, kit), { recursive: true });
  for (const [voice, path] of Object.entries(voices)) {
    const dest = join(OUT, kit, `${voice}.wav`);
    if (!force && (await exists(dest))) {
      skipped++;
      continue;
    }
    const url = `${BASE}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    fetched++;
    console.log(`  ${kit}/${voice}.wav`);
  }
}
console.log(`Samples ready in public/samples (${fetched} downloaded, ${skipped} already present).`);
