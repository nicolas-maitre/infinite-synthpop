import { afterEach, describe, expect, it, vi } from "vitest";
import {
  endFadeStart,
  sleepLabel,
  sleepStep,
  SleepTimer,
  timeLeft,
  type SleepEngine,
  type SleepState,
} from "./sleep";

describe("timeLeft", () => {
  it("shows m:ss, rounding up so the last second isn't 0:00", () => {
    expect(timeLeft(60 * 60_000)).toBe("60:00");
    expect(timeLeft(23 * 60_000 + 41_000)).toBe("23:41");
    expect(timeLeft(23 * 60_000 + 40_200)).toBe("23:41");
    expect(timeLeft(400)).toBe("0:01");
    expect(timeLeft(0)).toBe("0:00");
    expect(timeLeft(-5000)).toBe("0:00");
  });
});

describe("sleepLabel", () => {
  it("names the choice on the button", () => {
    expect(sleepLabel("off", 0)).toBe("Sleep");
    expect(sleepLabel("song", 0)).toBe("End of song");
    expect(sleepLabel(30, 29 * 60_000 + 5_000)).toBe("Sleep 29:05");
  });
});

describe("sleepStep", () => {
  it("waits, then fades over what's left, then is over", () => {
    expect(sleepStep(100_000, 50_000, 10)).toEqual({ wait: 40_000 });
    expect(sleepStep(100_000, 90_000, 10)).toEqual({ fade: 10 });
    expect(sleepStep(100_000, 96_500, 10)).toEqual({ fade: 3.5 });
    expect(sleepStep(100_000, 100_000, 10)).toBe("over");
    expect(sleepStep(100_000, 120_000, 10)).toBe("over");
  });
});

describe("endFadeStart", () => {
  const bar = 2;
  it("waits while a later bar can still start the fade in time", () => {
    expect(endFadeStart(0, 20, bar, 8)).toBeNull();
    expect(endFadeStart(0, 11.5, bar, 8)).toBeNull();
  });
  it("starts the fade its length before the end, from the last bar that can", () => {
    expect(endFadeStart(100, 10, bar, 8)).toBe(102);
    expect(endFadeStart(100, 8, bar, 8)).toBe(100);
  });
  it("starts at once when the end is nearer than the fade", () => {
    expect(endFadeStart(100, 3, bar, 8)).toBe(100);
  });
});

/** A stand-in engine that records what the timer asks of it. */
function fakeEngine(): SleepEngine & { calls: string[]; ending: boolean; playing: boolean } {
  const engine = {
    playing: true,
    ending: false,
    calls: [] as string[],
    get endingSong() {
      return engine.ending;
    },
    endSong(on: boolean) {
      engine.ending = on;
      engine.calls.push(`endSong ${on}`);
    },
    fadeOut(seconds: number) {
      engine.calls.push(`fadeOut ${seconds}`);
    },
    cancelFade() {
      engine.calls.push("cancelFade");
    },
  };
  return engine;
}

describe("SleepTimer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    vi.useFakeTimers();
    const engine = fakeEngine();
    const states: SleepState[] = [];
    const timer = new SleepTimer(
      engine,
      (s) => states.push(s),
      () => Date.now(),
    );
    return { engine, states, timer };
  };

  it("fades out its fade before the time is up, and turns off once paused", () => {
    const { engine, states, timer } = setup();
    timer.set(1);
    expect(states.at(-1)?.label).toBe("Sleep 1:00");
    vi.advanceTimersByTime(49_000);
    expect(engine.calls).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(engine.calls).toEqual(["fadeOut 10"]);
    // The engine's fade ends in a pause.
    timer.playState(false);
    timer.slept();
    expect(states.at(-1)).toEqual({ choice: "off", label: "Sleep" });
  });

  it("counts wall time: paused when the time comes, it just turns off", () => {
    const { engine, states, timer } = setup();
    engine.playing = false;
    timer.set(1);
    vi.advanceTimersByTime(60_000);
    expect(engine.calls).toEqual([]);
    expect(states.at(-1)?.choice).toBe("off");
  });

  it("fades over what's left when play resumes during the last seconds", () => {
    const { engine, timer } = setup();
    engine.playing = false;
    timer.set(1);
    vi.advanceTimersByTime(56_000);
    engine.playing = true;
    vi.advanceTimersByTime(250);
    expect(engine.calls).toEqual(["fadeOut 3.75"]);
  });

  it("survives song changes; another choice cancels the fade", () => {
    const { engine, timer } = setup();
    timer.set(1);
    timer.songChanged();
    vi.advanceTimersByTime(52_000);
    timer.set(15);
    expect(engine.calls).toEqual(["fadeOut 10", "cancelFade"]);
    expect(timer.state.label).toBe("Sleep 15:00");
  });

  it("end of this song: set on the engine, cancelled by another song or Off", () => {
    const { engine, timer } = setup();
    timer.set("song");
    expect(engine.calls).toEqual(["endSong true"]);
    expect(timer.state.label).toBe("End of song");
    // A recomposed song (still the one ending) keeps it.
    timer.songChanged();
    expect(timer.state.choice).toBe("song");
    // Another song by hand: the engine no longer ends this one.
    engine.ending = false;
    timer.songChanged();
    expect(timer.state.choice).toBe("off");
    timer.set("song");
    timer.set("off");
    expect(engine.calls.at(-1)).toBe("endSong false");
  });
});
