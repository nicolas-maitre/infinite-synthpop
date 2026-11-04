/**
 * "My songs": the songs kept in this browser. Every creation (creator mode, the wizard, a blank
 * song, a link opened here) saves itself as its own entry; generated songs and the originals join
 * when you press ♥ Save. An entry holds its creation in the link format, so playing one back sounds
 * the same as when it was saved, and sharing one is just its link.
 */
import { decodeCreation, encodeCreation, newSongId, type Creation } from "./spec";

export const LIBRARY_KEY = "infinite-synthpop:songs:v1";

export interface SavedSong {
  id: string;
  title: string;
  /** "D minor · 118 BPM · 96 bars", for the list. */
  summary: string;
  /** encodeCreation(): what a #song= link carries. */
  data: string;
  /**
   * For a song kept with ♥ Save: the generated song or original it was ("seed:1234",
   * "ref:true-faith"), so the heart shows it as saved while that song plays.
   */
  from?: string;
  created: number;
  updated: number;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class Library {
  private songs: SavedSong[] = [];
  /** Set when the browser refused to store the list (private mode, storage full). */
  failed = false;

  constructor(
    private readonly store: Store | null,
    private readonly now: () => number = Date.now,
  ) {
    try {
      const raw = store?.getItem(LIBRARY_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) this.songs = parsed.filter(isSavedSong);
    } catch {
      this.songs = [];
    }
  }

  /** Most recently changed first. */
  list(): readonly SavedSong[] {
    return [...this.songs].sort((a, b) => b.updated - a.updated);
  }

  get(id: string): SavedSong | undefined {
    return this.songs.find((s) => s.id === id);
  }

  /** The entry a song came from (see SavedSong.from). */
  findFrom(from: string): SavedSong | undefined {
    return this.songs.find((s) => s.from === from);
  }

  /** The newest entry holding exactly this creation (a link opened again, a page reload). */
  findData(data: string): SavedSong | undefined {
    return this.list().find((s) => s.data === data);
  }

  /** The entry as a playable creation, carrying its id. */
  creation(id: string): Creation | null {
    const song = this.get(id);
    const creation = song ? decodeCreation(song.data) : null;
    return creation && song ? { ...creation, id: song.id } : null;
  }

  /**
   * Saves a creation under its id (a new entry without one). The entry only counts as changed,
   * and moves to the top, when the song itself did.
   */
  save(creation: Creation, summary: string, from?: string): SavedSong {
    const data = encodeCreation(creation);
    const existing = creation.id ? this.get(creation.id) : undefined;
    if (existing) {
      if (existing.data !== data || existing.title !== creation.spec.title) {
        Object.assign(existing, {
          data,
          title: creation.spec.title,
          summary,
          updated: this.now(),
        });
        this.persist();
      }
      return existing;
    }
    const at = this.now();
    const song: SavedSong = {
      id: creation.id ?? newSongId(),
      title: creation.spec.title,
      summary,
      data,
      ...(from ? { from } : {}),
      created: at,
      updated: at,
    };
    this.songs.push(song);
    this.persist();
    return song;
  }

  remove(id: string): SavedSong | undefined {
    const i = this.songs.findIndex((s) => s.id === id);
    const [gone] = i === -1 ? [] : this.songs.splice(i, 1);
    if (gone) this.persist();
    return gone;
  }

  /** Puts a removed entry back (undo). */
  restore(song: SavedSong): void {
    if (this.get(song.id)) return;
    this.songs.push(song);
    this.persist();
  }

  /**
   * Moves the single creation earlier versions kept (under `key`) into the list, once.
   */
  migrate(key: string, summary: (c: Creation) => string): void {
    try {
      const raw = this.store?.getItem(key);
      if (!raw) return;
      const creation = decodeCreation(raw);
      if (creation && !this.findData(encodeCreation(creation)))
        this.save(creation, summary(creation));
      this.store?.removeItem(key);
    } catch {
      // Nothing to move, or storage blocked.
    }
  }

  private persist(): void {
    try {
      this.store?.setItem(LIBRARY_KEY, JSON.stringify(this.songs));
      this.failed = false;
    } catch {
      this.failed = true; // Kept for this visit only; links still carry each song.
    }
  }
}

function isSavedSong(v: unknown): v is SavedSong {
  const s = v as Partial<SavedSong> | null;
  return (
    !!s &&
    typeof s.id === "string" &&
    typeof s.data === "string" &&
    typeof s.title === "string" &&
    typeof s.updated === "number"
  );
}
