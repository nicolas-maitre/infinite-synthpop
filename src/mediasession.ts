/**
 * System media controls: the macOS Now Playing widget and media keys, the Android media
 * notification, the iOS lock screen and Control Center, headphone buttons. They show the playing
 * song and drive play/pause, next/previous and seeking through the Media Session API.
 *
 * Browsers only hand those controls to a page that plays a media element, and the music here is
 * Web Audio. So while the music plays, a looping silent <audio> element plays too: the page then
 * counts as a media player, while the sound itself still goes straight from Web Audio to the
 * output (routing it through the element would make it lag behind the playhead on screen). On iOS
 * the playing element also makes the page's audio count as playback, not as an effect that the
 * silent switch mutes.
 */
import type { Song } from "./composer";

export interface MediaActions {
  play(): void;
  pause(): void;
  /** Another song. */
  next(): void;
  /** Back to the start of the song. */
  previous(): void;
  /** To this point of the song, in seconds. */
  seekTo(seconds: number): void;
  /** To the next section. */
  seekForward(): void;
  /** To the previous section. */
  seekBackward(): void;
}

export interface MediaControls {
  /** Starts the silent element. Call from the click (or key) that starts playback: browsers only
   * let media start in a user gesture. */
  activate(): void;
  setPlaying(playing: boolean): void;
  /** Title, artist and artwork for the song now playing. */
  setSong(song: Song, album: string): void;
  /** Where the song is, for the system's scrubber. */
  setPosition(song: Song, bar: number): void;
}

/** Seconds per bar (4/4). */
export function barSeconds(song: Pick<Song, "bpm">): number {
  return (4 * 60) / song.bpm;
}

/** The song's length in seconds, as the system scrubber shows it. */
export function songSeconds(song: Pick<Song, "bpm" | "totalBars">): number {
  return song.totalBars * barSeconds(song);
}

/** The bar a scrubber position lands in. */
export function barAtSeconds(song: Pick<Song, "bpm" | "totalBars">, seconds: number): number {
  const bar = Math.floor(seconds / barSeconds(song) + 1e-9);
  return Math.max(0, Math.min(song.totalBars - 1, bar));
}

/** Ten seconds of silence as an 8 kHz, 8-bit mono WAV: long enough that browsers treat it as
 * media rather than a notification sound. */
export function silentWav(seconds = 10, rate = 8000): Blob {
  const samples = seconds * rate;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate, true); // bytes per second
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit PCM is unsigned: 128 is silence
  return new Blob([bytes], { type: "audio/wav" });
}

const NONE: MediaControls = {
  activate() {},
  setPlaying() {},
  setSong() {},
  setPosition() {},
};

export function mountMediaControls(actions: MediaActions): MediaControls {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return NONE;
  const session = navigator.mediaSession;
  let element: HTMLAudioElement | null = null;

  const handle = (action: MediaSessionAction, run: (d: MediaSessionActionDetails) => void) => {
    try {
      session.setActionHandler(action, run);
    } catch {
      // This browser doesn't offer that action.
    }
  };
  handle("play", () => actions.play());
  handle("pause", () => actions.pause());
  handle("stop", () => actions.pause());
  handle("nexttrack", () => actions.next());
  handle("previoustrack", () => actions.previous());
  handle("seekto", (d) => {
    if (typeof d.seekTime === "number") actions.seekTo(d.seekTime);
  });
  handle("seekforward", () => actions.seekForward());
  handle("seekbackward", () => actions.seekBackward());

  const artwork = [192, 512].map((size) => ({
    src: new URL(`icons/icon-${size}.png`, document.baseURI).href,
    sizes: `${size}x${size}`,
    type: "image/png",
  }));

  return {
    activate() {
      // Safari: count as music playback, which the silent switch doesn't mute.
      const audioSession = (navigator as Navigator & { audioSession?: { type: string } })
        .audioSession;
      if (audioSession) audioSession.type = "playback";
      if (!element) {
        element = new Audio(URL.createObjectURL(silentWav()));
        element.loop = true;
        element.setAttribute("aria-hidden", "true");
      }
      element.play().catch(() => {
        // Refused (no gesture): the music still plays, just without system controls.
      });
    },
    setPlaying(playing) {
      session.playbackState = playing ? "playing" : "paused";
      if (!playing) element?.pause();
    },
    setSong(song, album) {
      session.metadata = new MediaMetadata({
        title: song.title,
        artist: "Infinite Synthpop",
        album,
        artwork,
      });
    },
    setPosition(song, bar) {
      try {
        session.setPositionState({
          duration: songSeconds(song),
          playbackRate: 1,
          position: Math.min(songSeconds(song), bar * barSeconds(song)),
        });
      } catch {
        // An older browser without position state: the controls still work, without a scrubber.
      }
    },
  };
}
