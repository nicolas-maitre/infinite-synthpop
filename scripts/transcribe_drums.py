"""Transcribe a Demucs drum stem onto a 16th grid, one row per bar: kick, snare, hats, open hats, toms.

Separate the recording first (see transcribe_bass.py), then:

    .venv/bin/python -I scripts/transcribe_drums.py stems/htdemucs/song --downbeat 0.70 \
        [--sections 0-6,6-14,…] [--bars 0-40]

The grid is a straight line fitted through the beat tracker's beats on the drum stem (a drum
machine doesn't drift), anchored on --downbeat, the time in seconds of any bar's first beat.
--bars prints those bars one by one; --sections gives each section the share of its bars that hit
each 16th, per instrument, which is what the pattern tables in docs/analysis.md quote.

Each instrument is a level rise in bands of the drum stem, in a window around the grid point,
compared with the band's loud hits (its 95th-percentile peak level):
    K kick       35–90 Hz rises 8 dB, within 10 dB of the loud kicks (the window reaches later:
                 the low band lags the attack)
    S snare      150–300 Hz and 1–4 kHz both rise; the body within 5 dB of the loud hits, which a
                 kick's body (about 10 dB under a snare's) doesn't reach
    h hat        7–16 kHz rises 5 dB, decaying more than 10 dB within 90 ms
    o open hat   7–16 kHz, still within 10 dB of its peak 90 ms later, and no snare on that 16th
                 (a snare's tail fills the hat band)
    T tom        150–300 Hz rises without a 1–4 kHz crack or a kick, and is pitched
The thresholds were set on "You Came"; trust shares near 1.0 and 0.0, and check anything in
between by printing the bars (--bars).
"""

import argparse
from pathlib import Path

import librosa
import numpy as np
import scipy.signal as sg

SR = 44100
HOP = 128
COUNTS = ["1", "e", "&", "a", "2", "e", "&", "a", "3", "e", "&", "a", "4", "e", "&", "a"]


def band(y, lo, hi):
    return sg.sosfiltfilt(sg.butter(4, [lo, hi], btype="band", fs=SR, output="sos"), y)


def band_db(y, lo, hi):
    r = librosa.feature.rms(y=band(y, lo, hi), frame_length=512, hop_length=HOP)[0]
    return librosa.times_like(r, sr=SR, hop_length=HOP), 20 * np.log10(r + 1e-7)


class Band:
    """Level of one band around grid points: peak in a window, the rise into it, and the tail."""

    def __init__(self, y, lo, hi, early, late):
        self.t, self.db = band_db(y, lo, hi)
        self.early, self.late = early, late

    def at(self, g):
        i0 = np.searchsorted(self.t, g - self.early)
        i1 = np.searchsorted(self.t, g + self.late)
        j = i0 + int(np.argmax(self.db[i0:i1]))
        pre = self.db[max(0, i0 - 4) : i0 + 1].min()
        tail = self.db[min(len(self.db) - 1, j + int(0.09 * SR / HOP))]
        return self.db[j], self.db[j] - pre, self.db[j] - tail


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stem_dir", type=Path)
    ap.add_argument("--downbeat", type=float, required=True, help="time (s) of any bar's first beat")
    ap.add_argument("--sections", help="bar ranges to summarise, e.g. 0-6,6-14 (end exclusive)")
    ap.add_argument("--bars", help="bar range to print bar by bar, e.g. 0-40")
    args = ap.parse_args()

    y = librosa.load(args.stem_dir / "drums.wav", sr=SR, mono=True)[0]
    _, beats = librosa.beat.beat_track(y=y, sr=SR, units="time", start_bpm=119, tightness=600)
    while np.median(np.diff(beats)) > 0.75:  # locked to half tempo
        beats = np.sort(np.concatenate([beats, (beats[:-1] + beats[1:]) / 2]))
    n = np.arange(len(beats))
    trim = len(beats) // 10
    slope = np.polyfit(n[trim:-trim], beats[trim:-trim], 1)[0]
    bar_len = 4 * slope
    first = args.downbeat - np.floor(args.downbeat / bar_len) * bar_len
    n_bars = int((len(y) / SR - first) / bar_len)
    six = slope / 4
    print(f"{60 / slope:.2f} BPM, bar 0 at {first:.2f}s, {n_bars} bars")

    # Measured on "You Came": hat and snare onsets read about 30 ms before the line, the kick's
    # low band about 20 ms after it.
    kick = Band(y, 35, 90, 0.02, 0.07)
    body = Band(y, 150, 300, 0.05, 0.04)
    crack = Band(y, 1000, 4000, 0.05, 0.03)
    hat = Band(y, 7000, 16000, 0.05, 0.03)
    yl = band(y, 60, 400)

    def pitched(g):
        seg = yl[int(g * SR) : int((g + 0.12) * SR)]
        if len(seg) < 256:
            return False
        X = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), 8192))
        f = np.fft.rfftfreq(8192, 1 / SR)
        sel = (f > 70) & (f < 300)
        return X[sel].max() > 8 * np.median(X[sel])

    pts = [first + b * bar_len + k * six for b in range(n_bars) for k in range(16)]
    levels = {name: np.array([x.at(g) for g in pts]) for name, x in
              (("kick", kick), ("body", body), ("crack", crack), ("hat", hat))}
    # Reference level per band: the loud hits (95th percentile of the peaks).
    ref = {name: np.percentile(v[:, 0], 95) for name, v in levels.items()}

    grid = np.zeros((n_bars, 16, 5))  # K S h o T
    for i, g in enumerate(pts):
        b, k = divmod(i, 16)
        kl, kr, _ = levels["kick"][i]
        bl, br, _ = levels["body"][i]
        cl, cr, _ = levels["crack"][i]
        hl, hr, ht = levels["hat"][i]
        K = kr > 8 and kl > ref["kick"] - 10
        # A kick has a body too, about 10 dB under a snare's; the snare needs both bands.
        S = br > 5 and bl > ref["body"] - 5 and cr > 5 and cl > ref["crack"] - 8
        H = hr > 5 and hl > ref["hat"] - 18
        # A snare's tail fills the hat band, so "open" only counts away from snares.
        O = H and not S and ht < 10
        T = (not S) and (not K) and br > 8 and bl > ref["body"] - 8 and cl < ref["crack"] - 12 and pitched(g)
        grid[b, k] = [K, S, H and not O, O, T]

    letters = "KShoT"

    def cell(v):
        s = "".join(letters[i] for i in range(5) if v[i])
        return s or "."

    if args.bars:
        a, z = (int(v) for v in args.bars.split("-"))
        print("            " + "".join(f"{c:<5}" for c in COUNTS))
        for b in range(a, min(z, n_bars)):
            t = first + b * bar_len
            print(f"{b:3d} {int(t // 60)}:{t % 60:05.2f} " + "".join(f"{cell(grid[b, k]):<5}" for k in range(16)))
    if args.sections:
        for r in args.sections.split(","):
            a, z = (int(v) for v in r.split("-"))
            share = grid[a:z].mean(axis=0)
            t = first + a * bar_len
            print(f"\nbars {a}-{z - 1} ({int(t // 60)}:{t % 60:04.1f}), share of bars hitting each 16th")
            print("     " + "".join(f"{c:>5}" for c in COUNTS))
            for i, name in enumerate(["kick", "snare", "hat", "open", "tom"]):
                print(f"{name:<5}" + "".join(f"{v:5.2f}" for v in share[:, i]))


if __name__ == "__main__":
    main()
