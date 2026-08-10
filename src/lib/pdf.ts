// pdfjs-dist touches browser-only globals (DOMMatrix, etc.) as soon as its
// module is evaluated, which breaks Next.js server-side prerendering if it's
// imported at the top level. Loading it lazily, only inside these
// browser-only functions, keeps the server build clean.
async function loadPdfjs() {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();
  return pdfjsLib;
}

export async function getPdfPageCount(file: File): Promise<number> {
  const pdfjsLib = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const doc = await loadingTask.promise;
  const count = doc.numPages;
  await loadingTask.destroy();
  return count;
}

export async function renderPdfPageToCanvas(
  file: File,
  pageNumber: number,
  scale = 2
): Promise<HTMLCanvasElement> {
  const pdfjsLib = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buffer });
  const doc = await loadingTask.promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("캔버스 컨텍스트를 생성할 수 없습니다.");

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  await loadingTask.destroy();
  return canvas;
}
