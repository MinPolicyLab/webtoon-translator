"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import { runOcr, type OcrLine } from "@/lib/ocr";
import { getPdfPageCount, renderPdfPageToCanvas } from "@/lib/pdf";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from "@/lib/languages";

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

  const [imageWidth, setImageWidth] = useState(0);
  const [imageHeight, setImageHeight] = useState(0);
  const [lines, setLines] = useState<LinePair[]>([]);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const [canvasUrl, setCanvasUrl] = useState<string>("");

  const process = useCallback(
    async (targetFile: File, kind: "image" | "pdf", targetPage: number) => {
      setStatus("loading-page");
      setErrorMsg("");
      setLines([]);
      setProvider(null);
      setProgress(0);

      try {
        let canvas: HTMLCanvasElement;
        if (kind === "pdf") {
          canvas = await renderPdfPageToCanvas(targetFile, targetPage);
        } else {
          canvas = await imageFileToCanvas(targetFile);
        }
        setImageWidth(canvas.width);
        setImageHeight(canvas.height);
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
    if (file && fileKind) {
      void process(file, fileKind, pageIndex);
    }
    // re-run whenever the page, source, or target language changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageIndex, sourceCode, targetCode]);

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
        번역 API로 번역해 원본 위에 겹쳐 보여줍니다. 다른 웹사이트의 화면을 읽어오는 기능은
        아니며, 사용자가 올린 파일만 처리합니다.
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

        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showOverlay}
            onChange={(e) => setShowOverlay(e.target.checked)}
          />
          <span>번역 오버레이 표시</span>
        </label>

        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={showOriginal}
            onChange={(e) => setShowOriginal(e.target.checked)}
          />
          <span>원문도 함께 표시</span>
        </label>
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
          <div className={styles.previewWrap} ref={previewRef}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={canvasUrl} alt="업로드한 페이지" className={styles.previewImage} />
            {showOverlay &&
              lines.map((line) => (
                <div
                  key={line.id}
                  className={styles.overlayBox}
                  style={{
                    left: `${(line.bbox.x0 / imageWidth) * 100}%`,
                    top: `${(line.bbox.y0 / imageHeight) * 100}%`,
                    width: `${((line.bbox.x1 - line.bbox.x0) / imageWidth) * 100}%`,
                    height: `${((line.bbox.y1 - line.bbox.y0) / imageHeight) * 100}%`,
                  }}
                  title={line.text}
                >
                  <span>{line.translated ?? "…"}</span>
                </div>
              ))}
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

      <canvas ref={canvasRef} style={{ display: "none" }} />
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
