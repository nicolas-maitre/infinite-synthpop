// Downloads the 80s drum-machine samples into public/samples/<kit>/<voice>.wav so the app never
// depends on a CDN at runtime. Source: github.com/geikha/tidal-drum-machines (no license stated —
// fine for personal use, don't redistribute). Pinned to a commit for reproducibility.
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const COMMIT = "6577395a4d05031728ced2ec3e5637fa89d8be48";
const BASE = `https://raw.githubusercontent.com/geikha/tidal-drum-machines/${COMMIT}/machines`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "samples");

// Keep in sync with KIT_VOICES in src/drums.ts.
const KITS = {
  sp12: {
    kick: "EmuSP12/emusp12-bd/Bassdrum-01.wav",
    snare: "EmuSP12/emusp12-sd/Snaredrum-01.wav",
    hat: "EmuSP12/emusp12-hh/Hat Closed-01.wav",
    openhat: "EmuSP12/emusp12-oh/Hhopen1.wav",
    clap: "EmuSP12/emusp12-cp/Clap.wav",
    crash: "EmuSP12/emusp12-cr/Crash.wav",
    tomh: "EmuSP12/emusp12-ht/Tom H-01.wav",
    tomm: "EmuSP12/emusp12-mt/Tom M-01.wav",
    toml: "EmuSP12/emusp12-lt/Tom L-01.wav",
    rim: "EmuSP12/emusp12-rim/zRim Shot-01.wav",
    tamb: "LinnDrum/linndrum-tb/Tambourine.wav",
    cabasa: "LinnDrum/linndrum-sh/Cabasa.wav",
  },
  linndrum: {
    kick: "LinnDrum/linndrum-bd/Bassdrum.wav",
    snare: "LinnDrum/linndrum-sd/0Snarderum-01.wav",
    hat: "LinnDrum/linndrum-hh/Hat Closed-01.wav",
    openhat: "LinnDrum/linndrum-oh/Hat Open.wav",
    clap: "LinnDrum/linndrum-cp/Clap.wav",
    crash: "LinnDrum/linndrum-cr/Crash.wav",
    tomh: "LinnDrum/linndrum-ht/Tom H-01.wav",
    tomm: "LinnDrum/linndrum-mt/Tom M-01.wav",
    toml: "LinnDrum/linndrum-lt/Tom L-01.wav",
    rim: "LinnDrum/linndrum-rim/Sidestick-01.wav",
    tamb: "LinnDrum/linndrum-tb/Tambourine.wav",
    cabasa: "LinnDrum/linndrum-sh/Cabasa.wav",
  },
  dmx: {
    kick: "OberheimDMX/oberheimdmx-bd/Bassdrum-01.wav",
    snare: "OberheimDMX/oberheimdmx-sd/Snaredrum-01.wav",
    hat: "OberheimDMX/oberheimdmx-hh/Hat Closed.wav",
    openhat: "OberheimDMX/oberheimdmx-oh/Hat Open.wav",
    clap: "OberheimDMX/oberheimdmx-cp/Clap.wav",
    crash: "OberheimDMX/oberheimdmx-cr/Crash.wav",
    tomh: "OberheimDMX/oberheimdmx-ht/Tom H.wav",
    tomm: "OberheimDMX/oberheimdmx-mt/Tom M.wav",
    toml: "OberheimDMX/oberheimdmx-lt/Tom L.wav",
    rim: "OberheimDMX/oberheimdmx-rim/Rim Shot.wav",
    tamb: "LinnDrum/linndrum-tb/Tambourine.wav",
    cabasa: "LinnDrum/linndrum-sh/Cabasa.wav",
  },
};

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
