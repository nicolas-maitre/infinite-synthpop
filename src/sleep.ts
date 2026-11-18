/**
 * The player's sleep timer: after some minutes, or at the end of the playing song, the music
 * fades out and pauses. Play afterwards goes on from there (for "end of this song", the next song
 * from its start).
 *
 * Minutes count wall time, as phones' and players' sleep timers do: pausing doesn't hold the
 * timer, and one that runs out while paused just turns off. It survives song changes; picking a
 * song by hand cancels "end of this song". Not kept across reloads.
 */

/** Off, the end of the playing song, or minutes from now. */
export type SleepChoice = "off" | "song" | number;

/** The choices the player offers (the dev hook takes any minutes). */
export const SLEEP_CHOICES: readonly SleepChoice[] = ["off", "song", 15, 30, 45, 60];

/** The minutes timer fades out over this long, reaching silence at the time set. */
export const SLEEP_FADE_SECONDS = 10;
/** End of this song: the fade over its last seconds. */
export const END_FADE_SECONDS = 8;

/** Time left as m:ss, rounded up (the last second shows 0:01, not 0:00). */
export function timeLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The sleep button's text: "Sleep" while off, else what's left. */
export function sleepLabel(choice: SleepChoice, msLeft: number): string {
  if (choice === "off") return "Sleep";
  if (choice === "song") return "End of song";
  return `Sleep ${timeLeft(msLeft)}`;
}

/** A choice in the menu. */
export function choiceName(choice: SleepChoice): string {
  if (choice === "off") return "Off";
  if (choice === "song") return "End of this song";
  return `${choice} min`;
}

/**
 * A minutes timer at `now`: wait this long for the fade, fade out over the seconds left, or over
 * (the time set has come).
 */
export function sleepStep(
  deadline: number,
  now: number,
  fadeSeconds = SLEEP_FADE_SECONDS,
): { wait: number } | { fade: number } | "over" {
  const left = deadline - now;
  if (left <= 0) return "over";
  if (left <= fadeSeconds * 1000) return { fade: left / 1000 };
  return { wait: left - fadeSeconds * 1000 };
}

/**
 * End of this song: checked as each of its bars starts (at `time`, `untilEnd` seconds before it
 * ends), where its fade starts (`time` itself when it should be under way already); null while the
 * next bar's check is still early enough.
 */
export function endFadeStart(
  time: number,
  untilEnd: number,
  barSeconds: number,
  fadeSeconds = END_FADE_SECONDS,
): number | null {
  // A second's slack: the bar callbacks run late in a background tab.
  if (untilEnd - barSeconds > fadeSeconds + 1) return null;
  return Math.max(time, time + untilEnd - fadeSeconds);
}

/** What the timer needs of the engine. */
export interface SleepEngine {
  readonly playing: boolean;
  /** "End of this song" is set (another song by hand clears it). */
  readonly endingSong: boolean;
  endSong(on: boolean): void;
  /** Fades out over `seconds` from now, then pauses. */
  fadeOut(seconds: number): void;
  cancelFade(): void;
}

export interface SleepState {
  choice: SleepChoice;
  label: string;
}

/** The timer itself: main.ts tells it about songs, play state and the engine's fade ending. */
export class SleepTimer {
  private choice: SleepChoice = "off";
  private deadline = 0;
  /** The minutes timer's fade is under way. */
  private fading = false;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly engine: SleepEngine,
    private readonly render: (state: SleepState) => void,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): SleepState {
    return { choice: this.choice, label: sleepLabel(this.choice, this.deadline - this.now()) };
  }

  /** Off, the end of this song, or minutes from now (any number: the dev hook's short ones). */
  set(choice: SleepChoice): void {
    if (this.choice === "song" && choice !== "song") this.engine.endSong(false);
    if (this.fading) this.engine.cancelFade();
    this.fading = false;
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
    this.choice = choice;
    if (choice === "song") this.engine.endSong(true);
    else if (typeof choice === "number") {
      this.deadline = this.now() + choice * 60_000;
      this.ticker = setInterval(() => this.tick(), 250);
      this.tick();
      return;
    }
    this.render(this.state);
  }

  /** The playing song changed: by hand (or a creation's loop) ends "end of this song". */
  songChanged(): void {
    if (this.choice === "song" && !this.engine.endingSong) this.set("off");
  }

  /** Paused (by hand, or the fade's end): a minutes fade stops with it. */
  playState(playing: boolean): void {
    if (!playing) this.fading = false;
  }

  /** The engine's fade ended in a pause: done. */
  slept(): void {
    this.fading = false;
    this.set("off");
  }

  private tick(): void {
    const step = sleepStep(this.deadline, this.now());
    if (step === "over") {
      // Paused when the time came, or the fade's pause is late (a second's grace): done.
      if (!this.fading || this.now() > this.deadline + 2000) this.set("off");
      return;
    }
    if ("fade" in step && !this.fading && this.engine.playing) {
      this.fading = true;
      this.engine.fadeOut(step.fade);
    }
    this.render(this.state);
  }
}
