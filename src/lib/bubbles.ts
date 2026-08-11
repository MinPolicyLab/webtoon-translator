export interface BubbleRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// Bubbles are analyzed on a small downscaled copy — shape detection doesn't
// need full resolution, and this keeps flood-fill fast regardless of how
// large the source page is.
const ANALYSIS_LONG_SIDE = 700;
const LIGHT_LUMINANCE = 205;
const BORDER_DARK_LUMINANCE = 140;
const BORDER_RING_OFFSET = 2;
const MIN_BORDER_DARK_FRACTION = 0.12;

function luminanceAt(data: Uint8ClampedArray, w: number, x: number, y: number): number {
  const p = (y * w + x) * 4;
  return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
}

/**
 * A speech bubble's outline stroke sits just outside its filled interior.
 * An oval only touches its own bounding box at four points, so most of a
 * sampled ring around the box lands on whatever art or background
 * surrounds the bubble rather than the stroke itself — this only checks
 * that *some* meaningful portion of the ring is notably darker than the
 * bubble's light interior, which is enough to tell "there's a border here
 * somewhere" apart from "this blob fades straight into an equally light
 * background" (the exact case that produces a false-positive merge with
 * the page background).
 */
function borderDarkFraction(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): number {
  const rx0 = Math.max(0, minX - BORDER_RING_OFFSET);
  const ry0 = Math.max(0, minY - BORDER_RING_OFFSET);
  const rx1 = Math.min(w - 1, maxX + BORDER_RING_OFFSET);
  const ry1 = Math.min(h - 1, maxY + BORDER_RING_OFFSET);

  let sampled = 0;
  let dark = 0;
  const step = Math.max(1, Math.round((rx1 - rx0) / 120));

  for (let x = rx0; x <= rx1; x += step) {
    for (const y of [ry0, ry1]) {
      sampled++;
      if (luminanceAt(data, w, x, y) < BORDER_DARK_LUMINANCE) dark++;
    }
  }
  for (let y = ry0; y <= ry1; y += step) {
    for (const x of [rx0, rx1]) {
      sampled++;
      if (luminanceAt(data, w, x, y) < BORDER_DARK_LUMINANCE) dark++;
    }
  }

  return sampled > 0 ? dark / sampled : 0;
}

/**
 * Finds speech bubbles by their usual visual signature: a fairly filled-in,
 * roughly rounded, near-white region enclosed by a darker outline stroke —
 * as opposed to large title/SFX lettering, which is normally drawn right
 * on the art with no such enclosing shape. This is a plain flood-fill
 * heuristic (no trained model), so it works best on typical clean
 * line-art bubbles and depends on the bubble having a visible border: if a
 * bubble has no outline and sits on a background that's just as light as
 * its fill, the flood fill can't tell where the bubble ends and the
 * background begins, and the merged region gets rejected as too large to
 * be a bubble. Real speech bubbles almost always have a border for exactly
 * this kind of visual separation, so this covers the common case.
 *
 * Returns bounding boxes in the ORIGINAL canvas's coordinate space.
 */
export function detectBubbles(sourceCanvas: HTMLCanvasElement): BubbleRegion[] {
  const longSide = Math.max(sourceCanvas.width, sourceCanvas.height);
  const scale = longSide > 0 ? Math.min(1, ANALYSIS_LONG_SIDE / longSide) : 1;
  const w = Math.max(1, Math.round(sourceCanvas.width * scale));
  const h = Math.max(1, Math.round(sourceCanvas.height * scale));

  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const ctx = small.getContext("2d");
  if (!ctx) return [];
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const pixelCount = w * h;
  const isLight = new Uint8Array(pixelCount);
  for (let p = 0, i = 0; i < pixelCount; p += 4, i++) {
    const lum = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    isLight[i] = lum >= LIGHT_LUMINANCE ? 1 : 0;
  }

  const visited = new Uint8Array(pixelCount);
  const stack = new Int32Array(pixelCount);
  const regions: BubbleRegion[] = [];

  for (let start = 0; start < pixelCount; start++) {
    if (!isLight[start] || visited[start]) continue;

    let sp = 0;
    stack[sp++] = start;
    visited[start] = 1;

    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    let count = 0;

    while (sp > 0) {
      const idx = stack[--sp];
      const x = idx % w;
      const y = (idx / w) | 0;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (x > 0) {
        const n = idx - 1;
        if (isLight[n] && !visited[n]) {
          visited[n] = 1;
          stack[sp++] = n;
        }
      }
      if (x < w - 1) {
        const n = idx + 1;
        if (isLight[n] && !visited[n]) {
          visited[n] = 1;
          stack[sp++] = n;
        }
      }
      if (y > 0) {
        const n = idx - w;
        if (isLight[n] && !visited[n]) {
          visited[n] = 1;
          stack[sp++] = n;
        }
      }
      if (y < h - 1) {
        const n = idx + w;
        if (isLight[n] && !visited[n]) {
          visited[n] = 1;
          stack[sp++] = n;
        }
      }
    }

    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    const fillRatio = count / (boxW * boxH);
    const areaRatio = count / pixelCount;
    const aspect = boxW / boxH;

    // A bubble reads as a reasonably solid, roughly rounded blob covering a
    // meaningful but not page-dominating area. Thin strips (panel gutters,
    // margins) fail the fill-ratio check; the absolute width/height floor
    // exists because a single white letter or word (from large title/SFX
    // text) is itself a small filled, roughly-square-ish light blob that
    // would otherwise pass every ratio check — a bubble has to be big
    // enough to actually hold a line of legible dialogue. The shape checks
    // alone can't tell a real bubble from a same-brightness patch of page
    // background, though, so the region only gets confirmed once there's
    // also a darker outline somewhere around it.
    const shapeLooksLikeBubble =
      areaRatio > 0.006 && areaRatio < 0.35 && fillRatio > 0.45 && aspect > 0.25 && aspect < 4 && boxW > 55 && boxH > 40;

    const looksLikeBubble =
      shapeLooksLikeBubble && borderDarkFraction(data, w, h, minX, minY, maxX, maxY) >= MIN_BORDER_DARK_FRACTION;

    if (looksLikeBubble) {
      regions.push({
        x0: minX / scale,
        y0: minY / scale,
        x1: (maxX + 1) / scale,
        y1: (maxY + 1) / scale,
      });
    }
  }

  return regions;
}

export function isInsideAnyBubble(
  bbox: { x0: number; y0: number; x1: number; y1: number },
  bubbles: BubbleRegion[]
): boolean {
  const cx = (bbox.x0 + bbox.x1) / 2;
  const cy = (bbox.y0 + bbox.y1) / 2;
  return bubbles.some((b) => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1);
}
