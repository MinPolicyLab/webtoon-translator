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
 * the dark text pixels). Used only to pick a readable text/outline color —
 * nothing gets painted over with it.
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
  const minSize = 9;
  for (let size = maxSize; size >= minSize; size -= 1) {
    ctx.font = `700 ${size}px "Noto Sans KR", "Malgun Gothic", -apple-system, sans-serif`;
    const lineHeight = size * 1.22;
    const lines = wrapText(ctx, text, boxWidth);
    if (lines.length * lineHeight <= boxHeight && lines.every((l) => ctx.measureText(l).width <= boxWidth)) {
      return { size, lines, lineHeight };
    }
  }
  ctx.font = `700 ${minSize}px "Noto Sans KR", "Malgun Gothic", -apple-system, sans-serif`;
  return { size: minSize, lines: wrapText(ctx, text, boxWidth), lineHeight: minSize * 1.22 };
}

export interface ComposableLine extends OcrLine {
  translated: string | null;
}

/**
 * Draws the translated text directly over each detected line with an
 * outline for legibility — the original artwork is left fully visible
 * (no background is painted over), rather than blocking it out with a
 * solid box behind the text.
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

    // No box is painted, so the text is free to use more room than the
    // original glyphs occupied — useful since a translation is often
    // longer than the source line — capped so it can't balloon past a
    // sensible size relative to the page.
    const innerW = Math.min(out.width * 0.9, boxW * 1.5);
    const innerH = Math.min(out.height * 0.4, boxH * 1.8);

    const bg = sampleDominantColor(srcCtx, x0, y0, boxW, boxH);
    const bgIsLight = relativeLuminance(bg) > 0.55;
    const fillColor = bgIsLight ? "#161616" : "#f7f5f0";
    const outlineColor = bgIsLight ? "#f7f5f0" : "#161616";

    const { lines: wrapped, lineHeight, size } = fitText(
      outCtx,
      line.translated,
      innerW,
      innerH,
      Math.max(10, boxH * 0.85)
    );

    outCtx.textAlign = "center";
    outCtx.textBaseline = "middle";
    outCtx.lineJoin = "round";
    outCtx.miterLimit = 2;
    outCtx.lineWidth = Math.max(2, size * 0.16);
    outCtx.strokeStyle = outlineColor;
    outCtx.fillStyle = fillColor;

    const totalH = wrapped.length * lineHeight;
    const centerX = x0 + boxW / 2;
    const centerY = y0 + boxH / 2;
    const startY = centerY - totalH / 2 + lineHeight / 2;

    wrapped.forEach((wrappedLine, i) => {
      const ty = startY + i * lineHeight;
      outCtx.strokeText(wrappedLine, centerX, ty);
      outCtx.fillText(wrappedLine, centerX, ty);
    });
  }

  return out;
}
