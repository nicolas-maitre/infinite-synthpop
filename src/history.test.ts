import { describe, expect, it } from "vitest";
import { History, HISTORY_KEY, HISTORY_SIZE, type NewEntry } from "./history";

function memoryStore(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const song = (n: number): NewEntry => ({ title: `Song ${n}`, summary: "", data: `d${n}` });

describe("History", () => {
  it("lists songs newest first and keeps them in storage", () => {
    const store = memoryStore();
    let t = 0;
    const h = new History(store, () => ++t);
    h.record(song(1));
    h.record({ title: "True Faith", summary: "", data: "tf", reference: "true-faith" });
    expect(h.list().map((e) => e.title)).toEqual(["True Faith", "Song 1"]);
    expect(new History(store).list().map((e) => e.title)).toEqual(["True Faith", "Song 1"]);
  });

  it("moves the newest entry on when the same song is heard again", () => {
    let t = 0;
    const h = new History(memoryStore(), () => ++t);
    const first = h.record(song(1));
    const heard = first.at;
    const again = h.record(song(1));
    expect(again.id).toBe(first.id);
    expect(h.list()).toHaveLength(1);
    expect(again.at).toBeGreaterThan(heard);
  });

  it(`keeps the last ${HISTORY_SIZE}`, () => {
    const h = new History(memoryStore());
    for (let i = 0; i < HISTORY_SIZE + 5; i++) h.record(song(i));
    expect(h.list()).toHaveLength(HISTORY_SIZE);
    expect(h.list()[0]!.title).toBe(`Song ${HISTORY_SIZE + 4}`);
  });

  it("walks back and forward from an entry", () => {
    const h = new History(memoryStore());
    const [a, b, c] = [h.record(song(1)), h.record(song(2)), h.record(song(3))];
    expect(h.older(c.id)?.id).toBe(b.id);
    expect(h.older(a.id)).toBeUndefined();
    expect(h.newer(a.id)?.id).toBe(b.id);
    expect(h.newer(c.id)).toBeUndefined();
  });

  it("updates an entry whose song was recomposed, dropping what no longer applies", () => {
    const h = new History(memoryStore());
    const e = h.record({ ...song(1), saved: "x", origin: "seed:1" });
    h.update(e.id, { title: "Song 1b", summary: "", data: "d1b" });
    expect(h.get(e.id)).toMatchObject({ title: "Song 1b", data: "d1b" });
    expect(h.get(e.id)?.saved).toBeUndefined();
  });

  it("ignores stored entries it can't play", () => {
    const store = memoryStore({
      [HISTORY_KEY]: JSON.stringify([
        { id: "a", title: "x", at: 1, reference: "true-faith" },
        { nope: true },
      ]),
    });
    expect(new History(store).list()).toEqual([]);
  });
});
