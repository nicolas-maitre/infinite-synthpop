"""Transcribe a separated part onto a bar grid, one row per bar, one column per 16th.

Separate the recording first, with Demucs:

    .venv/bin/python -m demucs -n htdemucs -o stems excerpt.wav            # drums/bass/other/vocals
    .venv/bin/python -m demucs --two-stems bass -n htdemucs -o stems x.wav  # bass/no_bass

Then:

    .venv/bin/python -I scripts/transcribe_bass.py stems/htdemucs/excerpt [--part other]
        [--fmax 700] [--offset SECONDS]

The grid comes from the drums (drums.wav, or no_bass.wav): beats from the beat tracker, beats 2
and 4 from the snare, and bar 1 from where the part changes pitch. Each cell shows the note when
one starts on that 16th, "-" while it is held, "." for silence. Pitches are pYIN on the separated
part; for chord parts only the rhythm is meaningful.

The same works on the generator's own stems: renderToDisk(opts, bars, ["bass"]) and ["drums"].
"""

import argparse
from pathlib import Path

import librosa
import numpy as np
import scipy.signal as sg

SR = 22050
NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
COUNTS = ["1", "e", "&", "a", "2", "e", "&", "a", "3", "e", "&", "a", "4", "e", "&", "a"]


def band(y, lo, hi):
    return sg.sosfiltfilt(sg.butter(4, [lo, hi], btype="band", fs=SR, output="sos"), y)


def load(path):
    return librosa.load(path, sr=SR, mono=True)[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("stem_dir", type=Path)
    ap.add_argument("--part", default="bass", help="stem to transcribe (bass, other, …)")
    ap.add_argument("--fmax", type=float, default=300, help="highest pitch for pYIN, Hz")
    ap.add_argument("--offset", type=float, default=0, help="add to printed times (excerpt start)")
    args = ap.parse_args()

    d = args.stem_dir
    part = load(d / f"{args.part}.wav")
    drums = load(d / "drums.wav") if (d / "drums.wav").exists() else load(d / "no_bass.wav")

    _, beats = librosa.beat.beat_track(y=drums, sr=SR, units="time", start_bpm=117.5, tightness=600)
    while np.median(np.diff(beats)) > 0.75:  # locked to half tempo
        beats = np.sort(np.concatenate([beats, (beats[:-1] + beats[1:]) / 2]))
    sn = librosa.onset.onset_strength(
        y=band(drums, 150, 400) + band(drums, 1000, 4000), sr=SR, hop_length=128
    )
    ts = librosa.times_like(sn, sr=SR, hop_length=128)
    snare = np.array([sn[(ts > b - 0.03) & (ts < b + 0.05)].max(initial=0) for b in beats])
    parity = int(np.argmax([snare[p::2].mean() for p in (0, 1)]))

    grid = np.concatenate(
        [[a + (b - a) * k / 4 for k in range(4)] for a, b in zip(beats[:-1], beats[1:])]
    )
    six = np.median(np.diff(grid))
    env = librosa.onset.onset_strength(y=part, sr=SR, hop_length=64, n_mels=64, fmax=1000)
    onsets = librosa.onset.onset_detect(
        onset_envelope=env, sr=SR, hop_length=64, units="time", delta=0.07
    )
    rms = librosa.feature.rms(y=part, frame_length=512, hop_length=64)[0]
    tr = librosa.times_like(rms, sr=SR, hop_length=64)
    f0, voiced, _ = librosa.pyin(
        part, fmin=35, fmax=args.fmax, sr=SR, frame_length=2048, hop_length=256
    )
    tf = librosa.times_like(f0, sr=SR, hop_length=256)
    loud = np.percentile(rms, 95)

    cells = []  # (name, midi, onset)
    for g in grid:
        onset = bool(np.any(np.abs(onsets - g) < six * 0.45))
        m = (tf > g + 0.015) & (tf < g + six - 0.01) & voiced
        r = rms[(tr >= g) & (tr < g + six)]
        if (r.mean() if len(r) else 0) < loud * 0.12 or not m.any():
            cells.append((".", None, onset))
            continue
        midi = int(round(np.median(librosa.hz_to_midi(f0[m]))))
        cells.append((f"{NAMES[midi % 12]}{midi // 12 - 1}", midi, onset))

    # Bar 1 sits on a beat without snare; of the two candidates, take the one where pitch
    # changes land at the bar line or up to three 16ths before it (anticipations).
    candidates = [((1 - parity) % 2) * 4, ((1 - parity) % 2 + 2) * 4]

    def score(phase):
        hits = 0
        for i in range(1, len(cells)):
            a, b = cells[i - 1][1], cells[i][1]
            if a is not None and b is not None and a % 12 != b % 12:
                hits += (i - phase) % 16 in (0, 13, 14, 15)
        return hits

    phase = max(candidates, key=score)
    print(f"{d.name}/{args.part}: {len(beats)} beats, 16th = {six * 1000:.0f} ms")
    print("          " + "".join(f"{c:<5}" for c in COUNTS))
    for i in range(phase, len(cells) - 15, 16):
        row = []
        for name, _, onset in cells[i : i + 16]:
            row.append((name if onset and name != "." else ("-" if name != "." else ".")).ljust(5))
        print(f"{grid[i] + args.offset:7.2f}s " + "".join(row))


if __name__ == "__main__":
    main()
