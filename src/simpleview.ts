/**
 * The simple view: a music player over the same engine and settings as the advanced view. What's
 * playing, previous / play / next with a seek bar and repeat, DJ mode, lite playback, the volume
 * with the mixer under it, the genre that plays next, and the songs heard before, the favourites
 * and the originals. main.ts owns the state and calls the render methods; this only binds the
 * controls.
 */
import type { Song } from "./composer";
import { GENRE_IDS, GENRES, type GenreId } from "./genres";
import { barSeconds, songSeconds } from "./mediasession";
import { animate } from "./quality";
import { keyName } from "./theory";

export type SimpleGenre = GenreId | "auto";

export interface SimpleViewActions {
  togglePlay(): void;
  previous(): void;
  next(): void;
  /** Continues from this bar, at once. */
  seek(bar: number): void;
  setRepeat(on: boolean): void;
  setDj(on: boolean): void;
  mixNext(): void;
  setLite(on: boolean): void;
  setGenre(genre: SimpleGenre): void;
  setVolume(db: number): void;
  toggleSave(): void;
  share(button: HTMLButtonElement): void;
  /** The lists: play a row, ♡ a previous song, share or remove a favourite. */
  playHistory(id: string): void;
  toggleHistorySaved(id: string): void;
  playFavourite(id: string): void;
  shareFavourite(id: string, button: HTMLButtonElement): void;
  removeFavourite(id: string): void;
  playOriginal(id: string): void;
}

/** A row of one of the lists. */
export interface SongRow {
  id: string;
  title: string;
  meta: string;
  /** The one playing. */
  current: boolean;
  /** In My songs (the previous songs' ♡). */
  saved?: boolean;
}

export interface SongLists {
  history: SongRow[];
  favourites: SongRow[];
  originals: SongRow[];
}

/** The settings the view shows. `genre` is "custom" when the advanced view set more than a genre. */
export interface SimpleSettings {
  dj: boolean;
  /** Why DJ mode can't be turned on here, or null. */
  djUnavailable: string | null;
  repeat: boolean;
  lite: boolean;
  /** Why the lite switch is fixed, or null. */
  liteFixed: string | null;
  genre: SimpleGenre | "custom";
  volume: number;
}

export interface SimpleView {
  renderSong(song: Song): void;
  /** A bar starts being heard (or the position moved while stopped). */
  renderBar(song: Song, bar: number, mixOut: { from: number; swap: number } | null): void;
  renderPlayState(state: { playing: boolean } | { loading: string }): void;
  renderMix(text: string | null): void;
  renderBuffer(status: { text: string; waiting: boolean } | null): void;
  renderSaved(saved: boolean, title: string): void;
  renderSettings(settings: SimpleSettings): void;
  renderLists(lists: SongLists): void;
  /** Mix next: shown in DJ mode, enabled when it can start a transition. */
  renderMixNext(state: { shown: boolean; enabled: boolean; label: string; title: string }): void;
  /** A line under the lists ("Deleted …"), with an Undo when there's one. */
  renderListStatus(text: string, undo?: () => void): void;
  /** The view is shown or hidden (the progress only animates while shown). */
  setShown(shown: boolean): void;
  /** Where the mixer card goes while this view shows. */
  readonly mixerDrawer: HTMLElement;
}

function el<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const node = root.querySelector<T>(`#${id}`);
  if (!node) throw new Error(`#${id} missing`);
  return node;
}

/** 83 → "1:23". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function mountSimpleView(root: HTMLElement, actions: SimpleViewActions): SimpleView {
  const ui = {
    title: el(root, "s-title"),
    meta: el(root, "s-meta"),
    mix: el(root, "s-mix"),
    save: el<HTMLButtonElement>(root, "s-save"),
    share: el<HTMLButtonElement>(root, "s-share"),
    elapsed: el(root, "s-elapsed"),
    total: el(root, "s-total"),
    seek: el<HTMLInputElement>(root, "s-seek"),
    mixOut: el(root, "s-mixout"),
    repeat: el<HTMLButtonElement>(root, "s-repeat"),
    prev: el<HTMLButtonElement>(root, "s-prev"),
    play: el<HTMLButtonElement>(root, "s-play"),
    loading: el(root, "s-loading"),
    next: el<HTMLButtonElement>(root, "s-next"),
    buffer: el(root, "s-buffer"),
    volume: el<HTMLInputElement>(root, "s-volume"),
    mixerToggle: el<HTMLButtonElement>(root, "s-mixer-toggle"),
    mixer: el(root, "s-mixer"),
    lite: el<HTMLInputElement>(root, "s-lite"),
    dj: el<HTMLButtonElement>(root, "s-dj"),
    djState: el(root, "s-dj-state"),
    djDesc: el(root, "s-dj-desc"),
    mixNext: el<HTMLButtonElement>(root, "s-mix-next"),
    mixNextLabel: el(root, "s-mix-next-label"),
    genre: el<HTMLSelectElement>(root, "s-genre"),
    history: el<HTMLUListElement>(root, "s-history"),
    historyEmpty: el(root, "s-history-empty"),
    favourites: el<HTMLUListElement>(root, "s-favourites"),
    favouritesEmpty: el(root, "s-favourites-empty"),
    favouritesCount: el(root, "s-favourites-count"),
    originals: el<HTMLUListElement>(root, "s-originals"),
    listStatus: el(root, "s-lists-status"),
  };
  const djDesc = ui.djDesc.textContent ?? "";

  const label = (b: HTMLButtonElement, text: string) => {
    b.title = text;
    b.setAttribute("aria-label", text);
  };
  label(ui.prev, "Previous song, or back to the start once a song is under way (←)");
  label(ui.next, "Next song (→ or N)");
  label(ui.repeat, "Repeat this song (R)");

  ui.genre.append(new Option("Any (a genre per song)", "auto"));
  for (const id of GENRE_IDS) ui.genre.append(new Option(GENRES[id].name, id));
  const custom = new Option("Custom (set in Advanced)", "custom");
  custom.disabled = true;

  // ── Position: from the last bar heard, moved on smoothly between bars ──
  let song: Song | null = null;
  let heard = { bar: 0, at: 0, seconds: 2 };
  let playing = false;
  let shown = false;
  let dragging = false;

  const position = (): number => {
    if (!playing) return heard.bar;
    const into = (performance.now() - heard.at) / 1000 / heard.seconds;
    return heard.bar + Math.min(1, Math.max(0, into));
  };
  const showPosition = (bar: number) => {
    if (!song) return;
    ui.elapsed.textContent = clock(bar * barSeconds(song));
    if (!dragging) ui.seek.value = String(bar);
  };
  animate(() => {
    if (shown && playing && song) showPosition(position());
  });

  ui.seek.addEventListener("input", () => {
    dragging = true;
    if (song) ui.elapsed.textContent = clock(Number(ui.seek.value) * barSeconds(song));
  });
  ui.seek.addEventListener("change", () => {
    dragging = false;
    const bar = Math.floor(Number(ui.seek.value));
    heard = { ...heard, bar, at: performance.now() };
    actions.seek(bar);
  });

  // ── Controls ──
  ui.play.addEventListener("click", () => actions.togglePlay());
  ui.prev.addEventListener("click", () => actions.previous());
  ui.next.addEventListener("click", () => actions.next());
  ui.repeat.addEventListener("click", () =>
    actions.setRepeat(ui.repeat.getAttribute("aria-pressed") !== "true"),
  );
  ui.dj.addEventListener("click", () =>
    actions.setDj(ui.dj.getAttribute("aria-pressed") !== "true"),
  );
  ui.mixNext.addEventListener("click", () => actions.mixNext());
  ui.lite.addEventListener("change", () => actions.setLite(ui.lite.checked));
  ui.genre.addEventListener("change", () => {
    const v = ui.genre.value;
    if (v === "auto" || (GENRE_IDS as string[]).includes(v)) actions.setGenre(v as SimpleGenre);
  });
  ui.volume.addEventListener("input", () => actions.setVolume(Number(ui.volume.value)));
  ui.save.addEventListener("click", () => actions.toggleSave());
  ui.share.addEventListener("click", () => actions.share(ui.share));
  // ── Lists: one tab at a time (arrow keys move between the tabs) ──
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const selectTab = (tab: HTMLButtonElement) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = root.querySelector<HTMLElement>(`#${t.getAttribute("aria-controls")}`);
      if (panel) panel.hidden = !on;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      // Not previous / next song.
      e.stopPropagation();
      const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length]!;
      selectTab(next);
      next.focus();
    });
  }

  const smallButton = (text: string, title: string, onClick: (b: HTMLButtonElement) => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small";
    b.textContent = text;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.addEventListener("click", () => onClick(b));
    return b;
  };
  const renderRows = (
    list: HTMLUListElement,
    rows: SongRow[],
    play: (id: string) => void,
    extra: (row: SongRow) => HTMLElement[] = () => [],
  ) => {
    list.replaceChildren(
      ...rows.map((row) => {
        const li = document.createElement("li");
        li.className = "song-row";
        if (row.current) li.setAttribute("aria-current", "true");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "song-play";
        button.title = `Play “${row.title}”`;
        const name = document.createElement("span");
        name.className = "song-name";
        name.textContent = row.title;
        const meta = document.createElement("span");
        meta.className = "song-meta";
        meta.textContent = row.meta;
        button.append(name, meta);
        button.addEventListener("click", () => play(row.id));
        li.append(button, ...extra(row));
        return li;
      }),
    );
  };

  ui.mixerToggle.addEventListener("click", () => {
    const open = ui.mixerToggle.getAttribute("aria-expanded") !== "true";
    ui.mixerToggle.setAttribute("aria-expanded", String(open));
    ui.mixer.hidden = !open;
  });

  return {
    mixerDrawer: ui.mixer,

    renderSong(next) {
      song = next;
      ui.title.textContent = next.title;
      ui.meta.textContent = [
        next.reference ? `Original · ${GENRES[next.genre].name}` : GENRES[next.genre].name,
        keyName(next.key),
        `${next.bpm} BPM`,
      ].join(" · ");
      ui.seek.max = String(next.totalBars);
      ui.seek.setAttribute("aria-label", `Position in “${next.title}”`);
      ui.total.textContent = clock(songSeconds(next));
    },

    renderBar(next, bar, mixOut) {
      if (next !== song) this.renderSong(next);
      heard = { bar, at: performance.now(), seconds: barSeconds(next) };
      showPosition(bar);
      ui.mixOut.hidden = !mixOut;
      if (mixOut) {
        const total = next.totalBars;
        ui.mixOut.style.left = `${(mixOut.from / total) * 100}%`;
        ui.mixOut.style.width = `${(Math.max(1, mixOut.swap - mixOut.from) / total) * 100}%`;
      }
    },

    renderPlayState(state) {
      const loading = "loading" in state;
      playing = !loading && state.playing;
      ui.play.classList.toggle("playing", playing);
      ui.play.classList.toggle("loading", loading);
      ui.play.disabled = loading;
      ui.loading.textContent = loading ? state.loading : "";
      ui.play.setAttribute("aria-label", loading ? state.loading : playing ? "Pause" : "Play");
      ui.play.title = `${playing ? "Pause" : "Play"} (Space)`;
      heard = { ...heard, at: performance.now() };
    },

    renderMix(text) {
      ui.mix.hidden = !text;
      ui.mix.textContent = text ?? "";
    },

    renderBuffer(status) {
      ui.buffer.hidden = !status;
      ui.buffer.classList.toggle("waiting", !!status?.waiting);
      ui.buffer.textContent = status?.text ?? "";
    },

    renderSaved(saved, title) {
      ui.save.setAttribute("aria-pressed", String(saved));
      ui.save.textContent = saved ? "♥ Saved" : "♡ Save";
      ui.save.title = saved ? `“${title}” is in My songs: click to remove it` : "Keep this song";
    },

    renderSettings(s) {
      ui.dj.setAttribute("aria-pressed", String(s.dj));
      ui.dj.disabled = !!s.djUnavailable;
      ui.djState.textContent = s.dj ? "On" : "Off";
      ui.djDesc.textContent = s.djUnavailable ?? djDesc;
      ui.repeat.setAttribute("aria-pressed", String(s.repeat));
      ui.lite.checked = s.lite;
      ui.lite.disabled = !!s.liteFixed;
      if (s.liteFixed) ui.lite.parentElement!.title = s.liteFixed;
      if (s.genre === "custom") {
        if (!custom.parentElement) ui.genre.append(custom);
      } else custom.remove();
      ui.genre.value = s.genre;
      ui.volume.value = String(s.volume);
    },

    renderLists({ history, favourites, originals }) {
      renderRows(ui.history, history, actions.playHistory, (row) => {
        const heart = smallButton(
          row.saved ? "♥" : "♡",
          row.saved ? `Remove “${row.title}” from Favourites` : `Keep “${row.title}” in Favourites`,
          () => actions.toggleHistorySaved(row.id),
        );
        heart.setAttribute("aria-pressed", String(!!row.saved));
        heart.classList.add("heart");
        return [heart];
      });
      ui.historyEmpty.hidden = history.length > 0;
      renderRows(ui.favourites, favourites, actions.playFavourite, (row) => [
        smallButton("⤴", `Copy a link to “${row.title}”`, (b) => actions.shareFavourite(row.id, b)),
        smallButton("×", `Remove “${row.title}” from Favourites`, () =>
          actions.removeFavourite(row.id),
        ),
      ]);
      ui.favouritesEmpty.hidden = favourites.length > 0;
      ui.favouritesCount.textContent = favourites.length ? String(favourites.length) : "";
      renderRows(ui.originals, originals, actions.playOriginal);
    },

    renderMixNext({ shown, enabled, label, title }) {
      ui.mixNext.hidden = !shown;
      ui.mixNext.disabled = !enabled;
      ui.mixNextLabel.textContent = label;
      ui.mixNext.title = title;
    },

    renderListStatus(text, undo) {
      ui.listStatus.replaceChildren(text);
      if (!undo) return;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "link";
      b.textContent = "Undo";
      b.addEventListener("click", () => {
        ui.listStatus.textContent = "";
        undo();
      });
      ui.listStatus.append(" ", b);
    },

    setShown(on) {
      shown = on;
      if (on && song) showPosition(position());
    },
  };
}
