import { createWorker } from "tesseract.js";

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

const MIN_CONFIDENCE = 35;

// A real speech-bubble line is a small fraction of the page. Tesseract
// occasionally mis-segments background art or paper texture as a "line"
// spanning a huge area — those get painted over in the compose step, which
// is how a wrong detection ends up erasing most of the artwork. Anything
// covering more of the page than this is treated as noise and dropped
// before it ever reaches translation/painting.
const MAX_LINE_AREA_RATIO = 0.12;

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
    const { data } = await worker.recognize(source, {}, { blocks: true, text: true });

    const lines: OcrLine[] = [];
    let i = 0;
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          const text = line.text.trim();
          if (text.length === 0 || line.confidence < MIN_CONFIDENCE) continue;

          const { x0, y0, x1, y1 } = line.bbox;
          const lineArea = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
          if (pageArea > 0 && lineArea / pageArea > MAX_LINE_AREA_RATIO) continue;

          lines.push({
            id: `line-${i++}`,
            text,
            confidence: line.confidence,
            bbox: line.bbox,
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
