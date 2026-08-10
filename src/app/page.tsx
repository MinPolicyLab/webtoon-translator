"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { runOcr, type OcrLine } from "@/lib/ocr";
import { getPdfPageCount, renderPdfPageToCanvas } from "@/lib/pdf";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from "@/lib/languages";
import { composeTranslatedImage } from "@/lib/compose";

type Status = "idle" | "loading-page" | "ocr" | "translating" | "done" | "error";

interface LinePair extends OcrLine {
  translated: string | null;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [fileKind, setFileKind] = useState<"image" | "pdf" | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [pageIndex, setPageIndex] = useState(1);

  const [sourceCode, setSourceCode] = useState("jpn");
  const [targetCode, setTargetCode] = useState("ko");

  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [provider, setProvider] = useState<string | null>(null);

  const [lines, setLines] = useState<LinePair[]>([]);
  const [viewMode, setViewMode] = useState<"translated" | "original">("translated");
  const [showOriginal, setShowOriginal] = useState(false);

  const sourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasUrl, setCanvasUrl] = useState<string>("");
  const [composedUrl, setComposedUrl] = useState<string>("");
  const [composing, setComposing] = useState(false);

  const process = useCallback(
    async (targetFile: File, kind: "image" | "pdf", targetPage: number) => {
      setStatus("loading-page");
      setErrorMsg("");
      setLines([]);
      setProvider(null);
      setProgress(0);
      setComposedUrl("");

      try {
        let canvas: HTMLCanvasElement;
        if (kind === "pdf") {
          canvas = await renderPdfPageToCanvas(targetFile, targetPage);
        } else {
          canvas = await imageFileToCanvas(targetFile);
        }
        sourceCanvasRef.current = canvas;
        setCanvasUrl(canvas.toDataURL("image/png"));

        setStatus("ocr");
        const ocrResult = await runOcr(canvas, sourceCode, (p) => setProgress(p));

        if (ocrResult.lines.length === 0) {
          setLines([]);
          setStatus("done");
          return;
        }

        setStatus("translating");
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            texts: ocrResult.lines.map((l) => l.text),
            sourceOcrCode: sourceCode,
            targetTranslateCode: targetCode,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `번역 요청 실패 (${res.status})`);
        }

        const data = (await res.json()) as { translations: string[]; provider: string };
        setProvider(data.provider);
        setLines(
          ocrResult.lines.map((line, i) => ({
            ...line,
            translated: data.translations[i] ?? null,
          }))
        );
        setStatus("done");
      } catch (err) {
        console.error(err);
        setErrorMsg(err instanceof Error ? err.message : "처리 중 오류가 발생했습니다.");
        setStatus("error");
      }
    },
    [sourceCode, targetCode]
  );

  const handleFileChange = useCallback(
    async (selected: File) => {
      setFile(selected);
      const kind = selected.type === "application/pdf" ? "pdf" : "image";
      setFileKind(kind);
      setPageIndex(1);

      if (kind === "pdf") {
        try {
          const count = await getPdfPageCount(selected);
          setPageCount(count);
        } catch {
          setPageCount(1);
        }
      } else {
        setPageCount(1);
      }

      await process(selected, kind, 1);
    },
    [process]
  );

  useEffect(() => {
    // Re-runs the OCR+translate pipeline whenever the page or languages
    // change; `process` itself is intentionally excluded from deps since
    // it's re-created every render but its identity isn't what should
    // trigger a re-run here.
    if (file && fileKind) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void process(file, fileKind, pageIndex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, sourceCode, targetCode]);

  useEffect(() => {
    const source = sourceCanvasRef.current;
    if (!source || lines.length === 0 || !lines.some((l) => l.translated)) {
      setComposedUrl("");
      return;
    }
    setComposing(true);
    try {
      const composed = composeTranslatedImage(source, lines);
      setComposedUrl(composed.toDataURL("image/png"));
    } catch (err) {
      console.error("compose error", err);
    } finally {
      setComposing(false);
    }
  }, [lines]);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLLabelElement>) => {
      e.preventDefault();
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) void handleFileChange(dropped);
    },
    [handleFileChange]
  );

  const isBusy = status === "loading-page" || status === "ocr" || status === "translating";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>오픈소스 · 브라우저 OCR + 실 번역 API</p>
          <h1>웹툰·만화 이미지 번역기</h1>
        </div>
      </header>

      <p className={styles.subhead}>
        이미지(JPG/PNG/WebP) 또는 PDF 파일을 직접 올리면, 브라우저에서 글자를 인식(OCR)한 뒤
        말풍선 배경색을 읽어 그 위에 원문을 지우고 번역문을 다시 그려 넣습니다. 결과 이미지를
        그대로 다운로드할 수 있습니다. 다른 웹사이트의 화면을 읽어오는 기능은 아니며, 사용자가
        올린 파일만 처리합니다.
      </p>

      <label
        className={styles.dropzone}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
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
        <label className={styles.field}>
          <span>원문 언어</span>
          <select
            value={sourceCode}
            onChange={(e) => setSourceCode(e.target.value)}
            disabled={isBusy}
          >
            {SOURCE_LANGUAGES.map((l) => (
              <option key={l.ocrCode} value={l.ocrCode}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>번역 언어</span>
          <select
            value={targetCode}
            onChange={(e) => setTargetCode(e.target.value)}
            disabled={isBusy}
          >
            {TARGET_LANGUAGES.map((l) => (
              <option key={l.translateCode} value={l.translateCode}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        {fileKind === "pdf" && pageCount > 1 && (
          <label className={styles.field}>
            <span>페이지</span>
            <div className={styles.pager}>
              <button
                type="button"
                disabled={isBusy || pageIndex <= 1}
                onClick={() => setPageIndex((p) => Math.max(1, p - 1))}
              >
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
            checked={showOriginal}
            onChange={(e) => setShowOriginal(e.target.checked)}
          />
          <span>목록에 원문도 함께 표시</span>
        </label>

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
            {composing && (
              <div className={styles.composingBadge}>말풍선에 번역문을 그려 넣는 중...</div>
            )}
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
                <span>인식된 대사 {lines.length}줄</span>
                {provider && <span className={styles.providerTag}>{provider}</span>}
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

    </div>
  );
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
