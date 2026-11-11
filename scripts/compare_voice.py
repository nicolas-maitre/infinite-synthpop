"""Compare the lead voice's mix against the reference recordings: how loud it sits against the
whole mix, its tone (band levels against its 250 Hz-1 kHz band), its stereo width, and how much
reverb fills the dips between its notes. Only the frames where the voice sounds are measured.

Each argument is a pair, voice stem and full mix, separated by a comma: a record's Demucs
`vocals.wav` with the record itself, or a render's solo lead (renderToDisk with solo ["lead"])
with the full render of the same bars.

    .venv/bin/python -I scripts/compare_voice.py \\
        "inspiration/stems/faces/htdemucs/faces/vocals.wav,inspiration/stems/faces/faces.mp3" \\
        "renders/seed-7-…-solo-lead-x.wav,renders/seed-7-…-x.wav"
"""

import sys
from pathlib import Path

import librosa
import numpy as np

SR = 44100
HOP = 441  # 10 ms
BANDS = [
    ("low 100-250", 100, 250),
    ("mid 1-2.5k", 1000, 2500),
    ("pres 2.5-5k", 2500, 5000),
    ("air 5-10k", 5000, 10000),
]
REF_BAND = (250, 1000)


def load(path):
    y, _ = librosa.load(path, sr=SR, mono=False)
    return np.stack([y, y]) if y.ndim == 1 else y


def frame_rms(x):
    return librosa.feature.rms(y=x, frame_length=HOP * 4, hop_length=HOP, center=True)[0]


def measure(voice_path, mix_path):
    voice = load(voice_path)
    mix = load(mix_path)
    n = min(voice.shape[1], mix.shape[1])
    voice, mix = voice[:, :n], mix[:, :n]
    vm = voice.mean(axis=0)
    env = 20 * np.log10(frame_rms(vm) + 1e-9)
    # Sung frames: within 20 dB of the voice's loud level (its 95th percentile).
    loud = np.percentile(env, 95)
    sung = env > loud - 20
    idx = np.repeat(sung, HOP)[:n]
    v = voice[:, idx]
    m = mix[:, idx]
    vmono = v.mean(axis=0)
    rms = lambda x: np.sqrt(np.mean(x**2)) + 1e-12  # noqa: E731
    level = 20 * np.log10(rms(vmono) / rms(m.mean(axis=0)))
    side = (v[0] - v[1]) / 2
    width = 20 * np.log10(rms(side) / rms(vmono))
    S = np.abs(librosa.stft(vmono, n_fft=4096, hop_length=2048)) ** 2
    freqs = librosa.fft_frequencies(sr=SR, n_fft=4096)
    band = lambda lo, hi: S[(freqs >= lo) & (freqs < hi)].sum() + 1e-12  # noqa: E731
    ref = band(*REF_BAND)
    tone = {name: 10 * np.log10(band(lo, hi) / ref) for name, lo, hi in BANDS}
    # Reverb fill: inside phrases (sung frames and the half second after), how far the quiet
    # moments sit under the loud ones (20th against 90th percentile of the level). A dry voice dips
    # deep between notes and words; reverb fills the dips, so a wetter voice reads closer to 0.
    near = np.convolve(sung.astype(float), np.ones(50), mode="full")[: len(sung)] > 0
    phrase = env[near]
    fill = float(np.percentile(phrase, 20) - np.percentile(phrase, 90))
    return {
        "level": level,
        "width": width,
        "tone": tone,
        "fill": fill,
        "sung": float(sung.mean()),
    }


def main():
    head = f"{'voice stem':<34}{'vs mix':>8}{'width':>8}" + "".join(f"{b[0]:>13}" for b in BANDS)
    print(head + f"{'fill':>8}{'sung':>6}")
    for arg in sys.argv[1:]:
        voice, mix = arg.split(",")
        r = measure(voice, mix)
        name = Path(voice).parent.name if Path(voice).name == "vocals.wav" else Path(voice).name
        print(
            f"{name[:33]:<34}{r['level']:>8.1f}{r['width']:>8.1f}"
            + "".join(f"{r['tone'][b[0]]:>13.1f}" for b in BANDS)
            + f"{r['fill']:>8.1f}{r['sung']:>6.2f}"
        )


if __name__ == "__main__":
    main()
