/**
 * The cover viewer: a sleeve almost full screen over the page dimmed, opened by a click on the
 * player's or Up next's sleeve. A generated sleeve is drawn afresh at the size it shows (sharp
 * on any screen, and not kept: the thumbnails' cache stays small); an original's largest scan
 * replaces the one already loaded as soon as it arrives.
 */
import { RECORD_COLOURS } from "./cover";
import { drawSleeve, sleeveOf, type CoverSource } from "./coverart";
import { coverUrl } from "./influence";

let dialog: HTMLDialogElement | null = null;

function mount(): HTMLDialogElement {
  const d = document.createElement("dialog");
  d.className = "cover-dialog";
  d.innerHTML = `
    <figure class="cover-view">
      <span class="cover cover-view-art"></span>
      <figcaption>
        <span class="cover-view-title"></span>
        <span class="cover-view-meta"></span>
      </figcaption>
    </figure>
    <button class="btn round small cover-view-close" type="button" aria-label="Close">✕</button>`;
  // A click anywhere closes it, as a photo viewer does (Esc too, the dialog's own).
  d.addEventListener("click", () => d.close());
  // The page's shortcuts (Space, arrows, Esc leaving full screen) stay out of it.
  d.addEventListener("keydown", (e) => e.stopPropagation());
  d.addEventListener("close", () => d.querySelector(".cover-view-art")!.replaceChildren());
  document.body.append(d);
  return d;
}

/** Device pixels for a sleeve `css` pixels wide: a few sizes, at most 2048. */
function pixels(css: number): number {
  const px = Math.ceil((css * (window.devicePixelRatio || 1)) / 256) * 256;
  return Math.min(2048, Math.max(512, px));
}

export function openCover(source: CoverSource, caption: { title: string; meta: string }): void {
  dialog ??= mount();
  const d = dialog;
  d.querySelector(".cover-view-title")!.textContent = caption.title;
  d.querySelector(".cover-view-meta")!.textContent = caption.meta;
  d.setAttribute("aria-label", `Cover of “${caption.title}”`);
  if (!d.open) d.showModal();
  const box = d.querySelector<HTMLElement>(".cover-view-art")!;
  const px = pixels(box.getBoundingClientRect().width);

  if ("reference" in source) {
    const ref = source.reference;
    box.style.setProperty("--cover-tile", RECORD_COLOURS[ref].field);
    const img = document.createElement("img");
    img.alt = "";
    // As everywhere else, so the scan the page already has shows at once.
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.src = coverUrl(ref, 500);
    img.addEventListener("error", () => img.remove());
    box.replaceChildren(img);
    if (px > 500) {
      const big = new Image();
      big.crossOrigin = "anonymous";
      big.referrerPolicy = "no-referrer";
      big.addEventListener("load", () => {
        if (img.isConnected) img.src = big.src;
      });
      big.src = coverUrl(ref, 1200);
    }
    return;
  }
  const s = sleeveOf(source.song);
  box.style.setProperty("--cover-tile", s.palette.ground);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  box.replaceChildren(canvas);
  drawSleeve(canvas.getContext("2d")!, s, px);
}
