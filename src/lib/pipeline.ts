import { runOcr, type OcrLine } from "./ocr";
import { composeTranslatedImage, type ComposableLine } from "./compose";
import { AUTO_LANG, COMBINED_OCR_LANGS } from "./languages";
import { detectBubbles, isInsideAnyBubble } from "./bubbles";

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
  /** How many recognized lines were outside any detected bubble and left untouched. */
  skippedOutsideBubble: number;
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
 *
 * `bubbleOnly` (default on) restricts translation to lines that fall
 * inside a detected speech bubble. Large title lettering and sound
 * effects are usually drawn straight onto the art rather than inside an
 * enclosed bubble shape, don't need translating to be understood, and
 * erasing them would cost image quality for no benefit — so they're left
 * completely untouched rather than boxed over.
 */
export async function processCanvas(
  canvas: HTMLCanvasElement,
  sourceOcrCode: string,
  targetTranslateCode: string,
  onOcrProgress?: (fraction: number) => void,
  autoDetectLang = true,
  bubbleOnly = true
): Promise<PageResult> {
  const usedSourceCode = autoDetectLang ? AUTO_LANG : sourceOcrCode;
  const ocrLangArg = autoDetectLang ? COMBINED_OCR_LANGS : sourceOcrCode;
  const ocrResult = await runOcr(canvas, ocrLangArg, onOcrProgress);

  const bubbles = bubbleOnly ? detectBubbles(canvas) : [];
  const candidateLines = bubbleOnly ? ocrResult.lines.filter((l) => isInsideAnyBubble(l.bbox, bubbles)) : ocrResult.lines;
  const skippedOutsideBubble = ocrResult.lines.length - candidateLines.length;

  if (candidateLines.length === 0) {
    return {
      lines: [],
      provider: null,
      sourceCanvas: canvas,
      composedCanvas: null,
      usedSourceCode,
      autoDetected: autoDetectLang,
      skippedOutsideBubble,
    };
  }

  const { translations, provider } = await translateLines(
    candidateLines.map((l) => l.text),
    usedSourceCode,
    targetTranslateCode
  );

  const lines: ComposableLine[] = candidateLines.map((line, i) => ({
    ...line,
    translated: translations[i] ?? null,
  }));

  const composedCanvas = composeTranslatedImage(canvas, lines);
  return {
    lines,
    provider,
    sourceCanvas: canvas,
    composedCanvas,
    usedSourceCode,
    autoDetected: autoDetectLang,
    skippedOutsideBubble,
  };
}

export type { OcrLine };
