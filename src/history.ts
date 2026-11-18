/**
 * "Previous songs": the songs heard in this browser, newest first, the last HISTORY_SIZE kept
 * across visits. A song counts once it is heard, not when it is composed. Each entry holds what
 * plays it again exactly: the song as a creation in the link format (played back once, not as an
 * edit), or an original's id. Previous and Next walk through it (main.ts).
 */
import type { ReferenceId } from "./references";

export const HISTORY_KEY = "infinite-synthpop:history:v1";
export const HISTORY_SIZE = 50;
/** A song left before this many seconds were heard was skipped (For you, foryou.ts). */
export const QUICK_SKIP_SECONDS = 30;

export interface HistoryEntry {
  id: string;
  title: string;
  /** "Synthpop · D minor · 118 BPM", for the list. */
  summary: string;
  /** When it was last heard. */
  at: number;
  /** encodeCreation() of its seed and spec: what plays it again, and what ♡ keeps. */
  data: string;
  /** An original plays as one again. */
  reference?: ReferenceId;
  /** What the song is, for ♡ (SavedSong.from). */
  origin?: string;
  /** The My songs entry it was played from. */
  saved?: string;
  /** Seconds heard the last time it played, once it was left for another song. */
  heard?: number;
}

export type NewEntry = Omit<HistoryEntry, "id" | "at">;

type Store = Pick<Storage, "getItem" | "setItem">;

export class History {
  private entries: HistoryEntry[] = [];
  private serial = 0;

  constructor(
    private readonly store: Store | null,
    private readonly now: () => number = Date.now,
  ) {
    try {
      const raw = store?.getItem(HISTORY_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) this.entries = parsed.filter(isEntry).slice(0, HISTORY_SIZE);
    } catch {
      this.entries = [];
    }
  }

  /** Newest first. */
  list(): readonly HistoryEntry[] {
    return this.entries;
  }

  get(id: string): HistoryEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  /**
   * A song starts being heard. The same song as the newest entry (played again, on repeat) moves
   * that entry's time on instead of adding another.
   */
  record(entry: NewEntry): HistoryEntry {
    const top = this.entries[0];
    if (top && sameSong(top, entry)) {
      Object.assign(top, entry, { at: this.now() });
      this.persist();
      return top;
    }
    const added: HistoryEntry = { ...entry, id: this.newId(), at: this.now() };
    this.entries = [added, ...this.entries].slice(0, HISTORY_SIZE);
    this.persist();
    return added;
  }

  /** The song an entry holds changed while it played (a setting recomposed it). */
  update(id: string, entry: NewEntry): void {
    const found = this.get(id);
    if (!found) return;
    // Fields the new song doesn't have go.
    for (const key of ["reference", "origin", "saved"] as const) delete found[key];
    Object.assign(found, entry);
    this.persist();
  }

  /** Another song took over from this entry, `seconds` into it. */
  left(id: string, seconds: number): void {
    const found = this.get(id);
    if (!found) return;
    found.heard = Math.round(seconds);
    this.persist();
  }

  /** The entry heard before this one (Previous). */
  older(id: string): HistoryEntry | undefined {
    const i = this.entries.findIndex((e) => e.id === id);
    return i === -1 ? undefined : this.entries[i + 1];
  }

  /** The entry heard after this one (Next, after going back); none from the newest. */
  newer(id: string): HistoryEntry | undefined {
    const i = this.entries.findIndex((e) => e.id === id);
    return i <= 0 ? undefined : this.entries[i - 1];
  }

  private newId(): string {
    return `${this.now().toString(36)}-${(this.serial++).toString(36)}`;
  }

  private persist(): void {
    try {
      this.store?.setItem(HISTORY_KEY, JSON.stringify(this.entries));
    } catch {
      // Storage blocked or full: the list lasts for this visit.
    }
  }
}

/** Left within QUICK_SKIP_SECONDS (not when it played on to its end or the page closed). */
export function quickSkip(entry: HistoryEntry): boolean {
  return typeof entry.heard === "number" && entry.heard < QUICK_SKIP_SECONDS;
}

function sameSong(a: NewEntry, b: NewEntry): boolean {
  return a.reference ? a.reference === b.reference : a.data === b.data;
}

function isEntry(v: unknown): v is HistoryEntry {
  const e = v as Partial<HistoryEntry> | null;
  return (
    !!e &&
    typeof e.id === "string" &&
    typeof e.title === "string" &&
    typeof e.at === "number" &&
    typeof e.data === "string"
  );
}
