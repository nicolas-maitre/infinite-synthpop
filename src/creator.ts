/**
 * Creator mode, built into the player. The section timeline selects (click), reorders (drag and
 * drop) and adds (the + at its end) sections; the current chords display edits the selected
 * section's chords bar by bar; its other parameters and the song settings appear under the piano
 * roll. Every edit goes to the engine as a new spec (spec.ts) and plays from the next bar.
 */
import { LEAD_RANGES, type Layers, type MelodyKind, type SectionKind, type Song } from "./composer";
import { BlendPad, initials } from "./blendpad";
import { KIT_LABELS } from "./drums";
import {
  DEFAULT_GENRE,
  GENRE_IDS,
  GENRES,
  isGenreId,
  specWeights,
  styleOf,
  weightsAtPoint,
} from "./genres";
import { CENTRE } from "./polygon";
import { REFERENCES } from "./references";
import {
  assignMelody,
  fromBars,
  importMelody,
  nextMelodyName,
  writeMelody,
  type MelodyDensity,
  type MelodyRange,
} from "./melodies";
import { matchTracks, type MidiFile } from "./midi";
import {
  blankSpec,
  CHORD_CHOICES,
  DRUM_MODES,
  KITS,
  SECTION_KINDS,
  type Creation,
  type SectionSpec,
  type SongSpec,
} from "./spec";
import type { LaneId, LaneLayout, LeadEditor } from "./pianoroll";
import { chord, chordName, keyName, scaleForChord } from "./theory";

export interface CreatorHost {
  song(): Song;
  creation(): Creation | null;
  /** Starts a creation; `keepPosition` keeps playing from the current bar. */
  play(creation: Creation, keepPosition: boolean): void;
  edit(spec: SongSpec): void;
  /** Shows a section: jumps there (and loops it when looping is on). */
  select(sectionIndex: number): void;
  /** Jumps to a bar of the song. */
  seek(bar: number): void;
  saved(): Creation | null;
  /** Copies the song's link; resolves false if the clipboard isn't available. */
  copyLink(): Promise<boolean>;
  /** Starts or stops recording section `index`'s melody; resolves whether it's now recording. */
  toggleRecording(index: number): Promise<boolean>;
  recording(): boolean;
  /** The loaded MIDI file, or a newly picked one (null if cancelled). */
  midiFile(pick: boolean): Promise<MidiFile | null>;
  /** Hands the piano roll a melody editor for the selected section (null: none). */
  setLeadEditor(editor: LeadEditor | null): void;
}

export interface Creator {
  readonly active: boolean;
  /** The roll's lanes moved: puts each instrument's controls beside its lane. */
  layoutLanes(lanes: LaneLayout[], labelWidth: number): void;
  setActive(on: boolean): void;
  /** After the timeline is built: makes its sections draggable and adds the + button. */
  decorateTimeline(timeline: HTMLElement): void;
  /** Shows section `index`: its chords in the progression list, its settings in the panel. */
  show(index: number, currentBar: number): void;
}

const DRUM_LABELS: Record<string, string> = {
  off: "No drums",
  kick: "Kick only",
  half: "Half-time",
  full: "Full",
  big: "Big (chorus)",
  groove: "Intro groove",
};
/** The instruments a section can play, in lane order, and their names. */
const LANE_ORDER: readonly LaneId[] = [
  "drums",
  "bass",
  "seq",
  "guitar",
  "hook",
  "pad",
  "riff",
  "lead",
  "counter",
  "arp",
  "stabs",
];
const LANE_LABELS: Record<LaneId, string> = {
  drums: "Drums",
  bass: "Seq bass",
  seq: "Sequence",
  guitar: "Guitar",
  hook: "Melodic bass",
  pad: "Pad",
  riff: "Riff",
  lead: "Lead",
  counter: "Counter line",
  arp: "Arp",
  stabs: "Stabs",
};

/** Whether a section's layers play an instrument. */
function plays(L: Partial<Layers>, id: LaneId): boolean {
  if (id === "drums") return !!L.drums && L.drums !== "off";
  if (id === "lead") return !!L.lead;
  return !!L[id];
}

const ADD_KINDS: readonly SectionKind[] = [
  "verse",
  "chorus",
  "intro",
  "interlude",
  "bridge",
  "turnaround",
  "break",
  "outro",
];

export function mountCreator(
  chords: HTMLOListElement,
  panel: HTMLElement,
  lanesBox: HTMLElement,
  host: CreatorHost,
): Creator {
  /** Each instrument's controls, by lane, and where the roll last drew the lanes. */
  const laneEls = new Map<LaneId, HTMLElement>();
  let layout: { lanes: LaneLayout[]; labelWidth: number } = { lanes: [], labelWidth: 0 };
  let importSlot = el("div");
  let active = false;
  /** What's on screen, so repeated bar updates don't rebuild (and close) open pickers. */
  let shownSong: Song | null = null;
  let shownIndex = -1;
  let chordCells: HTMLElement[] = [];
  /** Whether the song settings are open, so a re-render keeps them so. */
  let settingsOpen = false;
  const melodyPrefs: { range: MelodyRange; density: MelodyDensity } = {
    range: "mid",
    density: "normal",
  };

  const spec = () => host.creation()?.spec ?? null;
  /** Copies the spec, applies `change` to the copy, sends it to the engine. */
  const update = (change: (s: SongSpec) => void) => {
    const current = spec();
    if (!current) return;
    const next = structuredClone(current);
    change(next);
    host.edit(next);
  };

  function show(index: number, currentBar: number): void {
    const song = host.song();
    const s = spec();
    if (!active || !s) return;
    if (song !== shownSong || index !== shownIndex) {
      shownSong = song;
      shownIndex = index;
      renderChords(s, index);
      renderPanel(s, index);
      host.setLeadEditor(leadEditor(index));
    }
    const section = song.sections[index];
    if (section) {
      const bar = (currentBar - section.startBar) % section.progression.length;
      chordCells.forEach((cell, i) => cell.classList.toggle("active", i === bar));
    }
  }

  // ── Chords: the current chords display becomes one picker per bar ──────────────────────────

  function renderChords(s: SongSpec, index: number): void {
    const section = s.sections[index];
    if (!section) return;
    const key = section.key ?? s.key;
    const choices = CHORD_CHOICES[key.mode];
    const options = (allowNone: boolean): [string, string][] => [
      ...(allowNone ? ([["", "+ half"]] as [string, string][]) : []),
      ...choices.map((n): [string, string] => [n, `${chordName(key, chord(n))} · ${n}`]),
    ];
    const single = section.progression.length === 1;
    let dragFrom = -1;
    const clearMarks = () =>
      chordCells.forEach((c) => c.classList.remove("drop-before", "drop-after", "dragging"));

    chordCells = section.progression.map((bar, b) => {
      const li = el("li", "chord-edit");

      // Header: a grip to drag the bar elsewhere in the pattern, and × to remove it.
      const head = el("div", "chord-head");
      const grip = el("span", "chord-grip");
      grip.textContent = `⠿ ${b + 1}`;
      grip.title = "Drag to move this bar";
      // Only the grip starts a drag, so the pickers stay clickable.
      grip.addEventListener("pointerdown", () => (li.draggable = true));
      grip.addEventListener("pointerup", () => (li.draggable = false));
      const remove = button("×", () =>
        update((n) => {
          const t = at(n, index);
          if (t.progression.length > 1) t.progression = t.progression.filter((_, j) => j !== b);
        }),
      );
      remove.className = "chord-remove";
      remove.title = "Remove this bar";
      remove.setAttribute("aria-label", `Remove bar ${b + 1}`);
      remove.disabled = single;
      head.append(grip, remove);
      // Clicking the bar's header jumps to it (its first time through the section).
      head.title = "Click to play from this bar; drag the grip to move it";
      head.addEventListener("click", (e) => {
        if (e.target === remove) return;
        const start = host.song().sections[index]?.startBar;
        if (start !== undefined) host.seek(start + b);
      });

      li.addEventListener("dragstart", (e) => {
        dragFrom = b;
        li.classList.add("dragging");
        e.dataTransfer?.setData("text/plain", String(b));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      li.addEventListener("dragend", () => {
        li.draggable = false;
        clearMarks();
      });
      li.addEventListener("dragover", (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        clearMarks();
        li.classList.add(isAfter(e, li) ? "drop-after" : "drop-before");
      });
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = dragFrom;
        dragFrom = -1;
        clearMarks();
        if (from < 0) return;
        let to = b + (isAfter(e, li) ? 1 : 0);
        if (from < to) to--;
        if (to === from) return;
        update((n) => {
          const t = at(n, index);
          const bars = [...t.progression];
          const [moved] = bars.splice(from, 1);
          if (moved) bars.splice(to, 0, moved);
          t.progression = bars;
        });
      });

      const first = select(options(false), bar[0] ?? "i", (v) =>
        update((n) => {
          const t = at(n, index);
          t.progression = t.progression.map((x, j) => (j === b ? [v, ...x.slice(1)] : x));
        }),
      );
      first.setAttribute("aria-label", `Bar ${b + 1} chord`);
      const second = select(options(true), bar[1] ?? "", (v) =>
        update((n) => {
          const t = at(n, index);
          t.progression = t.progression.map((x, j) =>
            j !== b ? x : v ? [x[0] ?? "i", v] : [x[0] ?? "i"],
          );
        }),
      );
      second.setAttribute("aria-label", `Bar ${b + 1}: second chord for the bar's second half`);
      second.title = "Split the bar: a second chord for its second half";
      li.append(head, first, second);
      return li;
    });
    const tools = el("li", "chord-tools");
    const add = button("+", () =>
      update((n) => {
        const t = at(n, index);
        if (t.progression.length < 16)
          t.progression = [...t.progression, [...(t.progression.at(-1) ?? ["i"])]];
      }),
    );
    add.title = "Add a bar to the chord pattern";
    add.setAttribute("aria-label", "Add a bar");
    add.disabled = section.progression.length >= 16;
    tools.append(add);
    chords.classList.add("editing");
    chords.replaceChildren(...chordCells, tools);
  }

  // ── The selected section's settings, then the song's ────────────────────────────────────────

  function renderPanel(s: SongSpec, index: number): void {
    const section = s.sections[index];
    panel.hidden = !section;
    if (!section) return;

    const name = input("text", section.label, (v) =>
      update((n) => (at(n, index).label = v.trim() || "Section")),
    );
    name.className = "section-name-input";
    name.setAttribute("aria-label", "Section name");
    const kind = select(
      SECTION_KINDS.map((k) => [k, k]),
      section.kind,
      (v) => update((n) => (at(n, index).kind = SECTION_KINDS.find((k) => k === v) ?? "verse")),
    );
    kind.setAttribute("aria-label", "Section type");
    const bars = input("number", String(section.bars), (v) =>
      update((n) => (at(n, index).bars = Math.min(64, Math.max(1, Math.round(Number(v)) || 1)))),
    );
    bars.min = "1";
    bars.max = "64";
    const sectionKey = select(
      [
        ["song", `Song key (${keyName(s.key)})`],
        ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].flatMap((t) =>
          (["minor", "major"] as const).map((m): [string, string] => [
            `${t}:${m}`,
            keyName({ tonic: t, mode: m }),
          ]),
        ),
      ],
      section.key ? `${section.key.tonic}:${section.key.mode}` : "song",
      (v) =>
        update((n) => {
          const t = at(n, index);
          if (v === "song") delete t.key;
          else {
            const [tonic, mode] = v.split(":");
            t.key = { tonic: Number(tonic), mode: mode === "major" ? "major" : "minor" };
          }
        }),
    );
    sectionKey.setAttribute("aria-label", "Section key");
    const dup = button("Duplicate", () => {
      update((n) => n.sections.splice(index + 1, 0, structuredClone(at(n, index))));
      host.select(index + 1);
    });
    const del = button("Delete", () => {
      update((n) => n.sections.splice(index, 1));
      host.select(Math.max(0, index - 1));
    });
    del.disabled = s.sections.length === 1;
    const head = row(
      "section-editor-head",
      name,
      kind,
      labelled("bars", bars),
      sectionKey,
      dup,
      del,
    );

    importSlot = el("div", "melody-import-slot");
    // An edit re-renders the panel: keep the song settings open, and the feel pad focused.
    const feelFocused = document.activeElement?.closest(".song-settings .blendpad") != null;
    panel.replaceChildren(addList(s, index), head, importSlot, songSettings(s));
    if (feelFocused) panel.querySelector<HTMLElement>(".song-settings .blendpad-surface")?.focus();
    renderLanes(s, index);
  }

  /** "+ Guitar", "+ Lead", …: the instruments this section doesn't play yet. */
  function addList(s: SongSpec, index: number): HTMLElement {
    const section = s.sections[index];
    const box = el("div", "instrument-add");
    if (!section) return box;
    const L = section.layers;
    const missing = LANE_ORDER.filter((id) => !plays(L, id));
    if (!missing.length) return box;
    const label = el("span", "note");
    label.textContent = "Add:";
    box.append(label);
    for (const id of missing) {
      const b = button(`+ ${LANE_LABELS[id]}`, () =>
        update((n) => {
          const t = at(n, index);
          if (id === "drums") t.layers.drums = t.kind === "chorus" ? "big" : "full";
          else if (id === "lead") t.layers.lead = t.kind === "chorus" ? "chorus" : "verse";
          else setLayer(t.layers, id, true);
        }),
      );
      b.classList.add("instrument-add-btn");
      box.append(b);
    }
    return box;
  }

  // ── Each instrument's controls, beside its lane in the piano roll ────────────────────────────

  function renderLanes(s: SongSpec, index: number): void {
    const section = s.sections[index];
    laneEls.clear();
    lanesBox.replaceChildren();
    if (!section) return;
    for (const id of LANE_ORDER) {
      if (!plays(section.layers, id)) continue;
      const box = el("div", "lane-controls");
      box.dataset.lane = id;
      const head = el("div", "lane-head");
      const name = el("span", "lane-name");
      name.textContent = id === "lead" ? "Lead ✎" : LANE_LABELS[id];
      const remove = button("×", () =>
        update((n) => {
          const t = at(n, index);
          if (id === "drums") t.layers.drums = "off";
          else if (id === "lead") {
            t.layers.lead = null;
            delete t.melody;
          } else setLayer(t.layers, id, false);
        }),
      );
      remove.className = "lane-remove";
      remove.title = `Remove ${LANE_LABELS[id]} from this section`;
      remove.setAttribute("aria-label", `Remove ${LANE_LABELS[id]}`);
      head.append(name, remove);
      const params = laneParams(s, index, id);
      // A one-line lane (the bass) keeps its switch beside its name.
      box.append(head);
      if (id === "bass") head.insertBefore(row("lane-row", ...params), remove);
      else box.append(...params);
      laneEls.set(id, box);
      lanesBox.append(box);
    }
    placeLanes();
  }

  /** The parameters an instrument has in a section. */
  function laneParams(s: SongSpec, index: number, id: LaneId): HTMLElement[] {
    const section = s.sections[index];
    if (!section) return [];
    const L = section.layers;
    const layer = (label: string, key: keyof Layers, on: boolean) =>
      toggle(label, on, (value) => update((n) => setLayer(at(n, index).layers, key, value)));
    if (id === "drums") {
      const pattern = select(
        DRUM_MODES.filter((m) => m !== "off").map((m) => [m, DRUM_LABELS[m] ?? m]),
        L.drums ?? "full",
        (v) => update((n) => (at(n, index).layers.drums = DRUM_MODES.find((m) => m === v))),
      );
      pattern.setAttribute("aria-label", "Drum pattern");
      return [
        row(
          "lane-row",
          pattern,
          toggle("Fill", section.fill ?? defaultFill(s, index), (on) =>
            update((n) => (at(n, index).fill = on)),
          ),
        ),
      ];
    }
    if (id === "bass") return [layer("Staccato", "bassShort", !!L.bassShort)];
    if (id === "lead") return leadParams(s, index);
    return [];
  }

  /** The lead: which melody, double, and the tools that make one (the roll edits it). */
  function leadParams(s: SongSpec, index: number): HTMLElement[] {
    const section = s.sections[index];
    if (!section) return [];
    const L = section.layers;
    const custom = section.melody ? s.melodies?.[section.melody] : undefined;
    const melody = select(
      [
        ["verse", "Generated: verse"],
        ["chorus", "Generated: chorus"],
        ...Object.entries(s.melodies ?? {}).map(([id, m]): [string, string] => [
          `custom:${id}`,
          `✎ ${m.name}`,
        ]),
      ],
      custom ? `custom:${section.melody}` : (L.lead ?? "verse"),
      (v) =>
        update((n) => {
          const t = at(n, index);
          if (v.startsWith("custom:")) {
            t.melody = v.slice(7);
            t.layers.lead ??= t.kind === "chorus" ? "chorus" : "verse";
          } else {
            delete t.melody;
            t.layers.lead = v === "chorus" ? "chorus" : ("verse" as MelodyKind);
          }
        }),
    );
    melody.setAttribute("aria-label", "Lead melody");
    const rows: HTMLElement[] = [
      row(
        "lane-row",
        melody,
        toggle("Double", !!L.leadDouble, (on) =>
          update((n) => (at(n, index).layers.leadDouble = on)),
        ),
      ),
    ];
    if (custom && section.melody) {
      const id = section.melody;
      const name = input("text", custom.name, (v) =>
        update((n) => {
          const m = n.melodies?.[id];
          if (m) m.name = v.trim() || m.name;
        }),
      );
      name.className = "melody-name";
      name.setAttribute("aria-label", "Melody name");
      const length = input("number", String(custom.bars), (v) =>
        update((n) => {
          const m = n.melodies?.[id];
          if (m) m.bars = Math.min(32, Math.max(1, Math.round(Number(v)) || m.bars));
        }),
      );
      length.min = "1";
      length.max = "32";
      length.title = "Melody length in bars (it repeats over the section)";
      rows.push(row("lane-row", name, labelled("bars", length)));
    }
    const range = select(
      [
        ["low", "Low"],
        ["mid", "Mid"],
        ["high", "High"],
      ],
      melodyPrefs.range,
      (v) => (melodyPrefs.range = v === "low" || v === "high" ? v : "mid"),
    );
    range.title = "Register of a new melody";
    const density = select(
      [
        ["sparse", "Sparse"],
        ["normal", "Normal"],
        ["busy", "Busy"],
      ],
      melodyPrefs.density,
      (v) => (melodyPrefs.density = v === "sparse" || v === "busy" ? v : "normal"),
    );
    density.title = "Notes per bar of a new melody";
    const write = button("New", () =>
      update((n) => {
        const m = writeMelody(
          host.song(),
          index,
          melodyPrefs.range,
          melodyPrefs.density,
          Math.floor(Math.random() * 1e6),
          nextMelodyName(n),
        );
        if (m) assignMelody(n, host.song(), index, m);
      }),
    );
    write.title = "Write a new melody over this section's chords";
    const record = button(host.recording() ? "■ Stop" : "● Rec", () => {
      void host.toggleRecording(index).then((on) => {
        record.textContent = on ? "■ Stop" : "● Rec";
        record.classList.toggle("recording", on);
      });
    });
    record.classList.toggle("recording", host.recording());
    record.title =
      "Record: play the melody in while the section loops (keys A W S E D F T G Y H U J K, Z / X octave, or a MIDI keyboard)";
    const importBtn = button("MIDI…", () => void showImport(index, importSlot));
    importBtn.title = "Import a track and bars from a MIDI file as this melody";
    rows.push(row("lane-row", range, density, write), row("lane-row", record, importBtn));
    return rows;
  }

  /** Puts each instrument's controls beside its lane (the roll reports where they are). */
  function placeLanes(): void {
    lanesBox.hidden = !active || laneEls.size === 0;
    lanesBox.style.width = `${layout.labelWidth}px`;
    for (const lane of layout.lanes) {
      const box = laneEls.get(lane.id);
      if (!box) continue;
      box.style.top = `${lane.top}px`;
      box.style.height = `${lane.height}px`;
      box.style.setProperty("--lane-color", lane.color);
    }
  }

  // ── The section's melody: pick, write, record, import (and edit in the piano roll) ─────────

  /** The roll's Lead lane editor for section `index`: its melody, snapped to the key's scale. */
  function leadEditor(index: number): LeadEditor | null {
    const song = host.song();
    const section = song.sections[index];
    const melody = song.sectionMelodies[index];
    const kind = section?.layers.lead;
    if (!section || !melody || !kind) return null;
    const pitches = melody.bars.flatMap((bar) => bar.map((n) => n.midi));
    const [lo, hi] = LEAD_RANGES[kind];
    return {
      bars: melody.bars.map((bar) => bar.map((n) => ({ ...n }))),
      range: [
        Math.min(lo - 5, ...pitches.map((p) => p - 2)),
        Math.max(hi + 5, ...pitches.map((p) => p + 2)),
      ],
      scale: scaleForChord(section.key, chord(section.key.mode === "major" ? "I" : "i")),
      commit: (bars) =>
        update((n) => {
          const t = at(n, index);
          const name = (t.melody && n.melodies?.[t.melody]?.name) || nextMelodyName(n);
          assignMelody(n, song, index, fromBars(bars, t.key ?? n.key, name));
        }),
    };
  }

  async function showImport(index: number, box: HTMLElement): Promise<void> {
    const file = (await host.midiFile(false)) ?? (await host.midiFile(true));
    if (!file) return;
    const s = spec();
    const section = s?.sections[index];
    if (!s || !section) return;
    const tracks = file.tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.channel !== 9);
    // A file with no sung line (TF's) offers its counter-line, the nearest thing to a melody.
    const match = matchTracks(file);
    const guess = (match.lead ?? match.counter)?.[0];
    const track = select(
      tracks.map(({ t, i }): [string, string] => [
        String(i),
        `${t.name || `Track ${i + 1}`} (${t.notes.length})`,
      ]),
      String(guess ?? tracks[0]?.i ?? 0),
      () => {},
    );
    const lastBar = Math.ceil(
      Math.max(0, ...file.tracks.flatMap((t) => t.notes.map((n) => n.tick))) /
        (file.ticksPerBeat * 4),
    );
    const firstNoteBar = (i: number) =>
      Math.floor((file.tracks[i]?.notes[0]?.tick ?? 0) / (file.ticksPerBeat * 4));
    const start = input("number", String(firstNoteBar(Number(track.value)) + 1), () => {});
    start.min = "1";
    start.max = String(Math.max(1, lastBar));
    track.addEventListener(
      "change",
      () => (start.value = String(firstNoteBar(Number(track.value)) + 1)),
    );
    const length = input("number", String(Math.min(8, section.bars)), () => {});
    length.min = "1";
    length.max = "32";
    const go = button("Import", () => {
      const t = file.tracks[Number(track.value)];
      if (!t) return;
      update((n) => {
        const target = at(n, index);
        const key = target.key ?? n.key;
        const m = importMelody(
          t,
          file.ticksPerBeat,
          Math.max(0, Math.round(Number(start.value)) - 1),
          Math.min(32, Math.max(1, Math.round(Number(length.value)) || 8)),
          key,
          target.layers.lead ?? "verse",
          `${t.name || "MIDI"} ${start.value}`,
        );
        assignMelody(n, host.song(), index, m);
      });
    });
    const cancel = button("Cancel", () => form.remove());
    const form = row(
      "melody-import",
      labelled("Track", track),
      labelled("from bar", start),
      labelled("bars", length),
      go,
      cancel,
    );
    box.replaceChildren(form);
  }

  function songSettings(s: SongSpec): HTMLElement {
    const box = el("details", "song-settings");
    box.open = settingsOpen;
    box.addEventListener("toggle", () => (settingsOpen = box.open));
    const summary = el("summary");
    summary.textContent = `Song: ${s.title} · ${keyName(s.key)} · ${s.bpm} BPM`;
    const tonic = select(
      Array.from({ length: 12 }, (_, t) => [String(t), keyName({ tonic: t, mode: s.key.mode })]),
      String(s.key.tonic),
      (v) => update((n) => (n.key = { ...n.key, tonic: Number(v) })),
    );
    const mode = select(
      [
        ["minor", "minor"],
        ["major", "major"],
      ],
      s.key.mode,
      (v) => update((n) => (n.key = { ...n.key, mode: v === "major" ? "major" : "minor" })),
    );
    const bpm = input("number", String(s.bpm), (v) =>
      update((n) => (n.bpm = Math.min(160, Math.max(60, Number(v) || n.bpm)))),
    );
    bpm.min = "60";
    bpm.max = "160";
    bpm.step = "0.5";
    const kit = select(
      KITS.map((k) => [k, KIT_LABELS[k]]),
      s.kit,
      (v) => update((n) => (n.kit = KITS.find((k) => k === v) ?? n.kit)),
    );
    const bass = select(
      [
        ["tf", "True Faith"],
        ["ds", "The Different Story"],
        ["yc", "You Came"],
      ],
      s.bassStyle,
      (v) => update((n) => (n.bassStyle = v === "ds" || v === "yc" ? v : "tf")),
    );
    // The creation's genre: whose references the feel blends (synthpop for everything older).
    const genreId = s.genre ?? DEFAULT_GENRE;
    const genrePick = select(
      GENRE_IDS.map((id) => [id, GENRES[id].name]),
      genreId,
      (v) =>
        update((n) => {
          if (!isGenreId(v) || v === (n.genre ?? DEFAULT_GENRE)) return;
          // Synthpop stays implicit, the way links and old saves have it.
          if (v === DEFAULT_GENRE) delete n.genre;
          else n.genre = v;
          // Another genre has other references: its feel starts from the centre.
          n.weights = weightsAtPoint(GENRES[v], CENTRE);
          n.style = styleOf(n.weights);
        }),
    );
    // The song's style polygon, small: which reference's drum details, bass tone and riff
    // register the creation plays with (its form and chords are its own).
    const genre = GENRES[genreId];
    const names = genre.references.map((id) => REFERENCES[id].title);
    const feel = new BlendPad({
      names,
      short: initials(names),
      weights: specWeights(genre, s),
      label: "Feel",
      compact: true,
      onChange: (w) =>
        update((n) => {
          n.weights = w;
          n.style = styleOf(w);
        }),
    });
    feel.element.title = "Feel: the references' drum details, bass tone and riff register";
    // Not a label: a click on the pad would also press the label's button (the pad's reset).
    const feelField = el("div", "editor-field feel-field");
    const feelName = el("span");
    feelName.textContent = "Feel";
    feelField.append(feelName, feel.element);

    const copy = button("Copy link", () => {
      void host.copyLink().then((ok) => {
        copy.textContent = ok ? "Link copied ✓" : "Copy the address bar";
        setTimeout(() => (copy.textContent = "Copy link"), 2000);
      });
    });
    const blank = button("New blank song", () => {
      if (confirm("Start a new blank song? Copy the link first to keep this one.")) {
        host.play({ seed: host.song().seed, spec: blankSpec() }, false);
        host.select(0);
      }
    });
    const actions: HTMLElement[] = [copy, blank];
    const saved = host.saved();
    if (saved && saved.spec.title !== s.title) {
      actions.push(
        button(`Resume “${saved.spec.title}”`, () => {
          host.play(saved, false);
          host.select(0);
        }),
      );
    }

    box.append(
      summary,
      row(
        "song-settings-row",
        labelled("Key", tonic, mode),
        labelled("Tempo", bpm),
        labelled("Drums", kit),
        labelled("Bass figure", bass),
        labelled("Genre", genrePick),
        feelField,
      ),
      row("song-settings-row", ...actions),
    );
    return box;
  }

  // ── Timeline: drag to reorder, + to add ─────────────────────────────────────────────────────

  function decorateTimeline(timeline: HTMLElement): void {
    if (!active || !spec()) return;
    const blocks = [...timeline.querySelectorAll<HTMLElement>(".sec")];
    let from = -1;
    const clearMarks = () =>
      blocks.forEach((b) => b.classList.remove("drop-before", "drop-after", "dragging"));
    blocks.forEach((block, i) => {
      block.draggable = true;
      block.addEventListener("dragstart", (e) => {
        from = i;
        block.classList.add("dragging");
        e.dataTransfer?.setData("text/plain", String(i));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      });
      block.addEventListener("dragend", clearMarks);
      block.addEventListener("dragover", (e) => {
        if (from < 0) return;
        e.preventDefault();
        const after = isAfter(e, block);
        blocks.forEach((b) => b.classList.remove("drop-before", "drop-after"));
        block.classList.add(after ? "drop-after" : "drop-before");
      });
      block.addEventListener("drop", (e) => {
        e.preventDefault();
        const after = isAfter(e, block);
        clearMarks();
        if (from < 0) return;
        let to = i + (after ? 1 : 0);
        if (from < to) to--;
        const moved = from;
        from = -1;
        if (to === moved) return;
        update((n) => {
          const [item] = n.sections.splice(moved, 1);
          if (item) n.sections.splice(to, 0, item);
        });
        host.select(to);
      });
    });

    const add = el("div", "sec-add");
    const plus = button("+", () => menu.toggleAttribute("hidden"));
    plus.title = "Add a section at the end";
    plus.setAttribute("aria-label", "Add a section");
    const menu = el("div", "sec-add-menu");
    menu.hidden = true;
    for (const kind of ADD_KINDS) {
      menu.append(
        button(kind, () => {
          menu.hidden = true;
          const s = spec();
          if (!s) return;
          update((n) => n.sections.push(newSection(kind, n)));
          host.select(s.sections.length);
        }),
      );
    }
    add.append(plus, menu);
    timeline.append(add);
  }

  return {
    get active() {
      return active;
    },
    setActive(on: boolean) {
      active = on;
      shownSong = null;
      shownIndex = -1;
      if (!on) {
        host.setLeadEditor(null);
        laneEls.clear();
        lanesBox.replaceChildren();
        lanesBox.hidden = true;
        panel.hidden = true;
        panel.replaceChildren();
        chords.classList.remove("editing");
      }
    },
    decorateTimeline,
    show,
    layoutLanes(lanes, labelWidth) {
      layout = { lanes, labelWidth };
      placeLanes();
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────

/** Whether the pointer is over the right half of a timeline block. */
function isAfter(e: MouseEvent, block: HTMLElement): boolean {
  const r = block.getBoundingClientRect();
  return e.clientX > r.left + r.width / 2;
}

function at(spec: SongSpec, index: number): SectionSpec {
  const s = spec.sections[index];
  if (!s) throw new Error(`No section ${index}`);
  return s;
}

function setLayer(layers: Partial<Layers>, key: keyof Layers, on: boolean): void {
  (layers as Record<string, unknown>)[key] = on;
}

/** Whether a section gets a fill when the spec doesn't say: before a verse or chorus. */
function defaultFill(spec: SongSpec, index: number): boolean {
  const next = spec.sections[index + 1];
  return !!next && (next.kind === "verse" || next.kind === "chorus");
}

/** A new section: a copy of the last one of its kind, or a sensible default. */
function newSection(kind: SectionKind, spec: SongSpec): SectionSpec {
  const like = [...spec.sections].reverse().find((s) => s.kind === kind);
  const count = spec.sections.filter((s) => s.kind === kind).length;
  const name = `${kind[0]?.toUpperCase()}${kind.slice(1)}`;
  if (like) return { ...structuredClone(like), label: `${name} ${count + 1}`, fill: undefined };
  const layers: Partial<Layers> = {
    drums: kind === "chorus" ? "big" : kind === "break" ? "off" : "full",
    bass: kind !== "break",
    pad: true,
  };
  if (kind === "verse" || kind === "chorus") layers.lead = kind;
  if (kind === "bridge") layers.hook = true;
  return {
    kind,
    label: name,
    bars: kind === "break" || kind === "turnaround" ? 2 : 8,
    progression: (kind === "verse" ? spec.verse : spec.chorus).map((b) => [...b]),
    layers,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function row(cls: string, ...children: HTMLElement[]): HTMLElement {
  const r = el("div", cls);
  r.append(...children);
  return r;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "btn small");
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

function toggle(text: string, on: boolean, onChange: (on: boolean) => void): HTMLButtonElement {
  const b = el("button", "btn small layer-toggle");
  b.type = "button";
  b.textContent = text;
  b.setAttribute("aria-pressed", String(on));
  b.addEventListener("click", () => onChange(b.getAttribute("aria-pressed") !== "true"));
  return b;
}

function input(type: string, value: string, onChange: (v: string) => void): HTMLInputElement {
  const i = el("input");
  i.type = type;
  i.value = value;
  i.addEventListener("change", () => onChange(i.value));
  return i;
}

function select(
  options: readonly (readonly [string, string])[],
  value: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const s = el("select");
  for (const [v, text] of options) s.append(new Option(text, v));
  s.value = value;
  s.addEventListener("change", () => onChange(s.value));
  return s;
}

function labelled(text: string, ...controls: HTMLElement[]): HTMLElement {
  const l = el("label", "editor-field");
  const span = el("span");
  span.textContent = text;
  l.append(span, ...controls);
  return l;
}
