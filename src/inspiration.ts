/**
 * The player's "Inspired by" panel: the records the playing song took from, with their sleeves,
 * the main one big and the others scaled by their share, and per-part credits. The page takes
 * its tint from the main sleeve's colour, as music players do. A click plays that original.
 * Sleeves load from the Cover Art Archive (influence.ts); one that doesn't load leaves a tile.
 */
import type { Song } from "./composer";
import { coverUrl, influences, PART_CREDITS, partCredits, RECORDS } from "./influence";
import { REFERENCES, type ReferenceId } from "./references";

export interface InspirationPanel {
  render(song: Song): void;
}

/** Each sleeve's colour, once sampled. */
const tints = new Map<ReferenceId, string>();

/** A sleeve's average colour, lifted toward the page's: what the panels are tinted with. */
function sampleTint(img: HTMLImageElement): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;
    let [r, g, b, n] = [0, 0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      // Saturated pixels count more: a sleeve's colour, not its grey.
      const max = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
      const min = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
      const w = 0.2 + (max - min) / 255;
      r += data[i]! * w;
      g += data[i + 1]! * w;
      b += data[i + 2]! * w;
      n += w;
    }
    // A pale sleeve would wash the text out: no lighter than the middle.
    const light = Math.max(r, g, b) / n / 255;
    const k = light > 0.55 ? 0.55 / light : 1;
    return `rgb(${Math.round((r / n) * k)} ${Math.round((g / n) * k)} ${Math.round((b / n) * k)})`;
  } catch {
    return null; // A sleeve served without CORS: no tint.
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A record's initials, for the tile under its sleeve (and in its place when it doesn't load). */
function initials(title: string): string {
  return title
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** A record's sleeve over its tile; `onTint` hears its colour once loaded. */
export function sleeve(
  id: ReferenceId,
  big: boolean,
  onTint?: (tint: string) => void,
): HTMLElement {
  const title = REFERENCES[id].title;
  const box = el("span", `insp-cover${big ? " big" : ""}`);
  box.dataset.ref = id;
  box.append(el("span", "insp-cover-tile", initials(title)));
  const img = document.createElement("img");
  img.alt = `${title} sleeve`;
  img.loading = "lazy";
  img.decoding = "async";
  img.crossOrigin = "anonymous";
  img.referrerPolicy = "no-referrer";
  img.src = coverUrl(id, big ? 500 : 250);
  img.addEventListener("load", () => {
    img.classList.add("loaded");
    if (!onTint) return;
    const tint = tints.get(id) ?? sampleTint(img);
    if (!tint) return;
    tints.set(id, tint);
    onTint(tint);
  });
  img.addEventListener("error", () => img.remove());
  box.append(img);
  return box;
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** A YouTube search for the record, in a new tab: the record itself, wherever it is up. */
export function youtubeUrl(id: ReferenceId): string {
  const query = `${RECORDS[id].artist} ${REFERENCES[id].title}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function youtubeLink(id: ReferenceId, className: string): HTMLAnchorElement {
  const a = el("a", className);
  a.href = youtubeUrl(id);
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = `Listen to ${REFERENCES[id].title} by ${RECORDS[id].artist} on YouTube`;
  const logo = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  logo.setAttribute("viewBox", "0 0 24 24");
  logo.setAttribute("aria-hidden", "true");
  logo.classList.add("icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8c1.6.4 7.8.4 7.8.4s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z",
  );
  logo.append(path);
  a.append(logo, "YouTube");
  return a;
}

export function mountInspiration(
  root: HTMLElement,
  play: (id: ReferenceId) => void,
): InspirationPanel {
  const body = root.querySelector<HTMLElement>(".insp-body") ?? root;
  let shown = "";

  const setTint = (tint: string | null) => {
    const style = document.documentElement.style;
    if (tint) style.setProperty("--tint", tint);
    else style.removeProperty("--tint");
  };

  return {
    render(song) {
      const list = influences(song);
      const credits = partCredits(song);
      // Recomposed in place with the same influences: nothing to redraw.
      const key = JSON.stringify([list, credits, song.reference]);
      if (key === shown) return;
      shown = key;
      const [main, ...rest] = list;
      if (!main) {
        body.replaceChildren();
        setTint(null);
        return;
      }
      setTint(tints.get(main.id) ?? null);

      const info = (id: ReferenceId) => `${RECORDS[id].artist} · ${RECORDS[id].year}`;

      // The main record: its sleeve plays it; its title, credits, share and links beside it.
      const hero = el("div", "insp-hero");
      const cover = el("button", "insp-hero-cover");
      cover.type = "button";
      cover.title = `Play the original: ${REFERENCES[main.id].title}`;
      cover.setAttribute("aria-label", cover.title);
      cover.append(sleeve(main.id, true, (tint) => main.id === list[0]?.id && setTint(tint)));
      cover.addEventListener("click", () => play(main.id));
      const text = el("div", "insp-hero-text");
      const bar = el("span", "insp-bar");
      bar.append(el("span", "insp-bar-fill"));
      (bar.firstElementChild as HTMLElement).style.width = percent(main.share);
      const share = el("span", "insp-share");
      share.append(bar, song.reference ? "All of it" : `${percent(main.share)} of this song`);
      const actions = el("div", "insp-actions");
      if (!song.reference) {
        const original = el("button", "btn small", "▶ Play the original");
        original.type = "button";
        original.addEventListener("click", () => play(main.id));
        actions.append(original);
      }
      actions.append(youtubeLink(main.id, "btn small insp-yt"));
      text.append(
        el("span", "insp-kicker", song.reference ? "The original" : "Main influence"),
        el("span", "insp-title", REFERENCES[main.id].title),
        el("span", "insp-artist", info(main.id)),
        share,
        actions,
      );
      hero.append(cover, text);

      const parts: HTMLElement[] = [hero];
      if (rest.length) {
        const others = el("ul", "insp-others");
        for (const x of rest) {
          const li = document.createElement("li");
          const tile = el("button", "insp-tile");
          tile.type = "button";
          tile.title = `Play the original: ${REFERENCES[x.id].title}`;
          // Scaled by influence: the main record's share is the full size.
          tile.style.setProperty(
            "--size",
            `${Math.round(56 + 64 * Math.sqrt(x.share / main.share))}px`,
          );
          tile.append(
            sleeve(x.id, false),
            el("span", "insp-tile-title", REFERENCES[x.id].title),
            el("span", "insp-tile-meta", `${RECORDS[x.id].artist} · ${percent(x.share)}`),
          );
          tile.addEventListener("click", () => play(x.id));
          li.append(tile, youtubeLink(x.id, "insp-yt-mini"));
          others.append(li);
        }
        parts.push(others);
      }

      if (credits.length) {
        const box = el("div", "insp-credits");
        box.append(el("h4", "insp-credits-title", "Credits"));
        const dl = document.createElement("dl");
        for (const c of credits) {
          const row = el("div", "insp-credit");
          const who = document.createElement("dd");
          c.records.forEach((r, i) => {
            if (i) who.append(el("span", "insp-credit-sep", " · "));
            who.append(
              el("span", "insp-credit-song", REFERENCES[r.id].title),
              el("span", "insp-credit-share", ` ${percent(r.share)}`),
            );
          });
          row.append(el("dt", "", PART_CREDITS[c.part]), who);
          dl.append(row);
        }
        box.append(dl);
        parts.push(box);
      }
      body.replaceChildren(...parts);
    },
  };
}
