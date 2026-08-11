import { runOcr, type OcrLine } from "./ocr";
import { composeTranslatedImage, type ComposableLine } from "./compose";
import { AUTO_LANG, COMBINED_OCR_LANGS } from "./languages";

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
  /** The OCR language(s) actually used — "auto" when multi-language mode ran. */
  usedSourceCode: string;
  /** True when multi-language mode ran instead of the single requested language. */
  autoDetected: boolean;
}

/**
 * Runs OCR on a rendered page canvas, translates every recognized line, and
 * paints the translations back onto a copy of the canvas. Shared by both
 * the single-file flow and the folder batch flow so they can't drift apart.
 *
 * `autoDetectLang` switches between two OCR strategies:
 *  - off: recognize with only the requested language.
 *  - on (default): recognize with every supported language loaded into one
 *    Tesseract pass, so a page mixing scripts (Korean dialogue next to
 *    Japanese sound effects, say) gets each line read in its own script
 *    instead of the whole page being forced into one language. Translation
 *    then auto-detects the source language per line to match.
 */
export async function processCanvas(
  canvas: HTMLCanvasElement,
  sourceOcrCode: string,
  targetTranslateCode: string,
  onOcrProgress?: (fraction: number) => void,
  autoDetectLang = true
): Promise<PageResult> {
  const usedSourceCode = autoDetectLang ? AUTO_LANG : sourceOcrCode;
  const ocrLangArg = autoDetectLang ? COMBINED_OCR_LANGS : sourceOcrCode;
  const ocrResult = await runOcr(canvas, ocrLangArg, onOcrProgress);

  if (ocrResult.lines.length === 0) {
    return {
      lines: [],
      provider: null,
      sourceCanvas: canvas,
      composedCanvas: null,
      usedSourceCode,
      autoDetected: autoDetectLang,
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
  return { lines, provider, sourceCanvas: canvas, composedCanvas, usedSourceCode, autoDetected: autoDetectLang };
}

export type { OcrLine };
