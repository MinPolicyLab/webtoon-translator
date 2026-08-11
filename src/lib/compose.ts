import type { OcrLine } from "./ocr";

interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Speech-bubble backgrounds are usually one dominant flat color with the
 * text strokes as a minority of pixels, so a coarse histogram mode is a
 * much better estimate than an average (which gets dragged toward grey by
 * the dark text pixels).
 */
function sampleDominantColor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): RGB {
  const ix = Math.max(0, Math.floor(x));
  const iy = Math.max(0, Math.floor(y));
  const iw = Math.max(1, Math.min(Math.floor(w), ctx.canvas.width - ix));
  const ih = Math.max(1, Math.min(Math.floor(h), ctx.canvas.height - iy));

  const { data } = ctx.getImageData(ix, iy, iw, ih);
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  const BIN = 24;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = `${Math.round(r / BIN)}_${Math.round(g / BIN)}_${Math.round(b / BIN)}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.count++;
      existing.r += r;
      existing.g += g;
      existing.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }

  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  if (!best) return { r: 255, g: 255, b: 255 };
  return { r: best.r / best.count, g: best.g / best.count, b: best.b / best.count };
}

function relativeLuminance({ r, g, b }: RGB): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

/** Finds the largest font size (within bounds) whose wrapped text fits the box. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  boxWidth: number,
  boxHeight: number,
  maxSize: number
): { size: number; lines: string[]; lineHeight: number } {
  const minSize = 8;
  for (let size = maxSize; size >= minSize; size -= 1) {
    ctx.font = `700 ${size}px "Noto Sans KR", "Malgun Gothic", -apple-system, sans-serif`;
    const lineHeight = size * 1.2;
    const lines = wrapText(ctx, text, boxWidth);
    if (lines.length * lineHeight <= boxHeight && lines.every((l) => ctx.measureText(l).width <= boxWidth)) {
      return { size, lines, lineHeight };
    }
  }
  ctx.font = `700 ${minSize}px "Noto Sans KR", "Malgun Gothic", -apple-system, sans-serif`;
  return { size: minSize, lines: wrapText(ctx, text, boxWidth), lineHeight: minSize * 1.2 };
}

export interface ComposableLine extends OcrLine {
  translated: string | null;
}

/**
 * Paints over each detected line with its own local background color —
 * removing the original text — then draws the translated text in its
 * place. An outline-only overlay (translated text drawn straight on top of
 * the untouched original) was tried first, but left the original text
 * showing through underneath the translation, which was reported as
 * actually harder to read than the two overlapping. The erase box is kept
 * as tight as the text needs (small, absolute-pixel-capped padding, and
 * only grows for wrapped lines when the translation doesn't fit) so it
 * covers the original glyphs without spreading into surrounding artwork.
 */
export function composeTranslatedImage(
  sourceCanvas: HTMLCanvasElement,
  lines: ComposableLine[]
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = sourceCanvas.width;
  out.height = sourceCanvas.height;
  const outCtx = out.getContext("2d");
  const srcCtx = sourceCanvas.getContext("2d");
  if (!outCtx || !srcCtx) throw new Error("캔버스 컨텍스트를 생성할 수 없습니다.");

  outCtx.drawImage(sourceCanvas, 0, 0);

  for (const line of lines) {
    if (!line.translated) continue;
    const { x0, y0, x1, y1 } = line.bbox;
    const boxW = x1 - x0;
    const boxH = y1 - y0;
    if (boxW <= 0 || boxH <= 0) continue;

    const bg = sampleDominantColor(srcCtx, x0, y0, boxW, boxH);
    const bgIsLight = relativeLuminance(bg) > 0.55;
    const fillColor = bgIsLight ? "#161616" : "#f7f5f0";

    // Figure out how big the erased box needs to be to fit the translation
    // *before* painting it, so a short translation gets a box barely
    // bigger than the original text, while a longer one only grows as
    // much as it has to (capped, so it can't balloon into the art).
    const maxW = Math.min(out.width * 0.92, boxW * 1.6);
    const maxH = Math.min(out.height * 0.35, boxH * 2.4);
    const { lines: wrapped, lineHeight } = fitText(outCtx, line.translated, maxW, maxH, Math.max(11, boxH * 0.9));

    const textW = Math.max(...wrapped.map((l) => outCtx.measureText(l).width), 0);
    const textH = wrapped.length * lineHeight;

    const padX = Math.min(10, Math.max(3, boxW * 0.06));
    const padY = Math.min(8, Math.max(3, boxH * 0.14));
    const rw = Math.max(boxW, textW) + padX * 2;
    const rh = Math.max(boxH, textH) + padY * 2;
    const rx = x0 + boxW / 2 - rw / 2;
    const ry = y0 + boxH / 2 - rh / 2;

    outCtx.fillStyle = `rgb(${bg.r}, ${bg.g}, ${bg.b})`;
    roundRectPath(outCtx, rx, ry, rw, rh, Math.min(6, rh / 4));
    outCtx.fill();

    outCtx.fillStyle = fillColor;
    outCtx.textAlign = "center";
    outCtx.textBaseline = "middle";

    const centerX = rx + rw / 2;
    const startY = ry + rh / 2 - textH / 2 + lineHeight / 2;

    wrapped.forEach((wrappedLine, i) => {
      outCtx.fillText(wrappedLine, centerX, startY + i * lineHeight);
    });
  }

  return out;
}
