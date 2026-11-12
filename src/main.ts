import "./style.css";
import { chordSlots } from "./arranger";
import type { BassStyle, DrumMode, ImportedTracks, KitName, Song } from "./composer";
import { KIT_LABELS } from "./drums";
import { AHEAD_SUPPORTED } from "./ahead";
import { Engine, type EngineSettings } from "./engine";
import {
  autoVolumes,
  DEFAULT_VOLUMES,
  LEAD_PATCHES,
  PREVIOUS_DEFAULT_VOLUMES,
  TRACK_LABELS,
  TRACKS,
  type LeadPatch,
  type Track,
} from "./instruments";
import { matchTracks, mergeBars, parseMidi, toDrumBars, type MidiFile } from "./midi";
import { mountCreator } from "./creator";
import { Library, type SavedSong } from "./library";
import { assignMelody, nextMelodyName } from "./melodies";
import { Recorder } from "./recorder";
import { download, exportAudio, fileName, songToMidi } from "./export";
import { PianoRoll } from "./pianoroll";
import { mountWizard } from "./wizard";
import { REFERENCES, type ReferenceId } from "./references";
import { decodeCreation, encodeCreation, songToSpec, type Creation, type SongSpec } from "./spec";
import { randomSeed } from "./rng";
import { chord, chordName, keyName, noteName } from "./theory";
import { startVisualizer } from "./visualizer";
import { mountAudioStats } from "./audiostats";
import {
  DEVICE_QUALITY,
  QUALITY,
  QUALITY_CHOICE,
  QUALITY_FROM_URL,
  saveQualityChoice,
  SHOW_AUDIO_STATS,
} from "./quality";
import { BlendPad, initials, weightsSummary } from "./blendpad";
import { barAtSeconds, mountMediaControls } from "./mediasession";
import { songSound } from "./profile";
import {
  DEFAULT_GENRE,
  GENRE_IDS,
  GENRES,
  isGenreId,
  isStyleWeights,
  parseWeights,
  referenceWeights,
  styleName,
  weightsAtPoint,
  type GenreId,
} from "./genres";
import { CENTRE } from "./polygon";

// ── Persisted preferences (per browser; everything still works without storage) ─────────────

interface Prefs {
  /** The genre generated songs come from (genres.ts). */
  /** "auto": a genre per song. */
  genre: GenreId | "auto";
  /** That genre's references' weights (genres.ts), set with the style polygon. */
  weights: number[];
  styleAuto: boolean;
  bpm: number;
  bpmAuto: boolean;
  key: number | null;
  kit: KitName | "auto";
  /** Each fader's level by hand, used for the tracks in `manual`. */
  volumes: Record<Track, number>;
  /** Faders taken off auto. The others follow the playing song's genre (genres.ts `mix`). */
  manual: Track[];
  muted: Track[];
  master: number;
  /** Start playing as soon as the page loads (or at the first interaction, if the browser asks). */
  autoplay: boolean;
  /** Switch songs, sections and bars right away instead of at the next bar line. */
  instant: boolean;
  /** The sung lead's sound: a formant voice, or the original lead synth. */
  lead: LeadPatch;
  /** Play the synths live, or render the music ahead (engine.ts); auto renders ahead on phones. */
  playback: Playback;
  /** Seconds to render ahead; 0 = auto (more on phones). */
  buffer: number;
}

type Playback = "auto" | "live" | "ahead";
const PLAYBACKS: readonly Playback[] = ["auto", "live", "ahead"];
const BUFFERS = [0, 10, 20, 30, 60, 120];
/** Phones (the lite guess) render ahead, with a long buffer. */
const AUTO_AHEAD = DEVICE_QUALITY === "lite";
const AUTO_BUFFER = AUTO_AHEAD ? 60 : 20;

const PREFS_KEY = "infinite-synthpop:prefs:v1";
/** A genre's references, as named at its style polygon's vertices. */
function refNames(genre: GenreId): string[] {
  return GENRES[genre].references.map(styleName);
}

/** "TF 30 · DS 30 · YC 40" for a genre's weights. */
function weightsLabel(genre: GenreId, weights: readonly number[]): string {
  const names = refNames(genre);
  return weightsSummary(names, initials(names), weights);
}

/** A genre's style polygon at its centre: an equal mix of its references. */
function centreWeights(genre: GenreId): number[] {
  return weightsAtPoint(GENRES[genre], CENTRE);
}

// Everything a first visit plays is picked per song: press play and it keeps going.
const defaults: Prefs = {
  genre: "auto",
  weights: centreWeights(DEFAULT_GENRE),
  styleAuto: true,
  bpm: 118,
  bpmAuto: true,
  key: null,
  kit: "auto",
  volumes: { ...DEFAULT_VOLUMES },
  manual: [],
  muted: [],
  master: 0,
  autoplay: false,
  instant: false,
  lead: "voice",
  playback: "auto",
  buffer: 0,
};

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaults;
    const p = JSON.parse(raw) as Partial<Prefs> & { style?: unknown };
    // Saved before genres: synthpop.
    const genre = p.genre === "auto" || isGenreId(p.genre) ? p.genre : DEFAULT_GENRE;
    const volumes = { ...defaults.volumes, ...p.volumes };
    // Saved before the triangle: only a style, which plays as [1 − style, style, 0].
    const style = typeof p.style === "number" ? Math.min(1, Math.max(0, p.style)) : null;
    // With the genre picked per song, the weights are too: these are kept for a fixed genre only.
    const fixed = genre === "auto" ? DEFAULT_GENRE : genre;
    const weights =
      parseWeights(GENRES[fixed], p.weights) ??
      (style === null ? centreWeights(fixed) : [...referenceWeights(GENRES[fixed], style)]);
    delete p.style;
    // Faders left at an old default follow the new one.
    for (const [t, old] of Object.entries(PREVIOUS_DEFAULT_VOLUMES) as [Track, number][]) {
      if (volumes[t] === old) volumes[t] = DEFAULT_VOLUMES[t];
    }
    const lead = LEAD_PATCHES.find((l) => l === p.lead) ?? defaults.lead;
    // Saved before auto levels: a fader moved off its default stays where it was put, by hand.
    const manual = Array.isArray(p.manual)
      ? TRACKS.filter((t) => p.manual!.includes(t))
      : TRACKS.filter((t) => volumes[t] !== DEFAULT_VOLUMES[t]);
    const playback = PLAYBACKS.find((x) => x === p.playback) ?? defaults.playback;
    const buffer = BUFFERS.find((x) => x === p.buffer) ?? defaults.buffer;
    return { ...defaults, ...p, volumes, manual, genre, weights, lead, playback, buffer };
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

// The mixer's faders and auto buttons (built under Mixer below), declared first: a song can arrive
// and re-apply the mix before the mixer is built.
const sliders = new Map<Track | "master", HTMLInputElement>();
const autoButtons = new Map<Track, HTMLButtonElement>();

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
  stylePad: el("style-pad"),
  styleOut: el<HTMLOutputElement>("style-out"),
  styleAuto: el<HTMLInputElement>("style-auto"),
  bpm: el<HTMLInputElement>("bpm"),
  bpmOut: el<HTMLOutputElement>("bpm-out"),
  bpmAuto: el<HTMLInputElement>("bpm-auto"),
  bpmHint: el("bpm-hint"),
  key: el<HTMLSelectElement>("key"),
  kit: el<HTMLSelectElement>("kit"),
  genre: el<HTMLSelectElement>("genre"),
  kitStatus: el("kit-status"),
  mixer: el("mixer-rows"),
  mixerReset: el<HTMLButtonElement>("mixer-reset"),
  sectionDetail: el("section-detail"),
};
const roll = new PianoRoll(el<HTMLCanvasElement>("roll"), (bar) => {
  engine.jumpTo(bar);
  if (!engine.playing) renderBar(engine.song, bar);
});

// ── Creator mode and looping ──────────────────────────────────────────────────────────────────

const creatorToggle = el<HTMLButtonElement>("creator-toggle");
const loopToggle = el<HTMLButtonElement>("loop");
/** The section on screen (the one playing, or the one picked on the timeline). */
let shownSection = 0;

// ── My songs (library.ts) and sharing ──────────────────────────────────────────────────────────

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // Storage blocked: songs last for this visit only.
  }
}

const library = new Library(storage());
/** Earlier versions kept only the last creation, under this key. */
library.migrate("infinite-synthpop:creation:v1", ({ spec }) =>
  songSummary(
    spec.key,
    spec.bpm,
    spec.sections.reduce((n, s) => n + s.bars, 0),
  ),
);

function songSummary(key: Song["key"], bpm: number, bars: number): string {
  return `${keyName(key)} · ${bpm} BPM · ${bars} bars`;
}

/** What a generated song or original is, for ♡ Save (SavedSong.from). A song a legacy style
 * describes keeps the old form, so songs saved before the weights are still found. */
function songOrigin(song: Song): string {
  const style = isStyleWeights(GENRES[song.genre], song.weights, song.style)
    ? String(song.style)
    : `w${song.weights.join(",")}`;
  // Synthpop songs keep the form they had before genres.
  const genre = song.genre === DEFAULT_GENRE ? "" : `${song.genre}/`;
  return song.reference
    ? `ref:${song.reference}`
    : `seed:${song.seed}/${genre}${style}/${song.key.tonic}/${song.bpm}/${song.kit}`;
}

/** The library entry for what's playing, if it has one. */
function currentEntry(): SavedSong | undefined {
  const id = engine.creation?.id;
  return id ? library.get(id) : library.findFrom(songOrigin(engine.song));
}

/**
 * A link that plays this exact song. A generated song goes as a creation: its seed alone would
 * sound different with the other person's generator settings.
 */
function shareUrl(song: Song, creation: Creation | null): string {
  const hash = creation
    ? `#song=${encodeCreation(creation)}`
    : song.reference
      ? `#ref=${song.reference}`
      : `#song=${encodeCreation({ seed: song.seed, spec: songToSpec(song) })}`;
  return `${location.origin}${location.pathname}${hash}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No clipboard access (insecure origin, refused): let the user copy it by hand.
    window.prompt("Copy this link:", text);
    return false;
  }
}

/** Copies a link, with the button saying so for a moment. */
async function share(button: HTMLButtonElement, url: string): Promise<boolean> {
  const ok = await copyText(url);
  if (ok) {
    const label = button.textContent;
    button.textContent = "✓ Link copied";
    button.classList.add("done");
    setTimeout(() => {
      button.textContent = label;
      button.classList.remove("done");
    }, 1500);
  }
  return ok;
}

function latestSaved(): Creation | null {
  const current = engine.creation?.id;
  const entry = library.list().find((s) => s.id !== current);
  return entry ? library.creation(entry.id) : null;
}

/** Shows a section: playback jumps there, and it becomes the looped one when looping. */
function selectSection(index: number): void {
  const section = engine.song.sections[index];
  if (!section) return;
  shownSection = index;
  engine.jumpTo(section.startBar);
  if (engine.loopSection !== null) engine.setLoop(index);
  if (!engine.playing) renderBar(engine.song, section.startBar);
}

function setLooping(on: boolean): void {
  engine.setLoop(on ? shownSection : null);
  loopToggle.setAttribute("aria-pressed", String(on));
}

/** Creator mode edits the playing song in place (it becomes a creation the first time). */
function setCreator(on: boolean): void {
  if (on && !engine.creation) {
    const song = engine.song;
    // A song kept with ♡ Save goes on as that entry; any other becomes a new one.
    const id = library.findFrom(songOrigin(song))?.id;
    engine.playCustom({ seed: song.seed, spec: songToSpec(song), ...(id ? { id } : {}) }, true);
  }
  // Creator mode plays live: recording needs the live synths.
  engine.setLiveOnly(on);
  creator.setActive(on);
  roll.setCreatorMode(on);
  creatorToggle.setAttribute("aria-pressed", String(on));
  document.body.classList.toggle("creating", on);
  renderSong(engine.song);
}

const creator = mountCreator(ui.progression, el("section-editor"), el("roll-controls"), {
  song: () => engine.song,
  creation: () => engine.creation,
  play: (c, keepPosition) => engine.playCustom(c, keepPosition),
  edit: (spec) => engine.editCustom(spec),
  select: selectSection,
  seek: (bar) => {
    engine.jumpTo(bar);
    if (!engine.playing) renderBar(engine.song, bar);
  },
  saved: latestSaved,
  copyLink: () => copyText(shareUrl(engine.song, engine.creation)),
  toggleRecording,
  recording: () => !!recorder?.active || recordingFrom !== null,
  midiFile: (pick) => (pick ? pickMidiFile() : Promise.resolve(midi ?? pickedMidi)),
  setLeadEditor: (editor) => roll.setEditor(editor),
});
creatorToggle.addEventListener("click", () => setCreator(!creator.active));
roll.onLayout = (lanes, labelWidth) => creator.layoutLanes(lanes, labelWidth);

// Recording a melody: the section loops with its own lead silenced, you play over it, and the
// take becomes its melody when you stop.
let recorder: Recorder | null = null;
let recordingFrom: { spec: SongSpec; song: Song; index: number } | null = null;

async function toggleRecording(index: number): Promise<boolean> {
  const creation = engine.creation;
  if (recorder?.active || recordingFrom) {
    finishRecording();
    return false;
  }
  const song = engine.song;
  const section = song.sections[index];
  if (!creation || !section) return false;
  recordingFrom = { spec: structuredClone(creation.spec), song, index };
  const silent = structuredClone(creation.spec);
  const target = silent.sections[index];
  if (target) target.layers.lead = null;
  engine.editCustom(silent);
  shownSection = index;
  setLooping(true);
  if (!engine.playing) await togglePlay();
  recorder ??= new Recorder(engine);
  await recorder.start({
    startBar: section.startBar,
    bars: section.bars,
    tonic: section.key.tonic,
  });
  return true;
}

function finishRecording(): void {
  const from = recordingFrom;
  recordingFrom = null;
  if (!from) return;
  const melody = recorder?.stop(nextMelodyName(from.spec)) ?? null;
  const spec = from.spec; // the section's lead is back
  if (melody) assignMelody(spec, from.song, from.index, melody);
  engine.editCustom(spec);
}

let pickedMidi: MidiFile | null = null;
function pickMidiFile(): Promise<MidiFile | null> {
  return new Promise((resolve) => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = ".mid,.midi,audio/midi";
    picker.addEventListener("change", () => {
      const file = picker.files?.[0];
      if (!file) return resolve(null);
      file.arrayBuffer().then(
        (buffer) => resolve((pickedMidi = parseMidi(buffer))),
        () => resolve(null),
      );
    });
    picker.click();
  });
}

// Creator mode: the title is edited in place (Enter or leaving the field renames the song).
function renameSong(): void {
  const creation = engine.creation;
  const title = (ui.title.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!creation || !creator.active) return;
  if (!title) {
    ui.title.textContent = creation.spec.title;
    return;
  }
  if (title !== creation.spec.title)
    engine.editCustom({ ...structuredClone(creation.spec), title });
}
ui.title.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    ui.title.blur();
  } else if (e.key === "Escape") {
    ui.title.textContent = engine.song.title;
    ui.title.blur();
  }
});
ui.title.addEventListener("blur", renameSong);
loopToggle.addEventListener("click", () => setLooping(engine.loopSection === null));

// ── Export ────────────────────────────────────────────────────────────────────────────────────

const exportButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-export]")];
const exportStatus = el("export-status");

async function exportSong(format: string): Promise<void> {
  const song = engine.song;
  if (format === "midi") {
    download(songToMidi(song), fileName(song.title, "mid"), "audio/midi");
    exportStatus.textContent = `Saved “${fileName(song.title, "mid")}”`;
    return;
  }
  if (format !== "mp3" && format !== "wav") return;
  // Rendering borrows the audio engine, so live playback stops first.
  if (engine.playing) engine.stop();
  for (const b of exportButtons) b.disabled = true;
  try {
    const blob = await exportAudio(song, format, {
      volumes: prefs.volumes,
      master: prefs.master,
      muted: prefs.muted,
      soloed: [...soloed],
      leadPatch: prefs.lead,
      onProgress: (f, stage) => {
        exportStatus.textContent = `${stage === "rendering" ? "Rendering" : "Encoding"} ${Math.round(f * 100)}%`;
      },
    });
    download(blob, fileName(song.title, format), blob.type);
    exportStatus.textContent = `Saved “${fileName(song.title, format)}” (${(blob.size / 1e6).toFixed(1)} MB)`;
  } catch (e) {
    exportStatus.textContent = `Export failed: ${String(e)}`;
  } finally {
    for (const b of exportButtons) b.disabled = false;
  }
}
for (const b of exportButtons) {
  b.addEventListener("click", () => void exportSong(b.dataset.export ?? ""));
}

// ── New-song wizard ───────────────────────────────────────────────────────────────────────────

const openWizard = mountWizard(el<HTMLDialogElement>("wizard"), (creation) => {
  engine.playCustom(creation);
});
el("create-song").addEventListener("click", openWizard);

const autoplayBox = el<HTMLInputElement>("autoplay");
autoplayBox.checked = prefs.autoplay;
autoplayBox.addEventListener("change", () => {
  prefs.autoplay = autoplayBox.checked;
  savePrefs();
});
const originals = [...document.querySelectorAll<HTMLButtonElement>("[data-reference]")];

function isReferenceId(id: string | null | undefined): id is ReferenceId {
  return !!id && id in REFERENCES;
}

// ── Engine ────────────────────────────────────────────────────────────────────────────────────

function engineSettings(): EngineSettings {
  return {
    genre: prefs.genre,
    weights: prefs.styleAuto || prefs.genre === "auto" ? null : prefs.weights,
    key: prefs.key === null ? null : { tonic: prefs.key, mode: "minor" },
    bpm: prefs.bpmAuto ? null : prefs.bpm,
    kit: prefs.kit,
  };
}

const hash = new URLSearchParams(location.hash.slice(1));
const initialSeed = Number(hash.get("seed"));
const initialReference = hash.get("ref");
const initialCreation = hash.get("song");
// The system's media controls (lock screen, Now Playing, media keys): mediasession.ts.
const media = mountMediaControls({
  play: () => {
    if (!engine.playing) void togglePlay();
  },
  pause: () => engine.stop(),
  next: () => engine.newSong(randomSeed()),
  previous: () => engine.jumpTo(0),
  seekTo: (seconds) => engine.jumpTo(barAtSeconds(engine.song, seconds)),
  seekForward: () => engine.skipSection(),
  seekBackward: () => {
    const { sections } = engine.song;
    const i = sections.findIndex(
      (s) => engine.currentBar >= s.startBar && engine.currentBar < s.startBar + s.bars,
    );
    engine.jumpTo(sections[Math.max(0, i - 1)]?.startBar ?? 0);
  },
});

const engine = new Engine(
  engineSettings(),
  Number.isInteger(initialSeed) && initialSeed > 0 ? initialSeed : randomSeed(),
  {
    onSong: renderSong,
    onBar: (ev, song) => renderBar(song, ev.bar),
    onStateChange: (playing) => {
      media.setPlaying(playing);
      ui.play.textContent = playing ? "■ Stop" : "▶ Play";
      ui.play.setAttribute("aria-pressed", String(playing));
    },
    onCue: renderCue,
    onBuffering: renderBufferStatus,
  },
);
engine.setInstant(prefs.instant);
async function togglePlay(): Promise<void> {
  if (engine.playing) {
    engine.stop();
    return;
  }
  ui.play.disabled = true;
  // The first start loads the synths and ~36 drum samples: a spinner, then a count.
  ui.play.classList.add("loading");
  ui.play.textContent = "Loading…";
  // Before any await, while the click still counts as a gesture.
  media.activate();
  try {
    await engine.start((done, total) => {
      ui.play.textContent = `Loading ${Math.round((done / total) * 100)}%`;
    });
    applyMixer();
    renderKitStatus();
  } catch (error) {
    // Not left on "Loading…": the button works again, and the console says why it failed.
    ui.play.textContent = "▶ Play";
    console.error("Couldn't start playback", error);
  } finally {
    ui.play.disabled = false;
    ui.play.classList.remove("loading");
  }
}

/**
 * Autoplay on load. Browsers only let audio start without a click on sites you often play media
 * on; a throwaway AudioContext shows whether this is one ("running" rather than "suspended").
 * If not, the first click or key press anywhere starts playback.
 */
function autoplay(): void {
  if (!prefs.autoplay) return;
  let allowed = false;
  try {
    const probe = new AudioContext();
    allowed = probe.state === "running";
    void probe.close();
  } catch {
    // No Web Audio at all: leave it to the first click.
  }
  if (allowed) {
    void togglePlay();
    return;
  }
  ui.play.textContent = "▶ Click anywhere to start";
  const start = (e: Event) => {
    document.removeEventListener("pointerdown", start, true);
    document.removeEventListener("keydown", start, true);
    // Let a click on the Play button itself do its own toggling.
    if (e.target instanceof Element && e.target.closest("#play")) return;
    if (!engine.playing) void togglePlay();
  };
  document.addEventListener("pointerdown", start, true);
  document.addEventListener("keydown", start, true);
}

// ── Rendering ─────────────────────────────────────────────────────────────────────────────────

const BASS_LABELS: Record<BassStyle, string> = {
  ds: "Different Story bass figure",
  tf: "True Faith bass figure",
  yc: "You Came root-8ths bass",
  italo: "Get Closer root-8ths bass",
  night: "The Night root-8ths bass",
  faces: "Faces staccato bass",
  sc: "Self Control staccato quarters",
  innocent: "Innocent Love pedal and slurred riff",
  heaven: "Heaven Can Wait riff bass",
  juliet: "Crazy Juliet syncopated bass",
};

function renderSong(song: Song): void {
  // A new song may be in another genre, with its own mix for the auto faders.
  applyMixer();
  media.setSong(song, GENRES[song.genre].name);
  media.setPosition(song, engine.currentBar);
  // While editing the title, don't overwrite what's being typed.
  if (document.activeElement !== ui.title) ui.title.textContent = song.title;
  const editable = creator.active && !!engine.creation;
  ui.title.contentEditable = editable ? "plaintext-only" : "false";
  ui.title.title = editable ? "Click to rename the song" : "";
  ui.title.classList.toggle("editable", editable);
  const kit = engine.instruments?.drums.kit ?? song.kit;
  ui.meta.textContent = [
    keyName(song.key),
    `${song.bpm} BPM`,
    `${KIT_LABELS[kit]} drums`,
    BASS_LABELS[song.bassStyle],
    `${song.totalBars} bars`,
    ...(song.reference ? ["original form & chords, generated melodies"] : []),
    ...(engine.creation ? ["your creation (loops)"] : []),
  ].join(" · ");
  ui.seed.value = String(song.seed);
  // Genre auto: the pad and the tempo hint follow each song's genre.
  if (prefs.genre === "auto" && song.genre !== padGenre) {
    padGenre = song.genre;
    stylePad = newStylePad();
    showStylePad();
    showTempoHint();
  }
  // Auto: the pad shows where this song's point landed (when the song is from the pad's genre).
  if (styleIsAuto() && song.genre === padGenre) {
    stylePad.setWeights(song.weights);
    ui.styleOut.value = song.reference
      ? REFERENCES[song.reference].title
      : weightsLabel(song.genre, song.weights);
  }
  if (prefs.bpmAuto) {
    ui.bpm.value = String(song.bpm);
    ui.bpmOut.value = `${song.bpm} BPM`;
  }
  const creation = engine.creation;
  if (creation) library.save(creation, songSummary(song.key, song.bpm, song.totalBars));
  renderSongs();
  history.replaceState(
    null,
    "",
    creation
      ? `#song=${encodeCreation(creation)}`
      : song.reference
        ? `#ref=${song.reference}`
        : `#seed=${song.seed}`,
  );
  loopToggle.setAttribute("aria-pressed", String(engine.loopSection !== null));
  if (creator.active && !engine.creation) setCreator(false);
  for (const b of originals)
    b.setAttribute("aria-pressed", String(b.dataset.reference === song.reference));

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
      b.addEventListener("click", () => selectSection(i));
      return b;
    }),
  );
  creator.decorateTimeline(ui.timeline);
  renderCue(engine.cuedBar);
  renderBar(song, Math.min(engine.currentBar, song.totalBars - 1));
}

/**
 * Marks where a switch waits for the next bar line: the bar in the piano roll, its section on the
 * timeline. Nothing waits in instant mode.
 */
function renderCue(bar: number | null): void {
  const cue = prefs.instant ? null : bar;
  roll.setCue(cue);
  const song = engine.song;
  const index =
    cue === null
      ? -1
      : song.sections.findIndex((s) => cue >= s.startBar && cue < s.startBar + s.bars);
  ui.timeline.querySelectorAll<HTMLElement>(".sec").forEach((b, i) => {
    b.classList.toggle("cued", i === index);
  });
}

// ── My songs list ─────────────────────────────────────────────────────────────────────────────

const songList = el<HTMLUListElement>("song-list");
const songsStatus = el("songs-status");
const saveButton = el<HTMLButtonElement>("save-song");
const shareButton = el<HTMLButtonElement>("share");
const dateFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function when(at: number): string {
  const d = new Date(at);
  return d.toDateString() === new Date().toDateString()
    ? timeFormat.format(d)
    : dateFormat.format(d);
}

function renderSongs(): void {
  const songs = library.list();
  const current = currentEntry();
  el("songs-count").textContent = songs.length ? String(songs.length) : "";
  el("songs-empty").hidden = songs.length > 0;
  songList.replaceChildren(
    ...songs.map((entry) => {
      const li = document.createElement("li");
      li.className = "song-row";
      if (entry.id === current?.id) li.setAttribute("aria-current", "true");
      const play = document.createElement("button");
      play.type = "button";
      play.className = "song-play";
      play.title = `Play “${entry.title}”`;
      const title = document.createElement("span");
      title.className = "song-name";
      title.textContent = entry.title;
      const meta = document.createElement("span");
      meta.className = "song-meta";
      meta.textContent = `${entry.summary} · ${when(entry.updated)}`;
      play.append(title, meta);
      play.addEventListener("click", () => void playSaved(entry.id));
      const link = document.createElement("button");
      link.type = "button";
      link.className = "btn small";
      link.textContent = "⤴";
      link.title = `Copy a link to “${entry.title}”`;
      link.setAttribute("aria-label", link.title);
      link.addEventListener("click", () => {
        const creation = library.creation(entry.id);
        if (creation) void share(link, shareUrl(engine.song, creation));
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn small";
      remove.textContent = "×";
      remove.title = `Delete “${entry.title}” from My songs`;
      remove.setAttribute("aria-label", remove.title);
      remove.addEventListener("click", () => deleteSaved(entry.id));
      li.append(play, link, remove);
      return li;
    }),
  );
  const saved = !!current;
  saveButton.setAttribute("aria-pressed", String(saved));
  saveButton.textContent = saved ? "♥ Saved" : "♡ Save";
  saveButton.title = engine.creation
    ? "Creations keep themselves in My songs"
    : saved
      ? "In My songs: click to remove it"
      : "Keep this song in My songs";
  if (library.failed) songsStatus.textContent = "This browser won’t store songs: use Share links.";
}

/** Plays a saved song (starting playback: the click allows it). */
async function playSaved(id: string): Promise<void> {
  const creation = library.creation(id);
  if (!creation) return;
  engine.playCustom(creation);
  if (!engine.playing) await togglePlay();
}

function deleteSaved(id: string): void {
  const gone = library.remove(id);
  if (!gone) return;
  renderSongs();
  songsStatus.replaceChildren(`Deleted “${gone.title}”. `);
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "link";
  undo.textContent = "Undo";
  undo.addEventListener("click", () => {
    library.restore(gone);
    songsStatus.textContent = "";
    renderSongs();
  });
  songsStatus.append(undo);
}

saveButton.addEventListener("click", () => {
  const song = engine.song;
  if (engine.creation) return; // already kept
  const existing = library.findFrom(songOrigin(song));
  if (existing) deleteSaved(existing.id);
  else {
    library.save(
      { seed: song.seed, spec: songToSpec(song) },
      songSummary(song.key, song.bpm, song.totalBars),
      songOrigin(song),
    );
    songsStatus.textContent = `Saved “${song.title}”.`;
    renderSongs();
  }
});
shareButton.addEventListener(
  "click",
  () => void share(shareButton, shareUrl(engine.song, engine.creation)),
);

const switchMode = el<HTMLSelectElement>("switch-mode");
switchMode.value = prefs.instant ? "instant" : "bar";
switchMode.addEventListener("change", () => {
  prefs.instant = switchMode.value === "instant";
  savePrefs();
  engine.setInstant(prefs.instant);
  renderCue(engine.cuedBar);
});

const leadSelect = el<HTMLSelectElement>("lead-sound");
leadSelect.value = prefs.lead;
engine.setLeadPatch(prefs.lead);
leadSelect.addEventListener("change", () => {
  prefs.lead = LEAD_PATCHES.find((l) => l === leadSelect.value) ?? "voice";
  savePrefs();
  engine.setLeadPatch(prefs.lead);
});

const playbackSelect = el<HTMLSelectElement>("playback");
const bufferSelect = el<HTMLSelectElement>("buffer");
const autoPlayback = playbackSelect.querySelector<HTMLOptionElement>('option[value="auto"]');
if (autoPlayback) autoPlayback.textContent = `auto (${AUTO_AHEAD ? "render ahead" : "live"} here)`;
const autoBuffer = bufferSelect.querySelector<HTMLOptionElement>('option[value="0"]');
if (autoBuffer) autoBuffer.textContent = `auto (${AUTO_BUFFER} s here)`;
if (!AHEAD_SUPPORTED) {
  playbackSelect.disabled = true;
  playbackSelect.title = "This browser can't render ahead (no AudioWorklet)";
}
function applyPlayback(): void {
  const ahead = prefs.playback === "ahead" || (prefs.playback === "auto" && AUTO_AHEAD);
  playbackSelect.value = prefs.playback;
  bufferSelect.value = String(prefs.buffer);
  bufferSelect.disabled = !ahead || !AHEAD_SUPPORTED;
  engine.setBufferSeconds(prefs.buffer || AUTO_BUFFER);
  engine.setRenderAhead(ahead);
}
applyPlayback();
playbackSelect.addEventListener("change", () => {
  prefs.playback = PLAYBACKS.find((x) => x === playbackSelect.value) ?? "auto";
  savePrefs();
  applyPlayback();
});
bufferSelect.addEventListener("change", () => {
  prefs.buffer = BUFFERS.find((x) => x === Number(bufferSelect.value)) ?? 0;
  savePrefs();
  applyPlayback();
});

/** While rendering ahead: how far ahead it is, or that playback waits for it. */
const bufferStatus = el<HTMLSpanElement>("buffer-status");
function renderBufferStatus(): void {
  const status = engine.aheadStatus;
  bufferStatus.hidden = !status;
  if (!status) return;
  bufferStatus.classList.toggle("waiting", status.buffering);
  bufferStatus.textContent = status.buffering
    ? "Rendering…"
    : `${Math.floor(status.seconds)} s rendered ahead`;
}
setInterval(renderBufferStatus, 500);

// Lite or full sound is set up when the page loads (quality.ts), so a change reloads the page.
const qualitySelect = el<HTMLSelectElement>("quality");
const autoQuality = qualitySelect.querySelector<HTMLOptionElement>('option[value="auto"]');
if (autoQuality) autoQuality.textContent = `auto (${DEVICE_QUALITY} here)`;
qualitySelect.value = QUALITY_FROM_URL ? QUALITY : QUALITY_CHOICE;
if (QUALITY_FROM_URL) {
  qualitySelect.disabled = true;
  qualitySelect.title = `Set to ${QUALITY} by ?quality= in the address`;
}
qualitySelect.addEventListener("change", () => {
  const v = qualitySelect.value;
  saveQualityChoice(v === "full" || v === "lite" ? v : "auto");
  location.reload();
});

function renderBar(song: Song, bar: number): void {
  media.setPosition(song, bar);
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
  shownSection = sectionIndex;
  const current = inSection % section.progression.length;
  if (creator.active) creator.show(sectionIndex, bar);
  else
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
  renderSectionDetail(song, sectionIndex);
  roll.show(song, bar, engine.playing);

  ui.timeline.querySelectorAll<HTMLElement>(".sec").forEach((node, i) => {
    node.classList.toggle("active", i === sectionIndex);
    node.classList.toggle("done", i < sectionIndex);
    const fill = node.querySelector<HTMLElement>(".fill");
    if (fill && i === sectionIndex) fill.style.width = `${((inSection + 1) / section.bars) * 100}%`;
    else if (fill && i > sectionIndex) fill.style.width = "0";
  });
}

const DRUM_LABELS: Record<DrumMode, string> = {
  off: "no drums",
  kick: "kick only",
  half: "half-time drums",
  full: "full drums",
  big: "big drums",
  groove: "intro groove",
  breakdown: "breakdown drums (no snare)",
  hats16: "drums with 16th hats",
  stab: "one stab on beat 2",
};

function renderSectionDetail(song: Song, index: number): void {
  const section = song.sections[index];
  if (!section) return;
  const next = song.sections[index + 1];
  const parts = [
    `${section.bars} bars`,
    keyName(section.key),
    DRUM_LABELS[section.layers.drums],
    `next: ${next ? `${next.label} (${next.bars})` : engine.creation ? "back to the start" : "the next song"}`,
  ];
  ui.sectionDetail.innerHTML = "<b></b> · ";
  const name = ui.sectionDetail.querySelector("b");
  if (name) name.textContent = section.label;
  ui.sectionDetail.append(parts.join(" · "));
}

function renderKitStatus(): void {
  if (!Object.keys(engine.samples).length) {
    ui.kitStatus.textContent = "Drum samples load on first play: from this site, else from GitHub.";
    return;
  }
  const kits = Object.entries(engine.samples);
  const count = (key: "local" | "remote") => kits.reduce((n, [, r]) => n + r[key], 0);
  const missing = kits.filter(([, r]) => r.missing.length);
  const lines = [
    count("local") && !count("remote") && !missing.length ? "All drum samples loaded locally." : "",
    count("remote")
      ? `${count("remote")} drum sample(s) from GitHub (\`pnpm fetch-samples\` keeps them on this site).`
      : "",
    missing.length
      ? `Synthesized instead of ${missing.reduce((n, [, r]) => n + r.missing.length, 0)} sample(s) neither place had: ${missing
          .map(([kit, r]) => `${KIT_LABELS[kit as KitName]}: ${r.missing.join(", ")}`)
          .join("; ")}.`
      : "",
  ];
  ui.kitStatus.textContent = lines.filter(Boolean).join(" ");
}

// ── Controls ──────────────────────────────────────────────────────────────────────────────────

ui.genre.append(new Option("Auto (a genre per song)", "auto"));
for (const id of GENRE_IDS) ui.genre.append(new Option(GENRES[id].name, id));
ui.genre.value = prefs.genre;
ui.genre.addEventListener("change", () => {
  const value = ui.genre.value;
  if (value !== "auto" && !isGenreId(value)) return;
  prefs.genre = value;
  padGenre = value === "auto" ? engine.song.genre : value;
  // Another genre has other references: its polygon starts from the centre.
  if (value !== "auto") prefs.weights = centreWeights(value);
  stylePad = newStylePad();
  showStylePad();
  showTempoHint();
  savePrefs();
  engine.update({
    genre: prefs.genre,
    weights: styleIsAuto() ? null : prefs.weights,
  });
});

/** Whether the style point is picked per song: by choice, or because the genre is. */
function styleIsAuto(): boolean {
  return prefs.styleAuto || prefs.genre === "auto";
}

/** The auto tempo's range and where the genre's records sit. */
function showTempoHint(): void {
  const { range, note } = GENRES[padGenre].tempo;
  const genre = prefs.genre === "auto" ? `${GENRES[padGenre].name} now: ` : "";
  ui.bpmHint.textContent = `Auto (varies per song, ${genre}${range[0]}–${range[1]}; ${note})`;
}

/** The style polygon for the genre the pad shows: a triangle for three references, a slider for
 * two. */
function newStylePad(): BlendPad {
  const genre = padGenre;
  return new BlendPad({
    names: refNames(genre),
    weights: prefs.weights,
    label: "Style",
    onInput: (w) => (ui.styleOut.value = weightsLabel(genre, w)),
    onChange: (w) => {
      ui.styleOut.value = weightsLabel(genre, w);
      prefs.weights = w;
      savePrefs();
      engine.update({ weights: prefs.weights });
    },
  });
}

/** Shows the style polygon in place of the one before. With the genre picked per song, the point
 * is too, so the pad only shows it. */
function showStylePad(): void {
  ui.stylePad.replaceChildren(stylePad.element);
  stylePad.disabled = styleIsAuto();
  ui.styleAuto.disabled = prefs.genre === "auto";
  ui.styleAuto.checked = styleIsAuto();
  ui.styleOut.value = styleIsAuto() ? "" : weightsLabel(padGenre, prefs.weights);
}

/** The genre the style pad and tempo hint show: the chosen one, or with auto the current song's. */
let padGenre: GenreId = prefs.genre === "auto" ? DEFAULT_GENRE : prefs.genre;
let stylePad = newStylePad();
showStylePad();
showTempoHint();
ui.styleAuto.addEventListener("change", () => {
  prefs.styleAuto = ui.styleAuto.checked;
  // Overriding starts from the point the pad shows (the current song's).
  if (!prefs.styleAuto) prefs.weights = stylePad.weights;
  stylePad.disabled = prefs.styleAuto;
  savePrefs();
  engine.update({ weights: prefs.styleAuto ? null : prefs.weights });
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
  if (!prefs.bpmAuto) prefs.bpm = Number(ui.bpm.value);
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
for (const b of originals) {
  b.addEventListener("click", () => {
    const id = b.dataset.reference;
    if (isReferenceId(id)) engine.playReference(id);
  });
}

// A MIDI file the user picks can drive any instrument while an original plays: each mixer row
// switches between the generated part and the MIDI, and picks which of the file's tracks it
// follows. The file stays in the page; the app never stores it.
const midiFile = el<HTMLInputElement>("midi-file");
const midiStatus = el("midi-status");
let midi: MidiFile | null = null;
let midiTarget: ReferenceId = "true-faith";
const midiChoice = new Map<Track, { on: boolean; tracks: number[] }>();
const midiControls = new Map<
  Track,
  { line: HTMLElement; toggle: HTMLButtonElement; select: HTMLSelectElement }
>();
const ALL_DRUMS = "all-drums";

function selectedTracks(value: string): number[] {
  if (!midi || value === "") return [];
  if (value === ALL_DRUMS) return midi.tracks.flatMap((m, i) => (m.channel === 9 ? [i] : []));
  return [Number(value)];
}

function applyMidi(): void {
  if (!midi) return;
  const file = midi;
  const imported: ImportedTracks = { notes: {} };
  const following: string[] = [];
  for (const t of TRACKS) {
    const choice = midiChoice.get(t);
    if (!choice?.on) continue;
    const tracks = choice.tracks.flatMap((i) => file.tracks[i] ?? []);
    if (t === "drums") imported.drums = toDrumBars(tracks, file.ticksPerBeat);
    else imported.notes = { ...imported.notes, [t]: mergeBars(tracks, file.ticksPerBeat, t) };
    following.push(TRACK_LABELS[t]);
  }
  engine.setImported(midiTarget, following.length ? imported : null);
  midiStatus.textContent = `${REFERENCES[midiTarget].title}: ${
    following.length ? `MIDI for ${following.join(", ")}` : "all generated"
  }`;
}

function midiLine(t: Track): HTMLElement {
  const line = document.createElement("div");
  line.className = "mix-midi";
  line.hidden = true;
  const sw = toggle("MIDI", "midi", false, `${TRACK_LABELS[t]}: generated ↔ MIDI`, (on) => {
    midiChoice.set(t, { tracks: [], ...midiChoice.get(t), on });
    applyMidi();
  });
  const select = document.createElement("select");
  select.setAttribute("aria-label", `MIDI track for ${TRACK_LABELS[t]}`);
  select.addEventListener("change", () => {
    midiChoice.set(t, { on: true, tracks: selectedTracks(select.value) });
    sw.setAttribute("aria-pressed", "true");
    applyMidi();
  });
  line.append(sw, select);
  midiControls.set(t, { line, toggle: sw, select });
  return line;
}

function loadMidi(file: MidiFile): void {
  midi = file;
  midiTarget = engine.song.reference ?? "true-faith";
  const match = matchTracks(file);
  const drumTracks = file.tracks.filter((m) => m.channel === 9).length;
  for (const t of TRACKS) {
    const controls = midiControls.get(t);
    if (!controls) continue;
    const options = [new Option("None (silent)", "")];
    if (t === "drums" && drumTracks > 1) options.push(new Option("All drum tracks", ALL_DRUMS));
    file.tracks.forEach((m, i) =>
      options.push(new Option(`${m.name || `Track ${i + 1}`} (${m.notes.length})`, String(i))),
    );
    controls.select.replaceChildren(...options);
    const found = match[t];
    const value = !found ? "" : t === "drums" && found.length > 1 ? ALL_DRUMS : String(found[0]);
    controls.select.value = value;
    midiChoice.set(t, { on: !!found, tracks: selectedTracks(value) });
    controls.toggle.setAttribute("aria-pressed", String(!!found));
    controls.line.hidden = false;
  }
  applyMidi();
}

midiFile.addEventListener("change", () => {
  const file = midiFile.files?.[0];
  if (!file) return;
  void file
    .arrayBuffer()
    .then((buffer) => loadMidi(parseMidi(buffer)))
    .catch((e: unknown) => {
      midiStatus.textContent = `Couldn't read that MIDI file: ${String(e)}`;
    });
});

document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  if (
    target &&
    (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable) &&
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

/** Each track's level now: by hand, or the playing song's mix (each part's, at its blend) while
 * on auto. */
function trackVolumes(): Record<Track, number> {
  const auto = autoVolumes(songSound(engine.song).mix);
  return Object.fromEntries(
    TRACKS.map((t) => [t, prefs.manual.includes(t) ? prefs.volumes[t] : auto[t]]),
  ) as Record<Track, number>;
}

function applyMixer(): void {
  const volumes = trackVolumes();
  // The auto faders show the level they follow, and can't be dragged.
  for (const t of TRACKS) {
    const slider = sliders.get(t);
    if (!slider) continue;
    const auto = !prefs.manual.includes(t);
    slider.disabled = auto;
    if (auto) slider.value = String(volumes[t]);
  }
  engine.setMix({
    manual: Object.fromEntries(prefs.manual.map((t) => [t, prefs.volumes[t]])),
    muted: [...prefs.muted],
    soloed: [...soloed],
    master: prefs.master,
  });
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

const muteButtons = new Map<Track, HTMLButtonElement>();
const soloButtons: HTMLButtonElement[] = [];

for (const t of TRACKS) {
  // On auto, the fader follows the genre's mix; off, it stays where it's put, starting from the
  // level it was following.
  const auto = toggle(
    "A",
    "auto",
    !prefs.manual.includes(t),
    `${TRACK_LABELS[t]}: auto level (the genre's mix). Off to set it by hand`,
    (on) => {
      if (on) prefs.manual = prefs.manual.filter((m) => m !== t);
      else {
        prefs.volumes[t] = trackVolumes()[t];
        prefs.manual = [...prefs.manual, t];
      }
      savePrefs();
      applyMixer();
    },
  );
  autoButtons.set(t, auto);
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
  muteButtons.set(t, mute);
  soloButtons.push(solo);
  const row = mixRow(
    TRACK_LABELS[t],
    prefs.volumes[t],
    (v) => {
      prefs.volumes[t] = v;
      savePrefs();
      applyMixer();
    },
    [auto, mute, solo],
  );
  sliders.set(t, row.querySelector("input")!);
  ui.mixer.append(row, midiLine(t));
}
const master = mixRow("Master", prefs.master, (v) => {
  prefs.master = v;
  savePrefs();
  applyMixer();
});
master.classList.add("master");
sliders.set("master", master.querySelector("input")!);
ui.mixer.append(master);

ui.mixerReset.addEventListener("click", () => {
  prefs.volumes = { ...DEFAULT_VOLUMES };
  prefs.manual = [];
  prefs.master = 0;
  prefs.muted = [];
  soloed.clear();
  savePrefs();
  for (const t of TRACKS) {
    autoButtons.get(t)!.setAttribute("aria-pressed", "true");
    muteButtons.get(t)!.setAttribute("aria-pressed", "false");
  }
  sliders.get("master")!.value = "0";
  for (const b of soloButtons) b.setAttribute("aria-pressed", "false");
  applyMixer();
});

// ── Go ────────────────────────────────────────────────────────────────────────────────────────

const linked = initialCreation ? decodeCreation(initialCreation) : null;
if (linked) {
  // A link to a song already in My songs (or a reload) carries on as that entry.
  const known = initialCreation ? library.findData(initialCreation) : undefined;
  engine.playCustom(known ? { ...linked, id: known.id } : linked);
  setCreator(true);
} else if (isReferenceId(initialReference)) engine.playReference(initialReference);
else renderSong(engine.song);
renderKitStatus();
autoplay();
startVisualizer(ui.viz, () => engine.analysers);

if (SHOW_AUDIO_STATS) mountAudioStats();

// ── Footer: which build this is ─────────────────────────────────────────────────────────────

declare const __BUILD__: { commit: string | null; time: string | null };

function renderBuildInfo(): void {
  const el = document.getElementById("build-info");
  if (!el) return;
  const { commit, time } = __BUILD__;
  if (commit) {
    const link = document.createElement("a");
    link.href = `https://github.com/nicolas-maitre/infinite-synthpop/commit/${commit}`;
    link.textContent = commit.slice(0, 7);
    link.title = "The commit this build was made from";
    el.append("Version ", link);
  } else el.append("Version unknown");
  if (time) {
    const date = new Date(time);
    const stamp = document.createElement("time");
    stamp.dateTime = time;
    stamp.textContent = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    el.append(" · deployed ", stamp);
  } else el.append(" · dev server");
}
renderBuildInfo();

// Brief tab switches don't need it; a locked screen does (Engine.wake).
const WAKE_AFTER_HIDDEN_MS = 1000;
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = performance.now();
  else if (performance.now() - hiddenAt > WAKE_AFTER_HIDDEN_MS) void engine.wake();
});

if (import.meta.env.DEV) {
  void Promise.all([import("tone"), import("./render")]).then(([Tone, { renderToDisk }]) =>
    Object.assign(window, { engine, Tone, renderToDisk, roll }),
  );
}
