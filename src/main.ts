import "./style.css";
import { chordSlots } from "./arranger";
import type { BassStyle, KitName, Song } from "./composer";
import { KIT_LABELS } from "./drums";
import { Engine, type EngineSettings } from "./engine";
import { DEFAULT_VOLUMES, TRACK_LABELS, TRACKS, type Track } from "./instruments";
import { randomSeed } from "./rng";
import { chord, chordName, keyName, noteName } from "./theory";
import { startVisualizer } from "./visualizer";

// ── Persisted preferences (per browser; everything still works without storage) ─────────────

interface Prefs {
  style: number;
  bpm: number;
  bpmAuto: boolean;
  key: number | null;
  kit: KitName | "auto";
  volumes: Record<Track, number>;
  muted: Track[];
  master: number;
}

const PREFS_KEY = "infinite-synthpop:prefs:v1";
const defaults: Prefs = {
  style: 0.5,
  bpm: 118,
  bpmAuto: true,
  key: null,
  kit: "auto",
  volumes: { ...DEFAULT_VOLUMES },
  muted: [],
  master: 0,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return { ...defaults, ...p, volumes: { ...defaults.volumes, ...p.volumes } };
  } catch {
    return defaults;
  }
}

function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked (private mode etc.): preferences just won't persist.
  }
}

const prefs = loadPrefs();
const soloed = new Set<Track>();

// ── DOM ───────────────────────────────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing`);
  return node as T;
}

const ui = {
  play: el<HTMLButtonElement>("play"),
  newSong: el<HTMLButtonElement>("new-song"),
  skip: el<HTMLButtonElement>("skip"),
  title: el("song-title"),
  meta: el("song-meta"),
  chordName: el("chord-name"),
  chordNumeral: el("chord-numeral"),
  sectionName: el("section-name"),
  progression: el<HTMLOListElement>("progression"),
  barCount: el("bar-count"),
  timeline: el("timeline"),
  viz: el<HTMLCanvasElement>("viz"),
  seed: el<HTMLInputElement>("seed"),
  seedGo: el<HTMLButtonElement>("seed-go"),
  style: el<HTMLInputElement>("style"),
  styleOut: el<HTMLOutputElement>("style-out"),
  bpm: el<HTMLInputElement>("bpm"),
  bpmOut: el<HTMLOutputElement>("bpm-out"),
  bpmAuto: el<HTMLInputElement>("bpm-auto"),
  key: el<HTMLSelectElement>("key"),
  kit: el<HTMLSelectElement>("kit"),
  kitStatus: el("kit-status"),
  mixer: el("mixer-rows"),
};

// ── Engine ────────────────────────────────────────────────────────────────────────────────────

function engineSettings(): EngineSettings {
  return {
    style: prefs.style,
    key: prefs.key === null ? null : { tonic: prefs.key, mode: "minor" },
    bpm: prefs.bpmAuto ? null : prefs.bpm,
    kit: prefs.kit,
  };
}

const initialSeed = Number(new URLSearchParams(location.hash.slice(1)).get("seed"));
const engine = new Engine(
  engineSettings(),
  Number.isInteger(initialSeed) && initialSeed > 0 ? initialSeed : randomSeed(),
  {
    onSong: renderSong,
    onBar: (ev, song) => renderBar(song, ev.bar),
    onStateChange: (playing) => {
      ui.play.textContent = playing ? "■ Stop" : "▶ Play";
      ui.play.setAttribute("aria-pressed", String(playing));
    },
  },
);

async function togglePlay(): Promise<void> {
  if (engine.playing) {
    engine.stop();
    return;
  }
  ui.play.disabled = true;
  ui.play.textContent = "Loading…";
  try {
    await engine.start();
    applyMixer();
    renderKitStatus();
  } finally {
    ui.play.disabled = false;
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────────────────────

const BASS_LABELS: Record<BassStyle, string> = {
  pulse: "16th pulse bass",
  bounce: "16th bounce bass",
};

function renderSong(song: Song): void {
  ui.title.textContent = song.title;
  const kit = engine.instruments?.drums.kit ?? song.kit;
  ui.meta.textContent = [
    keyName(song.key),
    `${song.bpm} BPM`,
    `${KIT_LABELS[kit]} drums`,
    BASS_LABELS[song.bassStyle],
    `${song.totalBars} bars`,
  ].join(" · ");
  ui.seed.value = String(song.seed);
  if (prefs.bpmAuto) {
    ui.bpm.value = String(song.bpm);
    ui.bpmOut.value = `${song.bpm} BPM`;
  }
  history.replaceState(null, "", `#seed=${song.seed}`);

  ui.timeline.replaceChildren(
    ...song.sections.map((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sec";
      b.dataset.kind = s.kind;
      b.dataset.index = String(i);
      b.style.flex = String(s.bars);
      b.title = `${s.label} · ${s.bars} bars — click to jump`;
      b.setAttribute("role", "listitem");
      b.innerHTML = `<div class="fill"></div><span></span>`;
      const label = b.querySelector("span");
      if (label) label.textContent = s.label;
      b.addEventListener("click", () => {
        engine.jumpTo(s.startBar);
        if (!engine.playing) renderBar(engine.song, s.startBar);
      });
      return b;
    }),
  );
  renderBar(song, Math.min(engine.currentBar, song.totalBars - 1));
}

function renderBar(song: Song, bar: number): void {
  const sectionIndex = song.sections.findIndex(
    (s) => bar >= s.startBar && bar < s.startBar + s.bars,
  );
  const section = song.sections[sectionIndex];
  if (!section) return;
  const inSection = bar - section.startBar;
  const slots = chordSlots(section, inSection);

  const showChord = (i: number) => {
    const slot = slots[i];
    if (!slot) return;
    ui.chordName.textContent = slot.name;
    ui.chordNumeral.textContent =
      section.key.mode === "major"
        ? `${slot.chord.numeral} in ${noteName(section.key.tonic, section.key)}`
        : slot.chord.numeral;
  };
  showChord(0);
  if (slots.length > 1 && engine.playing) {
    // Second chord of a split bar lands half a bar later.
    setTimeout(() => showChord(1), (60 / song.bpm) * 2 * 1000);
  }

  ui.sectionName.textContent = section.label;
  const current = inSection % section.progression.length;
  ui.progression.replaceChildren(
    ...section.progression.map((numerals, i) => {
      const li = document.createElement("li");
      li.className = i === current ? "active" : "";
      const names = numerals.map((n) => chordName(section.key, chord(n)));
      li.innerHTML = `<span></span><small></small>`;
      const [name, numeral] = li.children;
      if (name) name.textContent = names.join(" – ");
      if (numeral) numeral.textContent = numerals.join(" – ");
      return li;
    }),
  );
  ui.barCount.textContent = `Bar ${bar + 1} / ${song.totalBars} · section bar ${inSection + 1} / ${section.bars}`;

  ui.timeline.querySelectorAll<HTMLElement>(".sec").forEach((node, i) => {
    node.classList.toggle("active", i === sectionIndex);
    node.classList.toggle("done", i < sectionIndex);
    const fill = node.querySelector<HTMLElement>(".fill");
    if (fill && i === sectionIndex) fill.style.width = `${((inSection + 1) / section.bars) * 100}%`;
    else if (fill && i > sectionIndex) fill.style.width = "0";
  });
}

function renderKitStatus(): void {
  const missing = Object.entries(engine.missingSamples);
  const total = missing.reduce((n, [, v]) => n + v.length, 0);
  ui.kitStatus.textContent = !engine.instruments
    ? "Samples load from public/samples on first play."
    : total === 0
      ? "All drum samples loaded locally."
      : `Synth fallback for ${total} missing sample(s): ${missing.map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ")}. Run \`pnpm fetch-samples\`.`;
}

// ── Controls ──────────────────────────────────────────────────────────────────────────────────

function styleLabel(v: number): string {
  if (v < 0.2) return "True Faith";
  if (v > 0.8) return "The Different Story";
  return v < 0.5 ? "leaning Faith" : v > 0.5 ? "leaning Story" : "half & half";
}

ui.style.value = String(prefs.style);
ui.styleOut.value = styleLabel(prefs.style);
ui.style.addEventListener("input", () => {
  ui.styleOut.value = styleLabel(Number(ui.style.value));
});
ui.style.addEventListener("change", () => {
  prefs.style = Number(ui.style.value);
  savePrefs();
  engine.update({ style: prefs.style });
});

ui.bpm.value = String(prefs.bpm);
ui.bpmAuto.checked = prefs.bpmAuto;
ui.bpm.disabled = prefs.bpmAuto;
ui.bpmOut.value = `${prefs.bpm} BPM`;
ui.bpm.addEventListener("input", () => {
  ui.bpmOut.value = `${ui.bpm.value} BPM`;
});
ui.bpm.addEventListener("change", () => {
  prefs.bpm = Number(ui.bpm.value);
  savePrefs();
  engine.update({ bpm: prefs.bpm });
});
ui.bpmAuto.addEventListener("change", () => {
  prefs.bpmAuto = ui.bpmAuto.checked;
  ui.bpm.disabled = prefs.bpmAuto;
  savePrefs();
  engine.update({ bpm: prefs.bpmAuto ? null : prefs.bpm });
});

const KEY_NOTES: Record<number, string> = { 2: " — True Faith", 4: " — The Different Story" };
ui.key.append(new Option("Auto (varies per song)", "auto"));
for (const tonic of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
  ui.key.append(
    new Option(`${keyName({ tonic, mode: "minor" })}${KEY_NOTES[tonic] ?? ""}`, String(tonic)),
  );
}
ui.key.value = prefs.key === null ? "auto" : String(prefs.key);
ui.key.addEventListener("change", () => {
  prefs.key = ui.key.value === "auto" ? null : Number(ui.key.value);
  savePrefs();
  engine.update({ key: prefs.key === null ? null : { tonic: prefs.key, mode: "minor" } });
});

ui.kit.append(new Option("Auto (varies per song)", "auto"));
for (const kit of ["sp12", "linndrum", "dmx", "synth"] as const)
  ui.kit.append(new Option(KIT_LABELS[kit], kit));
ui.kit.value = prefs.kit;
ui.kit.addEventListener("change", () => {
  prefs.kit = ui.kit.value as KitName | "auto";
  savePrefs();
  engine.update({ kit: prefs.kit });
});

const loadSeed = () => {
  const seed = Math.max(0, Math.min(999_999, Math.floor(Number(ui.seed.value) || 0)));
  engine.newSong(seed);
};
ui.seedGo.addEventListener("click", loadSeed);
ui.seed.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadSeed();
});

ui.play.addEventListener("click", () => void togglePlay());
ui.newSong.addEventListener("click", () => engine.newSong(randomSeed()));
ui.skip.addEventListener("click", () => engine.skipSection());

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (
    target &&
    ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) &&
    target.getAttribute("type") !== "range"
  )
    return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === "Space") {
    e.preventDefault();
    void togglePlay();
  } else if (e.key === "n" || e.key === "N") engine.newSong(randomSeed());
  else if (e.key === "s" || e.key === "S") engine.skipSection();
});

// ── Mixer ─────────────────────────────────────────────────────────────────────────────────────

function applyMixer(): void {
  const inst = engine.instruments;
  if (!inst) return;
  for (const t of TRACKS) {
    const ch = inst.channels[t];
    ch.volume.value = prefs.volumes[t];
    ch.mute = prefs.muted.includes(t);
    ch.solo = soloed.has(t);
  }
  inst.master.volume.value = prefs.master;
}

function mixRow(
  label: string,
  value: number,
  onInput: (v: number) => void,
  extra: HTMLElement[] = [],
): HTMLElement {
  const row = document.createElement("div");
  row.className = "mix-row";
  const name = document.createElement("span");
  name.textContent = label;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "-40";
  slider.max = "0";
  slider.step = "0.5";
  slider.value = String(value);
  slider.setAttribute("aria-label", `${label} volume`);
  slider.addEventListener("input", () => onInput(Number(slider.value)));
  row.append(name, slider, ...extra);
  return row;
}

function toggle(
  label: string,
  cls: string,
  pressed: boolean,
  title: string,
  onChange: (on: boolean) => void,
) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn toggle ${cls}`;
  b.textContent = label;
  b.title = title;
  b.setAttribute("aria-pressed", String(pressed));
  b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    onChange(on);
  });
  return b;
}

for (const t of TRACKS) {
  const mute = toggle("M", "mute", prefs.muted.includes(t), `Mute ${TRACK_LABELS[t]}`, (on) => {
    prefs.muted = on ? [...prefs.muted, t] : prefs.muted.filter((m) => m !== t);
    savePrefs();
    applyMixer();
  });
  const solo = toggle("S", "solo", false, `Solo ${TRACK_LABELS[t]}`, (on) => {
    if (on) soloed.add(t);
    else soloed.delete(t);
    applyMixer();
  });
  ui.mixer.append(
    mixRow(
      TRACK_LABELS[t],
      prefs.volumes[t],
      (v) => {
        prefs.volumes[t] = v;
        savePrefs();
        applyMixer();
      },
      [mute, solo],
    ),
  );
}
const master = mixRow("Master", prefs.master, (v) => {
  prefs.master = v;
  savePrefs();
  applyMixer();
});
master.classList.add("master");
ui.mixer.append(master);

// ── Go ────────────────────────────────────────────────────────────────────────────────────────

renderSong(engine.song);
renderKitStatus();
startVisualizer(ui.viz, () =>
  engine.instruments && engine.playing
    ? { fft: engine.instruments.fft, waveform: engine.instruments.waveform }
    : null,
);

if (import.meta.env.DEV) {
  void Promise.all([import("tone"), import("./render")]).then(([Tone, { renderToDisk }]) =>
    Object.assign(window, { engine, Tone, renderToDisk }),
  );
}
