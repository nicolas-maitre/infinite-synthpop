"""Compare the mix of renders against the reference recordings: loudness, peak, crest factor,
stereo width, and the share of energy per frequency band.

    .venv/bin/python -I scripts/compare_mix.py inspiration/*/*.mp3 renders/*.wav
"""

import sys
from pathlib import Path

import librosa
import numpy as np

SR = 44100
BANDS = [
    ("sub <60", 20, 60),
    ("bass 60-250", 60, 250),
    ("lowmid 250-1k", 250, 1000),
    ("mid 1-4k", 1000, 4000),
    ("presence 4-8k", 4000, 8000),
    ("air 8-16k", 8000, 16000),
]


def measure(path):
    y, _ = librosa.load(path, sr=SR, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    # Skip intros/fades: measure the loudest 60% of 2-second windows.
    mono = y.mean(axis=0)
    win = SR * 2
    n = len(mono) // win
    rms_w = np.array([np.sqrt(np.mean(mono[i * win : (i + 1) * win] ** 2)) for i in range(n)])
    keep = np.argsort(rms_w)[int(n * 0.4) :]
    body = np.concatenate([y[:, i * win : (i + 1) * win] for i in sorted(keep)], axis=1)
    m = body.mean(axis=0)
    s = (body[0] - body[1]) / 2
    rms = np.sqrt(np.mean(m**2))
    peak = np.max(np.abs(body))
    S = np.abs(librosa.stft(m, n_fft=4096, hop_length=2048)) ** 2
    freqs = librosa.fft_frequencies(sr=SR, n_fft=4096)
    total = S.sum()
    bands = {name: 10 * np.log10(S[(freqs >= lo) & (freqs < hi)].sum() / total + 1e-12) for name, lo, hi in BANDS}
    return {
        "rms_db": 20 * np.log10(rms + 1e-12),
        "peak_db": 20 * np.log10(peak + 1e-12),
        "crest_db": 20 * np.log10(peak / (rms + 1e-12)),
        "width": float(np.sqrt(np.mean(s**2)) / (np.sqrt(np.mean(m**2)) + 1e-12)),
        "bands": bands,
    }


def main():
    rows = [(Path(p).name[:34], measure(p)) for p in sys.argv[1:]]
    head = f"{'file':<35}{'RMS':>7}{'peak':>7}{'crest':>7}{'width':>7}" + "".join(f"{b[0]:>15}" for b in BANDS)
    print(head)
    for name, r in rows:
        print(
            f"{name:<35}{r['rms_db']:>7.1f}{r['peak_db']:>7.1f}{r['crest_db']:>7.1f}{r['width']:>7.2f}"
            + "".join(f"{r['bands'][b[0]]:>15.1f}" for b in BANDS)
        )


if __name__ == "__main__":
    main()
