import { getPdfPageCount, renderPdfPageToCanvas } from "./pdf";

export interface WorkItem {
  id: string;
  label: string;
  getCanvas: () => Promise<HTMLCanvasElement>;
}

function fileSortKey(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

export function isSupportedFile(file: File): boolean {
  return file.type.startsWith("image/") || file.type === "application/pdf";
}

async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스 컨텍스트를 생성할 수 없습니다.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

/**
 * Turns a folder selection into a flat, page-level work queue: images
 * become one item each, and multi-page PDFs expand into one item per page
 * so batch progress reflects actual pages rather than files.
 */
export async function buildWorkItems(files: File[]): Promise<WorkItem[]> {
  const sorted = [...files]
    .filter(isSupportedFile)
    .sort((a, b) => fileSortKey(a).localeCompare(fileSortKey(b), undefined, { numeric: true, sensitivity: "base" }));

  const items: WorkItem[] = [];

  for (const file of sorted) {
    if (file.type === "application/pdf") {
      let pageCount = 1;
      try {
        pageCount = await getPdfPageCount(file);
      } catch {
        pageCount = 1;
      }
      for (let p = 1; p <= pageCount; p++) {
        items.push({
          id: `${fileSortKey(file)}#${p}`,
          label: pageCount > 1 ? `${file.name} (${p}/${pageCount})` : file.name,
          getCanvas: () => renderPdfPageToCanvas(file, p),
        });
      }
    } else {
      items.push({
        id: fileSortKey(file),
        label: file.name,
        getCanvas: () => imageFileToCanvas(file),
      });
    }
  }

  return items;
}
