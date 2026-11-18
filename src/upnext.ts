/**
 * The player's "Up next": what plays after the song playing when it ends on its own, and when it
 * comes in. Pick another sets the next song's seed for this playing of the song (the engine's
 * `following` and DJ plans read it through `followingSeed`).
 */
import { clock } from "./lengthslider";

/** Pick another: the seed chosen for the song after the playing one, for that playing (its
 * serial: a replay of the song later goes on as it would have). */
export interface NextPick {
  serial: number;
  seed: number;
}

/** The seed of the song after the one with `seed` (played as `serial`): the pick for that
 * playing, else the one derived from its seed. */
export function followingSeed(
  seed: number,
  serial: number,
  pick: NextPick | null,
  derive: (seed: number) => number,
): number {
  return pick?.serial === serial ? pick.seed : derive(seed);
}

/** How the next song comes in: mixed in by the DJ from bar `from` of the playing song (`swap`:
 * where it takes over), already mixing in, after the playing song ends, or the playing song again
 * (repeat on, or a creation, which loops). */
export type UpNextWhen =
  | { kind: "mix"; from: number; swap: number }
  | { kind: "mixing" }
  | { kind: "end" }
  | { kind: "sleep" }
  | { kind: "repeat" }
  | { kind: "loop" };

/** When it comes, for the Up next line; `barSeconds` is the playing song's (as its seek bar). */
export function upNextText(when: UpNextWhen, barSeconds: number): string {
  switch (when.kind) {
    case "mix":
      return `mixes in at ${clock(when.from * barSeconds)}`;
    case "mixing":
      return "mixing in now";
    case "end":
      return "after this song";
    case "sleep":
      return "when you play again: the sleep timer stops after this song";
    case "repeat":
      return "this song again";
    case "loop":
      return "this creation again: it loops";
  }
}

/** Pick another's tooltip: what it does, or why it can't now. */
export function pickHint(when: UpNextWhen["kind"], canPick: boolean): string {
  if (when === "repeat") return "Repeat is on: this song plays again";
  if (when === "loop") return "A creation loops: choose another song to move on";
  if (when === "mixing") return "The next song is already mixing in";
  if (!canPick) return "Too late to change: the next song is already on its way";
  return "Pick another song to play after this one";
}
