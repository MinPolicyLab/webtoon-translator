import { createWorker, PSM } from "tesseract.js";

export interface OcrLine {
  id: string;
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrResult {
  lines: OcrLine[];
  imageWidth: number;
  imageHeight: number;
}

const MIN_CONFIDENCE = 30;

// Tesseract reads small text much more reliably once individual character
// strokes are a handful of pixels tall. Webtoon panels are frequently
// exported well below that (long side under ~1000px is common for
// web-optimized images), so anything under this target gets scaled up
// before recognition — bbox coordinates are scaled back down afterward so
// callers never see the upscaled coordinate space.
const OCR_TARGET_LONG_SIDE = 1600;
const MAX_UPSCALE = 2.5;

/**
 * Upscales (if the image is small) and applies a grayscale + contrast
 * boost, so text sitting on busy line art or a textured background stands
 * out more clearly to the recognizer. Returns the scale factor applied so
 * the caller can map bbox coordinates back to the original image.
 */
function preprocessForOcr(source: HTMLCanvasElement): { canvas: HTMLCanvasElement; scale: number } {
  const longSide = Math.max(source.width, source.height);
  const scale = longSide > 0 ? Math.min(MAX_UPSCALE, Math.max(1, OCR_TARGET_LONG_SIDE / longSide)) : 1;

  const pre = document.createElement("canvas");
  pre.width = Math.round(source.width * scale);
  pre.height = Math.round(source.height * scale);
  const ctx = pre.getContext("2d");
  if (!ctx) return { canvas: source, scale: 1 };
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = "grayscale(1) contrast(1.6) brightness(1.08)";
  ctx.drawImage(source, 0, 0, pre.width, pre.height);
  return { canvas: pre, scale };
}

// A real speech-bubble line is a small fraction of the page. Tesseract
// occasionally mis-segments background art or paper texture as a "line"
// spanning a huge area — those get painted over in the compose step, which
// is how a wrong detection ends up erasing most of the artwork. Anything
// covering more of the page than this is treated as noise and dropped
// before it ever reaches translation/painting. Kept fairly generous so
// large sound-effect/title text isn't discarded along with genuine noise.
const MAX_LINE_AREA_RATIO = 0.22;

async function recognizeWithMode(
  worker: Awaited<ReturnType<typeof createWorker>>,
  mode: PSM,
  source: HTMLCanvasElement
) {
  await worker.setParameters({ tessedit_pageseg_mode: mode });
  const { data } = await worker.recognize(source, {}, { blocks: true, text: true });
  return data;
}

export async function runOcr(
  source: HTMLCanvasElement | File,
  langCode: string,
  onProgress?: (fraction: number) => void
): Promise<OcrResult> {
  const dims = await getSourceDimensions(source);
  const pageArea = dims.width * dims.height;

  // The worker script and WASM core are self-hosted (relative paths resolve
  // fine here — only inside a blob-wrapped worker does a relative path
  // become ambiguous) rather than left on tesseract.js's default CDN.
  // Loading them cross-origin turned out to fail intermittently with no
  // visible error (recognize() just silently returns zero blocks), and
  // once from a blob-URL worker it failed outright with a same-origin
  // Worker-construction error. Trained-data downloads (langPath) are left
  // on the default CDN since those are fetched normally, not the failure
  // point observed here.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const worker = await createWorker(langCode, undefined, {
    workerPath: `${origin}/tesseract/worker.min.js`,
    corePath: `${origin}/tesseract/core/`,
    logger: (m) => {
      if (m.status === "recognizing text" && typeof m.progress === "number") {
        onProgress?.(m.progress);
      }
    },
  });

  try {
    const { canvas: ocrSource, scale } =
      source instanceof HTMLCanvasElement ? preprocessForOcr(source) : { canvas: null, scale: 1 };

    // Webtoon/manga text often sits scattered in small clusters over dense
    // line art rather than filling the page — AUTO segmentation (the
    // default) is tuned for regular documents and can miss it entirely.
    // SPARSE_TEXT looks for text anywhere on the page without assuming a
    // regular layout, which fits this case much better. If that still
    // finds nothing, AUTO is tried as a fallback in case the page turns out
    // to be laid out more like a regular block after all.
    let data = await recognizeWithMode(worker, PSM.SPARSE_TEXT, ocrSource ?? (source as HTMLCanvasElement));
    if (!(data.blocks && data.blocks.length > 0) && ocrSource) {
      data = await recognizeWithMode(worker, PSM.AUTO, ocrSource);
    }

    const lines: OcrLine[] = [];
    let i = 0;
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          const text = line.text.trim();
          if (text.length === 0 || line.confidence < MIN_CONFIDENCE) continue;

          const { x0, y0, x1, y1 } = line.bbox;
          const bbox = { x0: x0 / scale, y0: y0 / scale, x1: x1 / scale, y1: y1 / scale };
          const lineArea = Math.max(0, bbox.x1 - bbox.x0) * Math.max(0, bbox.y1 - bbox.y0);
          if (pageArea > 0 && lineArea / pageArea > MAX_LINE_AREA_RATIO) continue;

          lines.push({
            id: `line-${i++}`,
            text,
            confidence: line.confidence,
            bbox,
          });
        }
      }
    }

    return { lines, imageWidth: dims.width, imageHeight: dims.height };
  } finally {
    await worker.terminate();
  }
}

async function getSourceDimensions(
  source: HTMLCanvasElement | File
): Promise<{ width: number; height: number }> {
  if (source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height };
  }
  const bitmap = await createImageBitmap(source);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}
