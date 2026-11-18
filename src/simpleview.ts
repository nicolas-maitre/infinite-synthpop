/**
 * The simple view: a music player over the same engine and settings as the advanced view. What's
 * playing, previous / play / next with a seek bar and repeat, DJ mode, lite playback, the volume
 * with the mixer under it, the genre that plays next, and the songs heard before, the favourites
 * and the originals. main.ts owns the state and calls the render methods; this only binds the
 * controls.
 */
import type { LengthRange, Song } from "./composer";
import { GENRE_IDS, GENRES, type GenreId } from "./genres";
import { influences } from "./influence";
import { sleeve } from "./inspiration";
import { barSeconds, songSeconds } from "./mediasession";
import { clock, LengthSlider } from "./lengthslider";
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
  /** Up next: another song after this one. */
  pickNext(): void;
  setLite(on: boolean): void;
  setGenre(genre: SimpleGenre): void;
  setLength(range: LengthRange): void;
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
  length: LengthRange;
  volume: number;
}

export interface SimpleView {
  renderSong(song: Song): void;
  /** A bar starts being heard (or the position moved while stopped). */
  renderBar(song: Song, bar: number, mixOut: { from: number; swap: number } | null): void;
  renderPlayState(state: { playing: boolean } | { loading: string }): void;
  renderMix(text: string | null): void;
  renderBuffer(status: { text: string; waiting: boolean } | null): void;
  /** Render-ahead playback: seconds rendered ahead of what is heard (null: none, or live). */
  renderBuffered(seconds: number | null): void;
  renderSaved(saved: boolean, title: string): void;
  renderSettings(settings: SimpleSettings): void;
  renderLists(lists: SongLists): void;
  /** Mix next: shown in DJ mode, enabled when it can start a transition. */
  renderMixNext(state: { shown: boolean; enabled: boolean; label: string; title: string }): void;
  /** Up next: the song after this one, when it comes, and whether Pick another can change it. */
  renderUpNext(state: { song: Song; when: string; canPick: boolean; pickHint: string }): void;
  /** A line under the lists ("Deleted …"), with an Undo when there's one. */
  renderListStatus(text: string, undo?: () => void): void;
  /** The view is shown or hidden (the progress only animates while shown). */
  setShown(shown: boolean): void;
  /** Where the mixer card goes while this view shows. */
  readonly mixerDrawer: HTMLElement;
  /** Full screen: the playing song alone, big (on or off; no argument toggles). */
  setFullScreen(on?: boolean): void;
}

/** A song's genre (or original), key and tempo, under its title. */
function songMeta(song: Song): string {
  return [
    song.reference ? `Original · ${GENRES[song.genre].name}` : GENRES[song.genre].name,
    keyName(song.key),
    `${song.bpm} BPM`,
  ].join(" · ");
}

function el<T extends HTMLElement>(root: HTMLElement, id: string): T {
  const node = root.querySelector<T>(`#${id}`);
  if (!node) throw new Error(`#${id} missing`);
  return node;
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
    played: el(root, "s-played"),
    buffered: el(root, "s-buffered"),
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
    full: el<HTMLButtonElement>(root, "s-full"),
    mini: el(root, "s-mini"),
    miniFill: el(root, "s-mini-fill"),
    miniInfo: el<HTMLButtonElement>(root, "s-mini-info"),
    miniTitle: el(root, "s-mini-title"),
    miniMeta: el(root, "s-mini-meta"),
    miniPlay: el<HTMLButtonElement>(root, "s-mini-play"),
    miniNext: el<HTMLButtonElement>(root, "s-mini-next"),
    mixNextLabel: el(root, "s-mix-next-label"),
    upNextCover: el(root, "s-upnext-cover"),
    upNextWhen: el(root, "s-upnext-when"),
    upNextTitle: el(root, "s-upnext-title"),
    upNextMeta: el(root, "s-upnext-meta"),
    upNextPick: el<HTMLButtonElement>(root, "s-upnext-pick"),
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
    const played = `${Math.min(100, (bar / song.totalBars) * 100)}%`;
    ui.miniFill.style.width = played;
    if (dragging) return;
    ui.seek.value = String(bar);
    ui.played.style.width = played;
  };
  animate(() => {
    if (shown && playing && song) showPosition(position());
  });

  // ── Mini player: once the player scrolls away, a bar at the bottom keeps it at hand ──
  let playerInView = true;
  const showMini = () => {
    ui.mini.hidden = !shown || playerInView || !song || fullScreen;
  };
  const player = ui.title.closest<HTMLElement>(".player");
  if (player && "IntersectionObserver" in window) {
    new IntersectionObserver(
      ([entry]) => {
        playerInView = !!entry?.isIntersecting;
        showMini();
      },
      // Mostly out of view: its transport has gone.
      { threshold: 0.25 },
    ).observe(player);
  }
  ui.miniPlay.addEventListener("click", () => actions.togglePlay());
  ui.miniNext.addEventListener("click", () => actions.next());
  ui.miniInfo.addEventListener("click", () =>
    player?.scrollIntoView({ behavior: "smooth", block: "start" }),
  );

  ui.seek.addEventListener("input", () => {
    dragging = true;
    if (!song) return;
    const bar = Number(ui.seek.value);
    ui.elapsed.textContent = clock(bar * barSeconds(song));
    ui.played.style.width = `${(bar / song.totalBars) * 100}%`;
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
  ui.upNextPick.addEventListener("click", () => actions.pickNext());
  ui.lite.addEventListener("change", () => actions.setLite(ui.lite.checked));
  ui.genre.addEventListener("change", () => {
    const v = ui.genre.value;
    if (v === "auto" || (GENRE_IDS as string[]).includes(v)) actions.setGenre(v as SimpleGenre);
  });
  ui.volume.addEventListener("input", () => actions.setVolume(Number(ui.volume.value)));

  // ── Length (lengthslider.ts) ──
  const length = new LengthSlider("s-length-label", (range) => actions.setLength(range));
  el(root, "s-length").replaceWith(length.element);

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

  // ── Full screen: the player alone, filling the screen (the browser's full screen when it
  // allows one, else just the page), the screen kept on while it plays ──
  let fullScreen = false;
  let wakeLock: WakeLockSentinel | null = null;
  const keepAwake = () => {
    const want = fullScreen && playing && document.visibilityState === "visible";
    if (want && !wakeLock && "wakeLock" in navigator) {
      navigator.wakeLock.request("screen").then(
        (lock) => {
          wakeLock = lock;
          lock.addEventListener("release", () => {
            if (wakeLock === lock) wakeLock = null;
          });
          // Released meanwhile: let it go at once.
          if (!(fullScreen && playing)) void lock.release();
        },
        () => {
          // Refused (battery saver, not visible): the screen may dim.
        },
      );
    } else if (!want && wakeLock) {
      void wakeLock.release();
      wakeLock = null;
    }
  };
  const setFullScreen = (on = !fullScreen) => {
    if (on === fullScreen) return;
    fullScreen = on;
    document.documentElement.classList.toggle("full-screen", on);
    showMini();
    ui.full.setAttribute("aria-pressed", String(on));
    label(ui.full, on ? "Leave full screen (F or Esc)" : "Full screen (F)");
    const page = document.documentElement;
    if (on && !document.fullscreenElement && page.requestFullscreen) {
      page.requestFullscreen().catch(() => {
        // Not allowed here (an iPhone, a frame): the page alone fills the window.
      });
    } else if (!on && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    keepAwake();
  };
  label(ui.full, "Full screen (F)");
  ui.full.addEventListener("click", () => setFullScreen());
  // The browser's own way out (Esc, a swipe) leaves the mode too.
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && fullScreen) setFullScreen(false);
  });
  // Esc leaves too, when the browser lets the page see it (or has no full screen of its own).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && fullScreen) setFullScreen(false);
  });
  document.addEventListener("visibilitychange", keepAwake);

  ui.mixerToggle.addEventListener("click", () => {
    const open = ui.mixerToggle.getAttribute("aria-expanded") !== "true";
    ui.mixerToggle.setAttribute("aria-expanded", String(open));
    ui.mixer.hidden = !open;
  });

  return {
    mixerDrawer: ui.mixer,
    setFullScreen,

    renderSong(next) {
      song = next;
      ui.title.textContent = next.title;
      ui.miniTitle.textContent = next.title;
      ui.meta.textContent = songMeta(next);
      ui.miniMeta.textContent = ui.meta.textContent;
      showMini();
      ui.seek.max = String(next.totalBars);
      // A new song's render starts from nothing shown.
      ui.buffered.style.width = "0%";
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
      const now = !loading && state.playing;
      // Paused or stopped: the position holds where it got to.
      if (playing && !now) heard = { ...heard, bar: position() };
      playing = now;
      showPosition(heard.bar);
      ui.play.classList.toggle("playing", playing);
      ui.miniPlay.classList.toggle("playing", playing);
      ui.miniPlay.setAttribute("aria-label", playing ? "Pause" : "Play");
      ui.play.classList.toggle("loading", loading);
      ui.play.disabled = loading;
      ui.loading.textContent = loading ? state.loading : "";
      ui.play.setAttribute("aria-label", loading ? state.loading : playing ? "Pause" : "Play");
      ui.play.title = `${playing ? "Pause" : "Play"} (Space)`;
      heard = { ...heard, at: performance.now() };
      keepAwake();
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

    renderBuffered(seconds) {
      ui.buffered.hidden = seconds === null || !song || !playing;
      if (ui.buffered.hidden || !song || seconds === null) return;
      // Where the render has got to in this song (past its end, it renders the next one).
      const to = position() + seconds / barSeconds(song);
      ui.buffered.style.width = `${Math.min(100, (to / song.totalBars) * 100)}%`;
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
      length.set(s.length);
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

    renderUpNext({ song: next, when, canPick, pickHint }) {
      ui.upNextTitle.textContent = next.title;
      ui.upNextMeta.textContent = songMeta(next);
      ui.upNextWhen.textContent = `· ${when}`;
      ui.upNextPick.disabled = !canPick;
      ui.upNextPick.title = pickHint;
      // Its main influence's sleeve, kept while that stays the same.
      const main = influences(next)[0]?.id ?? "";
      if ((ui.upNextCover.dataset.ref ?? "") !== main) {
        ui.upNextCover.dataset.ref = main;
        ui.upNextCover.replaceChildren(...(main ? [sleeve(main, false)] : []));
      }
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
      showMini();
      if (on && song) showPosition(position());
    },
  };
}
