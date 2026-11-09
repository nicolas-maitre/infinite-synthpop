"""Measure the reference recordings in inspiration/: tempo, key, bar-by-bar chords, form, and the
average 16-step drum and bass profiles. Prints a report and writes JSON next to it.

    .venv/bin/python -I scripts/analyze_reference.py inspiration/*.mp3 --out docs/reference-data.json
"""

import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np

SR = 22050
HOP = 512
NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
# Krumhansl–Kessler key profiles.
KK_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
MINOR_NUMERALS = {0: "i", 2: "ii", 3: "III", 5: "iv", 7: "v", 8: "VI", 10: "VII"}
MAJOR_NUMERALS = {0: "I", 2: "ii", 4: "iii", 5: "IV", 7: "V", 9: "vi", 11: "vii"}


def chord_templates():
    labels, temps = [], []
    for root in range(12):
        for quality, intervals in (("", (0, 4, 7)), ("m", (0, 3, 7))):
            t = np.zeros(12)
            t[root] = 1.0
            t[(root + intervals[1]) % 12] = 0.8
            t[(root + intervals[2]) % 12] = 0.8
            labels.append((root, quality))
            temps.append(t / np.linalg.norm(t))
    return labels, np.array(temps)


CHORD_LABELS, CHORD_TEMPLATES = chord_templates()


def estimate_key(chroma_mean):
    best = None
    for tonic in range(12):
        for mode, prof in (("major", KK_MAJOR), ("minor", KK_MINOR)):
            r = np.corrcoef(np.roll(prof, tonic), chroma_mean)[0, 1]
            if best is None or r > best[0]:
                best = (r, tonic, mode)
    return {"tonic": int(best[1]), "mode": best[2], "name": f"{NAMES[best[1]]} {best[2]}", "r": float(best[0])}


def numeral(key, root, quality):
    rel = (root - key["tonic"]) % 12
    table = MINOR_NUMERALS if key["mode"] == "minor" else MAJOR_NUMERALS
    base = table.get(rel)
    if base is None:
        return f"?{rel}"
    # Case shows the quality actually measured (e.g. a major V in minor).
    return base.upper() if quality == "" else base.lower()


def band_onsets(S, freqs, lo, hi):
    band = S[(freqs >= lo) & (freqs < hi)]
    env = np.maximum(0, np.diff(librosa.amplitude_to_db(band + 1e-9), axis=1)).mean(axis=0)
    return np.concatenate([[0], env])


def analyse(path):
    y, _ = librosa.load(path, sr=SR, mono=True)
    duration = len(y) / SR
    y_harm, _ = librosa.effects.hpss(y)

    tempo, beats = librosa.beat.beat_track(y=y, sr=SR, hop_length=HOP, start_bpm=118, tightness=400)
    beat_times = librosa.frames_to_time(beats, sr=SR, hop_length=HOP)
    # Each beat is snapped to a 23 ms frame, so the median beat gap can only take a few values
    # (112.3, 117.45, 123.0 BPM near this range). A line fitted through all the beat times
    # averages the snapping out; the first and last tenth (count-ins, fades) are left out.
    trim = len(beat_times) // 10
    core = beat_times[trim : len(beat_times) - trim]
    slope, intercept = np.polyfit(np.arange(len(core)), core, 1)
    bpm = float(60 / slope)
    # Scatter of the beats around that line; about 7 ms is the frame snapping alone.
    jitter = np.std(core - (slope * np.arange(len(core)) + intercept))

    chroma = librosa.feature.chroma_cqt(y=y_harm, sr=SR, hop_length=HOP)
    key = estimate_key(chroma.mean(axis=1))
    beat_chroma = librosa.util.sync(chroma, beats, aggregate=np.median)

    # Downbeat phase: chords change on bar lines, so pick the phase with the most chroma change.
    unit = beat_chroma / (np.linalg.norm(beat_chroma, axis=0, keepdims=True) + 1e-9)
    novelty = np.concatenate([[0], 1 - np.sum(unit[:, 1:] * unit[:, :-1], axis=0)])
    phase = int(np.argmax([novelty[p::4].mean() for p in range(4)]))

    bar_starts = list(range(phase, beat_chroma.shape[1] - 3, 4))
    bars = []
    for b in bar_starts:
        halves = []
        for h in (0, 2):
            c = beat_chroma[:, b + h : b + h + 2].mean(axis=1)
            c = c / (np.linalg.norm(c) + 1e-9)
            scores = CHORD_TEMPLATES @ c
            i = int(np.argmax(scores))
            root, quality = CHORD_LABELS[i]
            halves.append({"name": NAMES[root] + quality, "numeral": numeral(key, root, quality), "score": float(scores[i])})
        t = float(beat_times[b]) if b < len(beat_times) else duration
        bars.append({"time": round(t, 2), "chords": halves})

    # Bar-level features for segmentation and energy.
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    mfcc = librosa.feature.mfcc(y=y, sr=SR, hop_length=HOP, n_mfcc=13)
    bar_frames = [beats[b] for b in bar_starts if b < len(beats)]
    bar_chroma = librosa.util.sync(chroma, bar_frames, aggregate=np.mean)[:, 1 : len(bar_frames)]
    bar_mfcc = librosa.util.sync(mfcc, bar_frames, aggregate=np.mean)[:, 1 : len(bar_frames)]
    bar_rms = librosa.util.sync(rms[None, :], bar_frames, aggregate=np.mean)[0, 1 : len(bar_frames)]
    for i, bar in enumerate(bars):
        bar["rms_db"] = round(float(librosa.amplitude_to_db(bar_rms[min(i, len(bar_rms) - 1)] + 1e-9)), 1)

    feats = np.vstack([
        librosa.util.normalize(bar_chroma, axis=0),
        (bar_mfcc - bar_mfcc.mean(axis=1, keepdims=True)) / (bar_mfcc.std(axis=1, keepdims=True) + 1e-9),
    ])
    k = max(4, round(len(bars) / 8))
    bounds = librosa.segment.agglomerative(feats, k)
    bounds = sorted(set([0, *[int(x) for x in bounds], len(bars)]))
    segments = []
    for s, e in zip(bounds[:-1], bounds[1:]):
        if e <= s:
            continue
        seq = [" / ".join(c["name"] for c in bars[i]["chords"]) if bars[i]["chords"][0]["name"] != bars[i]["chords"][1]["name"] else bars[i]["chords"][0]["name"] for i in range(s, e)]
        segments.append({
            "start_bar": s,
            "bars": e - s,
            "time": bars[s]["time"],
            "rms_db": round(float(np.mean([bars[i]["rms_db"] for i in range(s, e)])), 1),
            "chords": seq,
        })

    # Average 16-step onset profiles by band, phase-locked to the estimated downbeats.
    S = np.abs(librosa.stft(y, hop_length=HOP, n_fft=2048))
    freqs = librosa.fft_frequencies(sr=SR, n_fft=2048)
    bands = {"kick (40–120 Hz)": (40, 120), "snare (150–400 Hz + 1–4 kHz)": (1000, 4000), "hats (7–11 kHz)": (7000, 11000)}
    frame_times = librosa.frames_to_time(np.arange(S.shape[1]), sr=SR, hop_length=HOP)
    profiles = {}
    for label, (lo, hi) in bands.items():
        env = band_onsets(S, freqs, lo, hi)
        grid = np.zeros(16)
        n = 0
        for b in bar_starts:
            if b + 4 >= len(beat_times):
                break
            t0, t1 = beat_times[b], beat_times[b + 4]
            steps = t0 + (t1 - t0) * np.arange(16) / 16
            idx = np.searchsorted(frame_times, steps)
            idx = np.clip(idx, 0, len(env) - 1)
            # Max over a ±1-frame window absorbs small timing error.
            grid += np.array([env[max(0, i - 1) : i + 2].max() for i in idx])
            n += 1
        grid /= max(1, n)
        profiles[label] = [round(float(v), 2) for v in grid / (grid.max() + 1e-9)]

    # Bass: dominant CQT pitch in E1–E3 on each 16th, relative to the bar's lowest common note.
    C = np.abs(librosa.cqt(y_harm, sr=SR, hop_length=HOP, fmin=librosa.note_to_hz("E1"), n_bins=24))
    cqt_times = librosa.frames_to_time(np.arange(C.shape[1]), sr=SR, hop_length=HOP)
    octave_up = np.zeros(16)
    nb = 0
    for b in bar_starts:
        if b + 4 >= len(beat_times):
            break
        t0, t1 = beat_times[b], beat_times[b + 4]
        idx = np.clip(np.searchsorted(cqt_times, t0 + (t1 - t0) * (np.arange(16) + 0.3) / 16), 0, C.shape[1] - 1)
        pitches = np.array([int(np.argmax(C[:, i])) for i in idx])
        if C[:, idx].max() < np.percentile(C, 60):
            continue
        base = np.percentile(pitches, 20)
        octave_up += (pitches - base >= 10).astype(float)
        nb += 1
    bass_profile = [round(float(v), 2) for v in octave_up / max(1, nb)]

    return {
        "file": Path(path).name,
        "duration_s": round(duration, 1),
        "bpm": round(bpm, 2),
        "bpm_librosa": round(float(np.atleast_1d(tempo)[0]), 2),
        "tempo_stability_ms": round(float(jitter * 1000), 1),
        "key": key,
        "downbeat_phase": phase,
        "n_bars": len(bars),
        "segments": segments,
        "drum_profiles": profiles,
        "bass_octave_up_profile": bass_profile,
        "bars": bars,
    }


def report(r):
    print(f"\n=== {r['file']} ===")
    print(f"duration {r['duration_s']}s · {r['bpm']} BPM (librosa {r['bpm_librosa']}, beat jitter {r['tempo_stability_ms']} ms)")
    print(f"key {r['key']['name']} (r={r['key']['r']:.2f}) · {r['n_bars']} bars")
    print("\nForm (auto-segmented):")
    for s in r["segments"]:
        m, sec = divmod(s["time"], 60)
        print(f"  {int(m)}:{sec:05.2f}  bar {s['start_bar']:>3} ×{s['bars']:>2}  {s['rms_db']:>6} dB  {' | '.join(s['chords'])}")
    print("\nDrum onset profiles (16 steps, 1.0 = strongest):")
    for label, p in r["drum_profiles"].items():
        print(f"  {label:<30} " + " ".join(f"{v:.1f}" for v in p))
    print("\nBass: share of bars with an octave-up note on each 16th:")
    print("  " + " ".join(f"{v:.1f}" for v in r["bass_octave_up_profile"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--out")
    args = ap.parse_args()
    results = []
    for f in args.files:
        print(f"analysing {f} …", file=sys.stderr)
        r = analyse(f)
        report(r)
        results.append(r)
    if args.out:
        Path(args.out).write_text(json.dumps(results, indent=1))
        print(f"\nwrote {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
