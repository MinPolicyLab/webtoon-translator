import { runOcr, type OcrLine } from "./ocr";
import { composeTranslatedImage, type ComposableLine } from "./compose";

export interface TranslateApiResult {
  translations: string[];
  provider: string;
}

export async function translateLines(
  texts: string[],
  sourceOcrCode: string,
  targetTranslateCode: string
): Promise<TranslateApiResult> {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts, sourceOcrCode, targetTranslateCode }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `번역 요청 실패 (${res.status})`);
  }

  return (await res.json()) as TranslateApiResult;
}

export interface PageResult {
  lines: ComposableLine[];
  provider: string | null;
  sourceCanvas: HTMLCanvasElement;
  composedCanvas: HTMLCanvasElement | null;
}

/**
 * Runs OCR on a rendered page canvas, translates every recognized line, and
 * paints the translations back onto a copy of the canvas. Shared by both
 * the single-file flow and the folder batch flow so they can't drift apart.
 */
export async function processCanvas(
  canvas: HTMLCanvasElement,
  sourceOcrCode: string,
  targetTranslateCode: string,
  onOcrProgress?: (fraction: number) => void
): Promise<PageResult> {
  const ocrResult = await runOcr(canvas, sourceOcrCode, onOcrProgress);

  if (ocrResult.lines.length === 0) {
    return { lines: [], provider: null, sourceCanvas: canvas, composedCanvas: null };
  }

  const { translations, provider } = await translateLines(
    ocrResult.lines.map((l) => l.text),
    sourceOcrCode,
    targetTranslateCode
  );

  const lines: ComposableLine[] = ocrResult.lines.map((line, i) => ({
    ...line,
    translated: translations[i] ?? null,
  }));

  const composedCanvas = composeTranslatedImage(canvas, lines);
  return { lines, provider, sourceCanvas: canvas, composedCanvas };
}

export type { OcrLine };
