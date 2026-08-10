"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import styles from "./page.module.css";
import { buildWorkItems, type WorkItem } from "@/lib/batch";
import { processCanvas } from "@/lib/pipeline";
import { findSourceLanguage } from "@/lib/languages";
import Lightbox from "./Lightbox";

type ItemStatus = "pending" | "processing" | "done" | "error";

interface BatchItem {
  id: string;
  label: string;
  status: ItemStatus;
  composedUrl?: string;
  lineCount?: number;
  errorMsg?: string;
  autoDetected?: boolean;
  usedSourceCode?: string;
}

interface Props {
  sourceCode: string;
  targetCode: string;
}

export default function FolderBatchTranslator({ sourceCode, targetCode }: Props) {
  const [folderName, setFolderName] = useState("");
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [autoDetectLang, setAutoDetectLang] = useState(true);
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const stopRef = useRef(false);
  const dirInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // webkitdirectory isn't part of React's typed input attributes, so it's
    // set imperatively instead of via JSX props.
    const el = dirInputRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);

  const handleFolderSelect = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const relPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
    setFolderName(relPath ? relPath.split("/")[0] : "선택한 폴더");

    setScanning(true);
    setItems([]);
    setWorkItems([]);
    try {
      const built = await buildWorkItems(files);
      setWorkItems(built);
      setItems(built.map((w) => ({ id: w.id, label: w.label, status: "pending" as const })));
    } finally {
      setScanning(false);
    }
  }, []);

  const startBatch = useCallback(async () => {
    stopRef.current = false;
    setRunning(true);

    for (let i = 0; i < workItems.length; i++) {
      if (stopRef.current) break;
      const item = workItems[i];

      setItems((prev) => prev.map((it) => (it.id === item.id ? { ...it, status: "processing" } : it)));

      try {
        const canvas = await item.getCanvas();
        const result = await processCanvas(canvas, sourceCode, targetCode, undefined, autoDetectLang);
        const composedUrl = (result.composedCanvas ?? canvas).toDataURL("image/png");
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? {
                  ...it,
                  status: "done",
                  composedUrl,
                  lineCount: result.lines.length,
                  autoDetected: result.autoDetected,
                  usedSourceCode: result.usedSourceCode,
                }
              : it
          )
        );
      } catch (err) {
        console.error(`batch item failed: ${item.label}`, err);
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, status: "error", errorMsg: err instanceof Error ? err.message : "처리 실패" }
              : it
          )
        );
      }
    }

    setRunning(false);
  }, [workItems, sourceCode, targetCode, autoDetectLang]);

  const stopBatch = useCallback(() => {
    stopRef.current = true;
  }, []);

  const downloadZip = useCallback(async () => {
    const zip = new JSZip();
    const done = items.filter((it) => it.status === "done" && it.composedUrl);
    done.forEach((it, i) => {
      const base64 = it.composedUrl!.split(",")[1];
      const safeName = it.label.replace(/[\\/:*?"<>|]/g, "_").replace(/\.[^.]+$/, "");
      zip.file(`${String(i + 1).padStart(3, "0")}_${safeName}.png`, base64, { base64: true });
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${folderName || "translated"}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [items, folderName]);

  const doneItems = items.filter((it) => it.status === "done" && it.composedUrl);
  const doneCount = doneItems.length;
  const errorCount = items.filter((it) => it.status === "error").length;
  const processedCount = doneCount + errorCount;

  const previewItems = doneItems.map((it) => ({ label: it.label, url: it.composedUrl! }));
  const lightboxIndex = lightboxId ? doneItems.findIndex((it) => it.id === lightboxId) : -1;

  return (
    <>
      <label className={styles.dropzone}>
        <input
          ref={dirInputRef}
          type="file"
          multiple
          className={styles.fileInput}
          onChange={(e) => {
            if (e.target.files) void handleFolderSelect(e.target.files);
          }}
        />
        {folderName ? (
          <span>
            <strong>{folderName}</strong> 폴더 선택됨 — 다른 폴더를 클릭해서 교체
          </span>
        ) : (
          <span>클릭해서 웹툰 파일이 들어있는 폴더를 선택하세요 (하위 폴더 포함)</span>
        )}
      </label>

      {scanning && (
        <div className={styles.statusBar}>
          <div className={styles.spinner} />
          <span>폴더 안 파일을 확인하는 중...</span>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div className={styles.controls}>
            <span className={styles.field}>
              <span>대상 파일</span>
              <span className={styles.batchCount}>이미지/PDF 페이지 {items.length}개</span>
            </span>

            {!running ? (
              <button type="button" className={styles.downloadBtn} onClick={() => void startBatch()}>
                전체 번역 시작
              </button>
            ) : (
              <button type="button" className={styles.stopBtn} onClick={stopBatch}>
                중단
              </button>
            )}

            {doneCount > 0 && (
              <button type="button" className={styles.downloadBtn} onClick={() => void downloadZip()}>
                번역본 전체 ZIP 다운로드 ({doneCount})
              </button>
            )}

            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={autoDetectLang}
                disabled={running}
                onChange={(e) => setAutoDetectLang(e.target.checked)}
              />
              <span>인식 안 되면 다른 언어 자동 시도</span>
            </label>
          </div>

          {(running || processedCount > 0) && (
            <div className={styles.statusBar}>
              {running && <div className={styles.spinner} />}
              <span>
                {processedCount} / {items.length} 처리됨
                {errorCount > 0 && ` (오류 ${errorCount}개)`}
              </span>
            </div>
          )}

          <div className={styles.batchGrid}>
            {items.map((it) => (
              <div key={it.id} className={styles.batchCard} data-status={it.status}>
                <div
                  className={styles.batchThumb}
                  data-clickable={it.status === "done" ? "true" : "false"}
                  onClick={() => it.status === "done" && setLightboxId(it.id)}
                >
                  {it.composedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.composedUrl} alt={it.label} />
                  ) : (
                    <span className={styles.batchThumbPlaceholder}>
                      {it.status === "processing" ? "처리 중..." : it.status === "error" ? "오류" : "대기 중"}
                    </span>
                  )}
                </div>
                <div className={styles.batchMeta}>
                  <span className={styles.batchLabel} title={it.label}>
                    {it.label}
                  </span>
                  {it.autoDetected && it.usedSourceCode && (
                    <span className={styles.autoTag}>
                      자동 감지: {findSourceLanguage(it.usedSourceCode).label}
                    </span>
                  )}
                  {it.status === "done" && (
                    <a href={it.composedUrl} download={`${it.label.replace(/\.[^.]+$/, "")}-translated.png`}>
                      다운로드
                    </a>
                  )}
                  {it.status === "error" && <span className={styles.batchError}>{it.errorMsg}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {lightboxIndex >= 0 && (
        <Lightbox items={previewItems} initialIndex={lightboxIndex} onClose={() => setLightboxId(null)} />
      )}
    </>
  );
}
