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

export async function runOcr(
  source: HTMLCanvasElement | File,
  langCode: string,
  onProgress?: (fraction: number) => void
): Promise<OcrResult> {
  const worker = await createWorker(langCode, undefined, {
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
          if (text.length > 0 && line.confidence >= MIN_CONFIDENCE) {
            lines.push({
              id: `line-${i++}`,
              text,
              confidence: line.confidence,
              bbox: line.bbox,
            });
          }
        }
      }
    }

    const dims = await getSourceDimensions(source);
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
