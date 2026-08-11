"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";
import { getPdfPageCount, renderPdfPageToCanvas } from "@/lib/pdf";
import { processCanvas, type PageResult } from "@/lib/pipeline";
import Lightbox from "./Lightbox";

type Status = "idle" | "loading-page" | "ocr" | "translating" | "done" | "error";

interface Props {
  sourceCode: string;
  targetCode: string;
}

export default function SingleFileTranslator({ sourceCode, targetCode }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [fileKind, setFileKind] = useState<"image" | "pdf" | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [pageIndex, setPageIndex] = useState(1);

  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<PageResult | null>(null);
  const [viewMode, setViewMode] = useState<"translated" | "original">("translated");
  const [showOriginal, setShowOriginal] = useState(false);
  const [autoDetectLang, setAutoDetectLang] = useState(true);
  const [bubbleOnly, setBubbleOnly] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const [canvasUrl, setCanvasUrl] = useState<string>("");
  const [composedUrl, setComposedUrl] = useState<string>("");

  const run = useCallback(
    async (targetFile: File, kind: "image" | "pdf", targetPage: number) => {
      setStatus("loading-page");
      setErrorMsg("");
      setResult(null);
      setComposedUrl("");
      setProgress(0);

      try {
        const canvas =
          kind === "pdf" ? await renderPdfPageToCanvas(targetFile, targetPage) : await imageFileToCanvas(targetFile);
        setCanvasUrl(canvas.toDataURL("image/png"));

        setStatus("ocr");
        const pageResult = await processCanvasWithPhase(
          canvas,
          sourceCode,
          targetCode,
          (p) => setProgress(p),
          setStatus,
          autoDetectLang,
          bubbleOnly
        );

        setResult(pageResult);
        if (pageResult.composedCanvas) {
          setComposedUrl(pageResult.composedCanvas.toDataURL("image/png"));
        }
        setStatus("done");
      } catch (err) {
        console.error(err);
        setErrorMsg(err instanceof Error ? err.message : "처리 중 오류가 발생했습니다.");
        setStatus("error");
      }
    },
    [sourceCode, targetCode, autoDetectLang, bubbleOnly]
  );

  const handleFileChange = useCallback(
    async (selected: File) => {
      setFile(selected);
      const kind = selected.type === "application/pdf" ? "pdf" : "image";
      setFileKind(kind);
      setPageIndex(1);

      if (kind === "pdf") {
        try {
          setPageCount(await getPdfPageCount(selected));
        } catch {
          setPageCount(1);
        }
      } else {
        setPageCount(1);
      }

      await run(selected, kind, 1);
    },
    [run]
  );

  useEffect(() => {
    if (file && fileKind) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void run(file, fileKind, pageIndex);
    }
    // Re-runs whenever the page, languages, or auto-detect toggle change;
    // `run`'s identity is intentionally not a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, sourceCode, targetCode, autoDetectLang, bubbleOnly]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) void handleFileChange(dropped);
    },
    [handleFileChange]
  );

  const isBusy = status === "loading-page" || status === "ocr" || status === "translating";
  const lines = result?.lines ?? [];

  return (
    <>
      <label className={styles.dropzone} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <input
          type="file"
          accept="image/*,application/pdf"
          className={styles.fileInput}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFileChange(f);
          }}
        />
        {file ? (
          <span>
            <strong>{file.name}</strong> 선택됨 — 다른 파일을 드래그하거나 클릭해서 교체
          </span>
        ) : (
          <span>이미지 또는 PDF 파일을 드래그하거나 클릭해서 선택하세요</span>
        )}
      </label>

      <div className={styles.controls}>
        {fileKind === "pdf" && pageCount > 1 && (
          <label className={styles.field}>
            <span>페이지</span>
            <div className={styles.pager}>
              <button type="button" disabled={isBusy || pageIndex <= 1} onClick={() => setPageIndex((p) => Math.max(1, p - 1))}>
                이전
              </button>
              <span>
                {pageIndex} / {pageCount}
              </span>
              <button
                type="button"
                disabled={isBusy || pageIndex >= pageCount}
                onClick={() => setPageIndex((p) => Math.min(pageCount, p + 1))}
              >
                다음
              </button>
            </div>
          </label>
        )}

        {composedUrl && (
          <div className={styles.field}>
            <span>화면</span>
            <div className={styles.pager}>
              <button
                type="button"
                className={viewMode === "translated" ? styles.pagerActive : undefined}
                onClick={() => setViewMode("translated")}
              >
                번역본
              </button>
              <button
                type="button"
                className={viewMode === "original" ? styles.pagerActive : undefined}
                onClick={() => setViewMode("original")}
              >
                원본
              </button>
            </div>
          </div>
        )}

        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={autoDetectLang}
            onChange={(e) => setAutoDetectLang(e.target.checked)}
          />
          <span>여러 언어가 섞여 있어도 한 번에 인식 (다국어 자동 인식)</span>
        </label>

        <label className={styles.toggle}>
          <input type="checkbox" checked={bubbleOnly} onChange={(e) => setBubbleOnly(e.target.checked)} />
          <span>말풍선 안의 글자만 번역 (효과음·제목 글자는 원본 유지)</span>
        </label>

        <label className={styles.toggle}>
          <input type="checkbox" checked={showOriginal} onChange={(e) => setShowOriginal(e.target.checked)} />
          <span>목록에 원문도 함께 표시</span>
        </label>

        {canvasUrl && (
          <button type="button" className={styles.downloadBtn} onClick={() => setLightboxOpen(true)}>
            전체화면으로 보기
          </button>
        )}

        {composedUrl && (
          <a
            className={styles.downloadBtn}
            href={composedUrl}
            download={`${(file?.name ?? "translated").replace(/\.[^.]+$/, "")}-translated.png`}
          >
            번역 이미지 다운로드
          </a>
        )}
      </div>

      {isBusy && (
        <div className={styles.statusBar}>
          <div className={styles.spinner} />
          <span>
            {status === "loading-page" && "페이지를 준비하는 중..."}
            {status === "ocr" && `글자를 인식하는 중... ${Math.round(progress * 100)}%`}
            {status === "translating" && "번역하는 중..."}
          </span>
        </div>
      )}

      {status === "error" && <p className={styles.errorBox}>{errorMsg}</p>}

      {status === "done" && lines.length === 0 && (
        <p className={styles.emptyBox}>이 페이지에서 인식할 수 있는 글자를 찾지 못했습니다.</p>
      )}

      {canvasUrl && (
        <div className={styles.workArea}>
          <div className={styles.previewWrap}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={viewMode === "translated" && composedUrl ? composedUrl : canvasUrl}
              alt={viewMode === "translated" && composedUrl ? "번역된 페이지" : "원본 페이지"}
              className={styles.previewImage}
            />
          </div>

          {lines.length > 0 && (
            <aside className={styles.linePanel}>
              <div className={styles.linePanelHeader}>
                <span>
                  말풍선 대사 {lines.length}줄
                  {!!result?.skippedOutsideBubble && (
                    <span className={styles.skippedNote}> (말풍선 밖 {result.skippedOutsideBubble}줄은 원본 유지)</span>
                  )}
                </span>
                <span className={styles.tagGroup}>
                  {result?.autoDetected && <span className={styles.autoTag}>다국어 자동 인식</span>}
                  {result?.provider && <span className={styles.providerTag}>{result.provider}</span>}
                </span>
              </div>
              <ol className={styles.lineList}>
                {lines.map((line) => (
                  <li key={line.id}>
                    {showOriginal && <p className={styles.original}>{line.text}</p>}
                    <p className={styles.translated}>{line.translated ?? "번역 중..."}</p>
                  </li>
                ))}
              </ol>
            </aside>
          )}
        </div>
      )}

      {lightboxOpen && canvasUrl && (
        <Lightbox
          items={
            composedUrl
              ? [
                  { label: "원본", url: canvasUrl },
                  { label: "번역본", url: composedUrl },
                ]
              : [{ label: "원본", url: canvasUrl }]
          }
          initialIndex={composedUrl && viewMode === "translated" ? 1 : 0}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

async function processCanvasWithPhase(
  canvas: HTMLCanvasElement,
  sourceCode: string,
  targetCode: string,
  onOcrProgress: (fraction: number) => void,
  setStatus: (s: Status) => void,
  autoDetectLang: boolean,
  bubbleOnly: boolean
): Promise<PageResult> {
  const result = await processCanvas(
    canvas,
    sourceCode,
    targetCode,
    (p) => {
      onOcrProgress(p);
      if (p > 0) setStatus("ocr");
    },
    autoDetectLang,
    bubbleOnly
  );
  if (result.lines.length > 0) setStatus("translating");
  return result;
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
