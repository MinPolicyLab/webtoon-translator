import { runOcr, type OcrLine } from "./ocr";
import { composeTranslatedImage, type ComposableLine } from "./compose";
import { SOURCE_LANGUAGES } from "./languages";

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
  /** The OCR language actually used — may differ from the requested one if auto-detect kicked in. */
  usedSourceCode: string;
  /** True when the requested language found nothing and a different one was tried instead. */
  autoDetected: boolean;
}

type OcrResult = Awaited<ReturnType<typeof runOcr>>;

// A model given the wrong script doesn't reliably return nothing — it can
// force-fit glyphs and report a handful of "confident" but nonsensical
// lines (verified against Latin text run through a Thai model). So instead
// of trusting "any lines at all", every candidate is scored by how much
// confident text it found, and the best-scoring one wins.
function scoreOcrResult(result: OcrResult): number {
  if (result.lines.length === 0) return 0;
  const avgConfidence = result.lines.reduce((sum, l) => sum + l.confidence, 0) / result.lines.length;
  return avgConfidence * Math.min(result.lines.length, 5);
}

const GOOD_ENOUGH_SCORE = 65 * 2; // roughly: a couple of lines recognized with solid confidence

/**
 * Tries the requested OCR language first. If the result looks weak (empty,
 * or low-confidence), tries every other supported language too and keeps
 * whichever attempt scored best overall.
 */
async function ocrWithLanguageFallback(
  canvas: HTMLCanvasElement,
  sourceOcrCode: string,
  autoDetectLang: boolean,
  onOcrProgress?: (fraction: number) => void
): Promise<{ ocrResult: OcrResult; usedSourceCode: string; autoDetected: boolean }> {
  const primary = await runOcr(canvas, sourceOcrCode, onOcrProgress);
  const primaryScore = scoreOcrResult(primary);

  if (!autoDetectLang || primaryScore >= GOOD_ENOUGH_SCORE) {
    return { ocrResult: primary, usedSourceCode: sourceOcrCode, autoDetected: false };
  }

  let best = { code: sourceOcrCode, result: primary, score: primaryScore };
  const candidates = SOURCE_LANGUAGES.map((l) => l.ocrCode).filter((code) => code !== sourceOcrCode);

  for (const candidate of candidates) {
    const attempt = await runOcr(canvas, candidate);
    const score = scoreOcrResult(attempt);
    if (score > best.score) {
      best = { code: candidate, result: attempt, score };
    }
  }

  return { ocrResult: best.result, usedSourceCode: best.code, autoDetected: best.code !== sourceOcrCode };
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
  onOcrProgress?: (fraction: number) => void,
  autoDetectLang = true
): Promise<PageResult> {
  const { ocrResult, usedSourceCode, autoDetected } = await ocrWithLanguageFallback(
    canvas,
    sourceOcrCode,
    autoDetectLang,
    onOcrProgress
  );

  if (ocrResult.lines.length === 0) {
    return {
      lines: [],
      provider: null,
      sourceCanvas: canvas,
      composedCanvas: null,
      usedSourceCode,
      autoDetected,
    };
  }

  const { translations, provider } = await translateLines(
    ocrResult.lines.map((l) => l.text),
    usedSourceCode,
    targetTranslateCode
  );

  const lines: ComposableLine[] = ocrResult.lines.map((line, i) => ({
    ...line,
    translated: translations[i] ?? null,
  }));

  const composedCanvas = composeTranslatedImage(canvas, lines);
  return { lines, provider, sourceCanvas: canvas, composedCanvas, usedSourceCode, autoDetected };
}

export type { OcrLine };
