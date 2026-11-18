import "./style.css";
import { chordSlots } from "./arranger";
import {
  CHORDS_MODES,
  type BassStyle,
  type DrumMode,
  type ImportedTracks,
  type KitName,
  type LengthRange,
  type Song,
} from "./composer";
import { parseSeedLink, seedLink } from "./links";
import { KIT_LABELS } from "./drums";
import { AHEAD_SUPPORTED } from "./ahead";
import { Engine, type EngineSettings } from "./engine";
import {
  autoVolumes,
  DEFAULT_VOLUMES,
  LEAD_PATCHES,
  TRACK_LABELS,
  TRACKS,
  type Track,
} from "./instruments";
import { matchTracks, mergeBars, parseMidi, toDrumBars, type MidiFile } from "./midi";
import { mountCreator } from "./creator";
import { Library, type SavedSong } from "./library";
import { History, type HistoryEntry, type NewEntry } from "./history";
import { assignMelody, nextMelodyName } from "./melodies";
import { Recorder } from "./recorder";
import { download, exportAudio, fileName, songToMidi } from "./export";
import { PianoRoll } from "./pianoroll";
import { mountWizard } from "./wizard";
import { mountSimpleView, type SimpleGenre, type SimpleSettings } from "./simpleview";
import { LengthSlider } from "./lengthslider";
import { mountInspiration } from "./inspiration";
import { coverArtwork, songCover, storedCover } from "./coverart";
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
import { BlendPad, initials } from "./blendpad";
import { barAtSeconds, mountMediaControls } from "./mediasession";
import { blendsKey, isGenreBlends, REFERENCE_IDS, refsBlend, songSound } from "./profile";
import {
  blendRefsFor,
  centreFor,
  onPad,
  partBlend,
  PART_ROWS,
  PartRow,
  refChips,
  refsLabel,
} from "./blendpicker";
import {
  DEFAULT_GENRE,
  GENRE_IDS,
  GENRES,
  genreOfReference,
  isGenreId,
  isStyleWeights,
  styleName,
  type GenreId,
} from "./genres";
import {
  BUFFERS,
  centreWeights,
  DJ_STYLES,
  loadPrefs,
  PLAYBACKS,
  savePrefs as storePrefs,
  type View,
} from "./prefs";

/** Playback renders ahead wherever the browser can; phones (the lite guess) with a longer buffer. */
const AUTO_AHEAD = AHEAD_SUPPORTED;
const AUTO_BUFFER = DEVICE_QUALITY === "lite" ? 60 : 20;

/** Records further apart than this (BPM) get the tempo note. */
const TEMPO_SPREAD = 10;

const prefs = loadPrefs();
const savePrefs = () => storePrefs(prefs);
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
  progressions: el<HTMLSelectElement>("progressions"),
  genre: el<HTMLSelectElement>("genre"),
  openRefs: el("open-refs"),
  partsOn: el<HTMLInputElement>("parts-on"),
  partRows: el("part-rows"),
  tempoWarning: el("tempo-warning"),
  kitStatus: el("kit-status"),
  mixer: el("mixer-rows"),
  mixerReset: el<HTMLButtonElement>("mixer-reset"),
  sectionDetail: el("section-detail"),
};
const roll = new PianoRoll(el<HTMLCanvasElement>("roll"), (bar) => {
  engine.jumpTo(bar);
  if (!engine.playing) renderBar(engine.song, bar);
});

// ── Views: the simple player, or every control ──────────────────────────────────────────────

const simple = mountSimpleView(el("simple-view"), {
  togglePlay: () => void togglePlay(),
  previous: previousSong,
  next: nextSong,
  seek: (bar) => {
    engine.jumpTo(bar, true);
    if (!engine.playing) renderBar(engine.song, engine.currentBar);
  },
  setRepeat,
  setDj,
  mixNext: () => {
    engine.mixNext();
    renderMixNext();
  },
  setLite,
  setGenre: setSimpleGenre,
  setLength,
  setVolume,
  toggleSave,
  share: (button) => void share(button, shareUrl(engine.song, engine.creation)),
  playHistory: (id) => {
    const entry = played.get(id);
    if (entry) playEntry(entry, { start: true });
  },
  toggleHistorySaved,
  playFavourite: (id) => {
    const creation = library.creation(id);
    if (!creation) return;
    navigatingTo = null;
    engine.replaySong(creation.seed, creation.spec, true);
    fromLibrary = { playId: engine.playId, id };
    if (!engine.playing) void togglePlay();
  },
  shareFavourite: (id, button) => {
    const creation = library.creation(id);
    if (creation) void share(button, shareUrl(engine.song, creation));
  },
  removeFavourite: (id) => deleteSaved(id),
  playOriginal: (id) => {
    if (isReferenceId(id)) playOriginal(id);
  },
});

/** Plays one of the originals at once, starting playback (a click on it allows it). */
function playOriginal(id: ReferenceId): void {
  navigatingTo = null;
  engine.playReference(id, true);
  if (!engine.playing) void togglePlay();
}

const inspiration = mountInspiration(
  el("simple-view").querySelector(".inspiration")!,
  playOriginal,
);

/** The view showing. A creation link opens the advanced view for that visit without keeping it
 * (prefs.view is what was chosen). */
let currentView: View = prefs.view;
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-view]")];
const mixerCard = el("mixer-rows").closest<HTMLElement>(".card")!;
/** Where the mixer card sits in the advanced view, for when it comes back from the drawer. */
const mixerHome = document.createComment("mixer");
mixerCard.before(mixerHome);
const HINTS: Record<View, string> = {
  simple: "Space play/pause · ← → previous/next · M mix next · R repeat · F full screen",
  advanced: "Space play/stop · N random song · S skip section",
};

function showView(view: View): void {
  currentView = view;
  document.documentElement.dataset.view = view;
  for (const b of viewButtons) b.setAttribute("aria-pressed", String(b.dataset.view === view));
  el("hint").textContent = HINTS[view];
  // One mixer: in the simple view it opens under the volume.
  if (view === "simple") simple.mixerDrawer.append(mixerCard);
  else mixerHome.after(mixerCard);
  simple.setShown(view === "simple");
  if (view === "advanced") simple.setFullScreen(false);
  if (view === "simple" && creator.active) setCreator(false);
}

for (const b of viewButtons) {
  b.addEventListener("click", () => {
    const view = b.dataset.view === "advanced" ? "advanced" : "simple";
    prefs.view = view;
    savePrefs();
    showView(view);
  });
}

/** The simple view's switches and selects, from the settings. */
function renderSimpleSettings(): void {
  const custom =
    prefs.genre === "open" || prefs.partsOn || (prefs.genre !== "auto" && !prefs.styleAuto);
  const settings: SimpleSettings = {
    dj: prefs.dj && AHEAD_SUPPORTED,
    djUnavailable: AHEAD_SUPPORTED
      ? null
      : "This browser can't render ahead (no AudioWorklet), which DJ mode needs",
    repeat: prefs.repeat,
    lite: QUALITY === "lite",
    liteFixed: QUALITY_FROM_URL ? `Set to ${QUALITY} by ?quality= in the address` : null,
    genre: custom ? "custom" : prefs.genre === "open" ? "auto" : prefs.genre,
    length: prefs.length,
    volume: prefs.master,
  };
  simple.renderSettings(settings);
}

/** Mix next: in DJ mode, brings the next song in soon (Engine.mixNext). */
function renderMixNext(): void {
  const state = engine.mixState;
  simple.renderMixNext({
    shown: prefs.dj && AHEAD_SUPPORTED,
    enabled: engine.canMixNext,
    label: state === "soon" ? "Mixing soon…" : state === "mixing" ? "Mixing…" : "Mix next",
    title: !engine.playing
      ? "Mix into the next song (once playing)"
      : prefs.repeat
        ? "Repeat is on: the song plays again instead"
        : engine.creation
          ? "A creation loops: pick another song to move on"
          : state === "idle"
            ? "Mix into the next song now, beat-matched (M)"
            : "Mixing into the next song",
  });
}

/** The length setting, from either view's slider (lengthslider.ts). */
const advancedLength = new LengthSlider("length-label", setLength);
el("length").replaceWith(advancedLength.element);
advancedLength.set(prefs.length);

function setLength(range: LengthRange): void {
  prefs.length = range;
  savePrefs();
  engine.setLength(range);
  advancedLength.set(range);
  renderSimpleSettings();
}

/** Lite or full sound is set up when the page loads (quality.ts), so a change reloads the page. */
function setLite(on: boolean): void {
  saveQualityChoice(on ? "lite" : DEVICE_QUALITY === "lite" ? "full" : "auto");
  location.reload();
}

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
  // A blend across genres or per part says more than the genre and weights.
  const blends = isGenreBlends(song.blends, GENRES[song.genre], song.weights)
    ? ""
    : `/b${blendsKey(song.blends)}`;
  // Classic songs keep the form they had before the theory generator.
  const chords = song.chords === "theory" ? "/theory" : "";
  return song.reference
    ? `ref:${song.reference}`
    : `seed:${song.seed}/${genre}${style}/${song.key.tonic}/${song.bpm}/${song.kit}${blends}${chords}`;
}

/** The library entry for what's playing, if it has one. */
function currentEntry(): SavedSong | undefined {
  const id =
    engine.creation?.id ?? (fromLibrary?.playId === engine.playId ? fromLibrary.id : undefined);
  return (id ? library.get(id) : undefined) ?? library.findFrom(songOrigin(engine.song));
}

// ── Previous songs (history.ts): what was heard, for the list and Previous / Next ─────────────

const played = new History(storage());
/** The favourite (My songs entry) playing back, by the playing it started. */
let fromLibrary: { playId: number; id: string } | null = null;
/** The history entry of what plays, and the playing (Engine.playId) it was recorded for. */
let playingEntry: string | null = null;
let recordedPlay = -1;
/** Previous / Next walk the history: the entry about to play, so it isn't recorded again. */
let navigatingTo: string | null = null;

/** What the history keeps of a song: enough to play it again exactly. */
function historyEntry(song: Song): NewEntry {
  const creation = engine.creation ?? { seed: song.seed, spec: songToSpec(song) };
  const saved = currentEntry()?.id;
  return {
    title: song.title,
    summary: [
      song.reference ? "Original" : GENRES[song.genre].name,
      keyName(song.key),
      `${song.bpm} BPM`,
    ].join(" · "),
    data: encodeCreation(creation),
    origin: songOrigin(song),
    ...(song.reference && { reference: song.reference }),
    ...(saved && { saved }),
  };
}

/** A bar is heard: the first of a new playing goes in the history (unless Previous / Next
 * brought back one already there). */
function noteHeard(): void {
  if (engine.playId === recordedPlay) return;
  recordedPlay = engine.playId;
  if (navigatingTo && played.get(navigatingTo)) playingEntry = navigatingTo;
  else playingEntry = played.record(historyEntry(engine.song)).id;
  navigatingTo = null;
  renderSongs();
}

/** The playing song changed in place (a setting recomposed it): its entry follows. */
function noteRecomposed(song: Song): void {
  if (playingEntry && engine.playId === recordedPlay)
    played.update(playingEntry, historyEntry(song));
}

/** Plays a history entry again: at once, starting playback when asked (a click on the list).
 * With `navigate` (Previous / Next) it plays as that entry instead of being recorded anew. */
function playEntry(entry: HistoryEntry, opts: { navigate?: boolean; start?: boolean }): void {
  const now = currentView === "simple";
  navigatingTo = opts.navigate ? entry.id : null;
  fromLibrary = null;
  if (entry.reference) engine.playReference(entry.reference, now);
  else {
    const creation = decodeCreation(entry.data);
    if (!creation) return;
    engine.replaySong(creation.seed, creation.spec, now);
    if (entry.saved && library.get(entry.saved))
      fromLibrary = { playId: engine.playId, id: entry.saved };
  }
  if (opts.start && !engine.playing) void togglePlay();
}

/** The history entry of what plays, once it has been heard. */
function heardEntry(): string | null {
  return engine.playId === recordedPlay ? playingEntry : null;
}

/** The My songs entry a history entry is (♥ on its row). */
function savedFor(entry: HistoryEntry): SavedSong | undefined {
  return (
    (entry.saved ? library.get(entry.saved) : undefined) ??
    (entry.origin ? library.findFrom(entry.origin) : undefined)
  );
}

function toggleHistorySaved(id: string): void {
  const entry = played.get(id);
  if (!entry) return;
  const saved = savedFor(entry);
  if (saved) {
    deleteSaved(saved.id);
    return;
  }
  const creation = decodeCreation(entry.data);
  if (!creation) return;
  const { key, bpm, sections } = creation.spec;
  const bars = sections.reduce((n, s) => n + s.bars, 0);
  library.save(creation, songSummary(key, bpm, bars), entry.origin);
  simple.renderListStatus(`Saved “${entry.title}” to Favourites.`);
  renderSongs();
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
  if (engine.playing || engine.paused) engine.stop();
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

/** The original a My songs entry was kept from ("ref:true-faith"), if it was one. */
function originalOf(from: string | undefined): ReferenceId | undefined {
  const id = from?.startsWith("ref:") ? from.slice(4) : null;
  return isReferenceId(id) ? id : undefined;
}

function isReferenceId(id: string | null | undefined): id is ReferenceId {
  return !!id && id in REFERENCES;
}

// ── Engine ────────────────────────────────────────────────────────────────────────────────────

function engineSettings(): EngineSettings {
  return {
    // An open blend plays across genres: its blend (or, on auto, a point of its references'
    // polygon per song) overrides the genre.
    genre: prefs.genre === "open" ? DEFAULT_GENRE : prefs.genre,
    weights: prefs.genre === "open" || styleIsAuto() ? null : prefs.weights,
    blend:
      prefs.genre === "open" && !prefs.styleAuto ? refsBlend(prefs.openRefs, prefs.weights) : null,
    blendRefs: prefs.genre === "open" && prefs.styleAuto ? prefs.openRefs : null,
    parts: prefs.partsOn
      ? Object.fromEntries(Object.entries(prefs.parts).map(([part, v]) => [part, partBlend(v)]))
      : null,
    key: prefs.key === null ? null : { tonic: prefs.key, mode: "minor" },
    bpm: prefs.bpmAuto ? null : prefs.bpm,
    kit: prefs.kit,
    chords: prefs.progressions,
    length: prefs.length,
  };
}

const hash = new URLSearchParams(location.hash.slice(1));
// A `#seed=` link plays its own progressions (classic when it doesn't say); later songs follow the
// setting.
const initialLink = parseSeedLink(hash);
const initialReference = hash.get("ref");
const initialCreation = hash.get("song");
// The system's media controls (lock screen, Now Playing, media keys): mediasession.ts.
const media = mountMediaControls({
  play: () => {
    if (!engine.playing) void togglePlay();
  },
  pause: () => engine.pause(),
  next: () => nextSong(),
  previous: () => previousSong(),
  seekTo: (seconds) => engine.jumpTo(barAtSeconds(engine.song, seconds), currentView === "simple"),
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
  initialLink?.seed ?? randomSeed(),
  {
    onSong: renderSong,
    onBar: (ev, song) => {
      noteHeard();
      renderBar(song, ev.bar);
      renderMixNext();
    },
    onStateChange: (playing) => {
      media.setPlaying(playing);
      renderPlayState({ playing });
    },
    onCue: renderCue,
    onBuffering: renderBufferStatus,
    onMix: renderMix,
  },
  initialLink?.chords,
);
engine.setInstant(prefs.instant);
engine.setRepeat(prefs.repeat);

/** The play buttons (both views): play or stop, or how far loading has got. */
function renderPlayState(state: { playing: boolean } | { loading: string }): void {
  const loading = "loading" in state;
  ui.play.disabled = loading;
  // The first start loads the synths and ~36 drum samples: a spinner, then a count.
  ui.play.classList.toggle("loading", loading);
  if (loading) ui.play.textContent = state.loading;
  else {
    ui.play.textContent = state.playing ? "■ Stop" : "▶ Play";
    ui.play.setAttribute("aria-pressed", String(state.playing));
  }
  simple.renderPlayState(state);
  renderMixNext();
}

async function togglePlay(): Promise<void> {
  if (engine.playing) {
    // The player pauses, keeping its place and what is rendered ahead; the advanced view stops.
    if (currentView === "simple") engine.pause();
    else engine.stop();
    return;
  }
  if (engine.paused) {
    media.activate();
    await engine.start();
    return;
  }
  renderPlayState({ loading: "Loading…" });
  // Before any await, while the click still counts as a gesture.
  media.activate();
  try {
    await engine.start((done, total) => {
      renderPlayState({ loading: `Loading ${Math.round((done / total) * 100)}%` });
    });
    applyMixer();
    renderKitStatus();
  } catch (error) {
    // Not left on "Loading…": the button works again, and the console says why it failed.
    console.error("Couldn't start playback", error);
  } finally {
    renderPlayState({ playing: engine.playing });
  }
}

/** Next: a new song (in the simple view at once, as a player does; in the advanced view as the
 * Switch setting says). */
function nextSong(): void {
  const at = heardEntry();
  const newer = at ? played.newer(at) : undefined;
  if (newer) {
    playEntry(newer, { navigate: true });
    return;
  }
  navigatingTo = null;
  engine.newSong(randomSeed(), currentView === "simple");
}

/** Previous: back to the start of the song. */
function previousSong(): void {
  const at = heardEntry();
  const older = at ? played.older(at) : undefined;
  // Past its first couple of bars (about 4 s), a song starts again first.
  if (older && engine.currentBar <= 2) playEntry(older, { navigate: true });
  else engine.jumpTo(0, currentView === "simple");
}

function setRepeat(on: boolean): void {
  prefs.repeat = on;
  savePrefs();
  engine.setRepeat(on);
  renderSimpleSettings();
  renderMixNext();
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
    if (e.target instanceof Element && e.target.closest("#play, #s-play")) return;
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
  noteRecomposed(song);
  // A new song may be in another genre, with its own mix for the auto faders.
  applyMixer();
  simple.renderSong(song);
  inspiration.render(song);
  media.setSong(song, GENRES[song.genre].name);
  void coverArtwork(songCover(song)).then(
    (art) => media.setArtwork(song, art),
    () => {
      // Not drawn (no canvas): the app's icon stays.
    },
  );
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
  // Genre auto: the pad and the tempo hint follow each song's references.
  if (prefs.genre === "auto" && !onPad(song.blends.song, padRefs)) {
    padRefs = blendRefsFor(song.blends.song, song.genre);
    stylePad = newStylePad();
    showStylePad();
    showTempoHint();
  }
  // Auto: the pad shows where this song's point landed (when the song is on the pad).
  if (styleIsAuto() && onPad(song.blends.song, padRefs)) {
    const w = padRefs.map((r) => song.blends.song[r] ?? 0);
    stylePad.setWeights(w);
    ui.styleOut.value = song.reference ? REFERENCES[song.reference].title : refsLabel(padRefs, w);
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
        : seedLink(song.seed, song.chords),
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
  simple.renderSaved(saved || !!engine.creation, engine.song.title);
  renderSimpleLists(current);
  if (library.failed) songsStatus.textContent = "This browser won’t store songs: use Share links.";
}

/** The simple view's lists: previous songs, favourites (My songs) and the originals. */
function renderSimpleLists(current: SavedSong | undefined): void {
  const heard = heardEntry();
  simple.renderLists({
    history: played.list().map((e) => ({
      id: e.id,
      title: e.title,
      meta: `${e.summary} · ${when(e.at)}`,
      current: e.id === heard,
      saved: !!savedFor(e),
      cover: storedCover(e.data, e.reference),
    })),
    favourites: library.list().map((s) => ({
      id: s.id,
      title: s.title,
      meta: s.summary,
      current: s.id === current?.id,
      // An original kept with ♥ shows its own sleeve.
      cover: storedCover(s.data, originalOf(s.from)),
    })),
    originals: REFERENCE_IDS.map((id) => {
      const ref = REFERENCES[id];
      return {
        id,
        title: ref.title,
        meta: `${GENRES[genreOfReference(id)].name} · ${keyName(ref.key)} · ${ref.bpm} BPM`,
        current: engine.song.reference === id,
        cover: { reference: id },
      };
    }),
  });
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
  simple.renderListStatus(`Removed “${gone.title}” from Favourites.`, () => {
    library.restore(gone);
    songsStatus.textContent = "";
    renderSongs();
  });
}

/** ♡ Save: keeps the playing song in My songs, or takes it out again. */
function toggleSave(): void {
  const song = engine.song;
  if (engine.creation) return; // already kept
  const existing = currentEntry();
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
}
saveButton.addEventListener("click", toggleSave);
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
const djStyleSelect = el<HTMLSelectElement>("dj-style");
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
  // DJ mode renders ahead whatever the Playback setting says.
  bufferSelect.disabled = !(ahead || prefs.dj) || !AHEAD_SUPPORTED;
  engine.setBufferSeconds(prefs.buffer || AUTO_BUFFER);
  engine.setRenderAhead(ahead);
  engine.setDjStyle(prefs.djStyle);
  engine.setDj(prefs.dj && AHEAD_SUPPORTED);
  djStyleSelect.value = prefs.djStyle;
  djStyleSelect.disabled = !prefs.dj || !AHEAD_SUPPORTED;
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

const djBox = el<HTMLInputElement>("dj");
djBox.checked = prefs.dj;
if (!AHEAD_SUPPORTED) {
  djBox.disabled = true;
  djBox.parentElement!.title =
    "This browser can't render ahead (no AudioWorklet), which DJ mode needs";
}
function setDj(on: boolean): void {
  prefs.dj = on;
  djBox.checked = on;
  savePrefs();
  applyPlayback();
  renderSimpleSettings();
  renderMixNext();
}
djBox.addEventListener("change", () => setDj(djBox.checked));
djStyleSelect.addEventListener("change", () => {
  prefs.djStyle = DJ_STYLES.find((x) => x === djStyleSelect.value) ?? "auto";
  savePrefs();
  applyPlayback();
});

/** DJ mode: the transition being heard, and the song it mixes into. */
const mixStatus = el<HTMLParagraphElement>("mix-status");
function renderMix(mix: { label: string; next: Song } | null): void {
  mixStatus.hidden = !mix;
  mixStatus.textContent = mix ? `${mix.label} → ${mix.next.title}` : "";
  simple.renderMix(mix ? mixStatus.textContent : null);
  renderMixNext();
}

/** While rendering ahead: how far ahead it is, or that playback waits for it. */
const bufferStatus = el<HTMLSpanElement>("buffer-status");
function renderBufferStatus(): void {
  const status = engine.aheadStatus;
  bufferStatus.hidden = !status;
  // The simple view only says when playback waits for the render.
  simple.renderBuffer(status?.buffering ? { text: "Rendering…", waiting: true } : null);
  simple.renderBuffered(status ? status.seconds : null);
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
  simple.renderBar(song, bar, engine.mixOut);
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
ui.genre.append(new Option("Open (pick references)", "open"));
ui.genre.value = prefs.genre;
ui.genre.addEventListener("change", () => {
  const value = ui.genre.value;
  if (value === "auto" || value === "open" || isGenreId(value)) setGenre(value);
});

/** The simple view's genre: just the genre, with the style picked per song and no part blends. */
function setSimpleGenre(value: SimpleGenre): void {
  prefs.styleAuto = true;
  prefs.partsOn = false;
  ui.partsOn.checked = false;
  ui.partRows.hidden = true;
  ui.genre.value = value;
  setGenre(value, true);
}

/** The genre; with `nextOnly` (the player's "what plays next") the playing song stays as it is. */
function setGenre(value: GenreId | "auto" | "open", nextOnly = false): void {
  prefs.genre = value;
  // Other references: the polygon starts from the centre.
  if (value === "open") prefs.weights = centreFor(prefs.openRefs);
  else if (value !== "auto") prefs.weights = centreWeights(value);
  padRefs =
    value === "auto"
      ? blendRefsFor(engine.song.blends.song, engine.song.genre)
      : value === "open"
        ? prefs.openRefs
        : GENRES[value].references;
  stylePad = newStylePad();
  showStylePad();
  showOpenRefs();
  showTempoHint();
  savePrefs();
  if (nextOnly) engine.updateNext(engineSettings());
  else engine.update(engineSettings());
  renderSimpleSettings();
}

/** Whether the style point is picked per song: by choice, or because the genre is. */
function styleIsAuto(): boolean {
  return prefs.styleAuto || prefs.genre === "auto";
}

/** The auto tempo's range and where the pad's records sit. References whose records sit far
 * apart get a note: a blend's tempo lands between them. */
function showTempoHint(): void {
  const genres = [...new Set(padRefs.map(genreOfReference))];
  const one = genres.length === 1 && prefs.genre !== "open" ? genres[0] : undefined;
  const now = prefs.genre === "auto" ? (one ? `${GENRES[one].name} now: ` : "this song: ") : "";
  const bpms = padRefs.map((r) => REFERENCES[r].bpm);
  const [lo, hi] = [Math.min(...bpms), Math.max(...bpms)];
  if (one) {
    const { range, note } = GENRES[one].tempo;
    ui.bpmHint.textContent = `Auto (varies per song, ${now}${range[0]}–${range[1]}; ${note})`;
  } else {
    const range = [
      Math.min(...genres.map((g) => GENRES[g].tempo.range[0])),
      Math.max(...genres.map((g) => GENRES[g].tempo.range[1])),
    ];
    ui.bpmHint.textContent = `Auto (varies per song, ${now}${range[0]}–${range[1]}; these records run at ${lo}–${hi})`;
  }
  // Warn, don't limit: blends of far-apart records the user picked play at a tempo between them.
  const spread = prefs.genre === "open" && hi - lo > TEMPO_SPREAD;
  ui.tempoWarning.hidden = !spread;
  ui.tempoWarning.textContent = spread
    ? `These records are ${Math.round(hi - lo)} BPM apart (${lo}–${hi}): a blend plays at a tempo between them, which none of them has.`
    : "";
}

/** The style polygon over the pad's references: a slider for two, a triangle for three, and so
 * on. */
function newStylePad(): BlendPad {
  const refs = padRefs;
  const names = refs.map(styleName);
  return new BlendPad({
    names,
    short: refs.length > 4 ? initials(names) : undefined,
    weights: prefs.weights.length === refs.length ? prefs.weights : centreFor(refs),
    label: "Style",
    onInput: (w) => (ui.styleOut.value = refsLabel(refs, w)),
    onChange: (w) => {
      ui.styleOut.value = refsLabel(refs, w);
      prefs.weights = w;
      savePrefs();
      engine.update(engineSettings());
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
  ui.styleOut.value = styleIsAuto() ? "" : refsLabel(padRefs, prefs.weights);
}

/** The open blend's reference chips, under the genre select while it says "Open". */
function showOpenRefs(): void {
  ui.openRefs.hidden = prefs.genre !== "open";
  ui.openRefs.replaceChildren(
    ...(prefs.genre === "open"
      ? [
          refChips(prefs.openRefs, (refs) => {
            prefs.openRefs = refs;
            prefs.weights = centreFor(refs);
            padRefs = refs;
            stylePad = newStylePad();
            showStylePad();
            showTempoHint();
            savePrefs();
            engine.update(engineSettings());
          }),
        ]
      : []),
  );
}

/** The references the style pad shows: the chosen genre's, the open blend's, or with auto the
 * current song's (its genre's, or its own when it blends across genres). */
let padRefs: readonly ReferenceId[] =
  prefs.genre === "open"
    ? prefs.openRefs
    : GENRES[prefs.genre === "auto" ? DEFAULT_GENRE : prefs.genre].references;
let stylePad = newStylePad();
showStylePad();
showOpenRefs();
showTempoHint();
ui.styleAuto.addEventListener("change", () => {
  prefs.styleAuto = ui.styleAuto.checked;
  // Overriding starts from the point the pad shows (the current song's).
  if (!prefs.styleAuto) prefs.weights = stylePad.weights;
  stylePad.disabled = prefs.styleAuto;
  savePrefs();
  engine.update(engineSettings());
  renderSimpleSettings();
});

// Per part: each part's own blend over the style's (profile.ts parts).
ui.partsOn.checked = prefs.partsOn;
ui.partRows.hidden = !prefs.partsOn;
ui.partRows.replaceChildren(
  ...PART_ROWS.map(
    ([part, label]) =>
      new PartRow(label, prefs.parts[part] ?? null, (value) => {
        if (value) prefs.parts[part] = structuredClone(value);
        else delete prefs.parts[part];
        savePrefs();
        if (prefs.partsOn) engine.update(engineSettings());
      }).element,
  ),
);
ui.partsOn.addEventListener("change", () => {
  prefs.partsOn = ui.partsOn.checked;
  ui.partRows.hidden = !prefs.partsOn;
  savePrefs();
  engine.update(engineSettings());
  renderSimpleSettings();
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

ui.progressions.value = prefs.progressions;
ui.progressions.addEventListener("change", () => {
  prefs.progressions = CHORDS_MODES.find((x) => x === ui.progressions.value) ?? "theory";
  savePrefs();
  engine.update({ chords: prefs.progressions });
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
  const key = e.key.toLowerCase();
  if (e.code === "Space") {
    e.preventDefault();
    void togglePlay();
  } else if (currentView === "advanced") {
    if (key === "n") engine.newSong(randomSeed());
    else if (key === "s") engine.skipSection();
  } else if (key === "n") nextSong();
  else if (target?.getAttribute("type") === "range") {
    // Arrows move a focused slider.
  } else if (e.key === "ArrowRight") nextSong();
  else if (e.key === "ArrowLeft") previousSong();
  else if (key === "r") setRepeat(!prefs.repeat);
  else if (key === "f") simple.setFullScreen();
  else if (key === "m") {
    engine.mixNext();
    renderMixNext();
  }
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
const master = mixRow("Master", prefs.master, (v) => setVolume(v));

/** The master level, from the mixer's Master fader or the simple view's volume. */
function setVolume(db: number): void {
  prefs.master = db;
  const slider = sliders.get("master");
  if (slider && Number(slider.value) !== db) slider.value = String(db);
  savePrefs();
  applyMixer();
  renderSimpleSettings();
}
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
  renderSimpleSettings();
});

// ── Go ────────────────────────────────────────────────────────────────────────────────────────

showView(prefs.view);
renderSimpleSettings();
renderMixNext();
const linked = initialCreation ? decodeCreation(initialCreation) : null;
if (linked) {
  // A link to a song already in My songs (or a reload) carries on as that entry.
  const known = initialCreation ? library.findData(initialCreation) : undefined;
  engine.playCustom(known ? { ...linked, id: known.id } : linked);
  // Creator mode lives in the advanced view: shown for this visit, not kept.
  showView("advanced");
  setCreator(true);
} else if (isReferenceId(initialReference)) engine.playReference(initialReference);
else renderSong(engine.song);
renderKitStatus();
autoplay();
startVisualizer(ui.viz, () => engine.analysers);
startVisualizer(el<HTMLCanvasElement>("s-viz"), () => engine.analysers);

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
  void Promise.all([import("tone"), import("./render"), import("./ahead")]).then(
    ([Tone, { renderToDisk, encodeWav }, { renderPiecesOffline }]) => {
      /** Renders the DJ transition out of the song with this seed to renders/ (silently). */
      const renderDjToDisk = async (
        seed: number,
        before = 8,
        after = 16,
        style?: "crossfade" | "morph" | "auto",
        trick?: "mix" | "pitch" | "mashup" | "echo" | "acapella",
        mixNextFrom?: number,
      ): Promise<string> => {
        const preview = engine.djPreview(seed, before, after, style, trick ?? null, mixNextFrom);
        const { pieces, mix, style: used } = preview;
        const rate = 44100;
        const { l, r } = await renderPiecesOffline(pieces, mix, rate);
        const audio = new AudioBuffer({ length: l.length, numberOfChannels: 2, sampleRate: rate });
        audio.copyToChannel(l, 0);
        audio.copyToChannel(r, 1);
        const [out, inc] = [pieces[0]!.decks[0]!, pieces.at(-1)!.decks.at(-1)!];
        const what = used === "morph" ? used : preview.trick;
        const kind = mixNextFrom === undefined ? what : `mixnext-${what}`;
        const name = `dj-${kind}-${seed}-to-${inc.song.seed}.wav`;
        const res = await fetch(`/__renders/${name}`, { method: "POST", body: encodeWav(audio) });
        const swapAt = pieces.find((p) => p.label && p.decks[1])?.decks[1]?.clock.time(0) ?? 0;
        const window = used === "morph" ? 32 : mixNextFrom === undefined ? 16 : 8;
        return [
          await res.text(),
          `"${out.song.title}" (${out.song.bpm} BPM, ${keyName(out.song.key)})`,
          `→ "${inc.song.title}" (${inc.song.bpm} BPM, ${keyName(inc.song.key)})`,
          `${kind} from ${(swapAt - window * (240 / out.song.bpm)).toFixed(1)} s, swap at ${swapAt.toFixed(1)} s`,
        ].join(" · ");
      };
      Object.assign(window, { engine, Tone, renderToDisk, renderDjToDisk, roll });
    },
  );
}
