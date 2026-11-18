import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPrefs } from "./prefs";

function stored(prefs: object | null): void {
  const raw = prefs === null ? null : JSON.stringify(prefs);
  vi.stubGlobal("localStorage", { getItem: () => raw, setItem: () => {} });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPrefs", () => {
  it("opens a first visit on the simple view, with DJ mode on", () => {
    stored(null);
    const p = loadPrefs();
    expect(p.view).toBe("simple");
    expect(p.dj).toBe(true);
    expect(p.repeat).toBe(false);
  });

  it("turns DJ mode on once for settings saved before it was the default", () => {
    stored({ dj: false, genre: "italo" });
    const p = loadPrefs();
    expect(p.dj).toBe(true);
    expect(p.djDefaulted).toBe(true);
    expect(p.view).toBe("simple");
  });

  it("keeps DJ mode off once it was turned off after that", () => {
    stored({ dj: false, djDefaulted: true, view: "advanced", repeat: true });
    const p = loadPrefs();
    expect(p.dj).toBe(false);
    expect(p.view).toBe("advanced");
    expect(p.repeat).toBe(true);
  });

  it("hands out a fresh copy of the defaults each time", () => {
    stored(null);
    const a = loadPrefs();
    a.volumes.drums = -12;
    expect(loadPrefs().volumes.drums).not.toBe(-12);
  });

  it("keeps the station chosen, and Any for one it doesn't know", () => {
    stored({ station: "for-you", genre: "open" });
    expect(loadPrefs().station).toBe("for-you");
    stored({ station: "polka" });
    expect(loadPrefs().station).toBe("auto");
    stored(null);
    expect(loadPrefs().station).toBe("auto");
  });
});
