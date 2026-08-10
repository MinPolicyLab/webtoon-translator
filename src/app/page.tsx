"use client";

import { useState } from "react";
import styles from "./page.module.css";
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from "@/lib/languages";
import SingleFileTranslator from "./SingleFileTranslator";
import FolderBatchTranslator from "./FolderBatchTranslator";

type Mode = "file" | "folder";

export default function Home() {
  const [mode, setMode] = useState<Mode>("file");
  const [sourceCode, setSourceCode] = useState("jpn");
  const [targetCode, setTargetCode] = useState("ko");

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>오픈소스 · 브라우저 OCR + 실 번역 API</p>
          <h1>웹툰·만화 이미지 번역기</h1>
        </div>
      </header>

      <p className={styles.subhead}>
        이미지(JPG/PNG/WebP) 또는 PDF 파일을 올리면, 브라우저에서 글자를 인식(OCR)한 뒤 말풍선
        배경색을 읽어 원문을 지우고 번역문을 다시 그려 넣습니다. 파일 하나만 처리하거나, 폴더를
        통째로 골라 그 안의 파일 전체를 한 번에 처리할 수 있습니다. 다른 웹사이트의 화면을
        읽어오는 기능은 아니며, 사용자가 직접 고른 파일·폴더만 처리합니다.
      </p>

      <div className={styles.modeSwitch}>
        <button
          type="button"
          className={mode === "file" ? styles.modeActive : undefined}
          onClick={() => setMode("file")}
        >
          파일 하나
        </button>
        <button
          type="button"
          className={mode === "folder" ? styles.modeActive : undefined}
          onClick={() => setMode("folder")}
        >
          폴더 전체
        </button>
      </div>

      <div className={styles.controls}>
        <label className={styles.field}>
          <span>원문 언어</span>
          <select value={sourceCode} onChange={(e) => setSourceCode(e.target.value)}>
            {SOURCE_LANGUAGES.map((l) => (
              <option key={l.ocrCode} value={l.ocrCode}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>번역 언어</span>
          <select value={targetCode} onChange={(e) => setTargetCode(e.target.value)}>
            {TARGET_LANGUAGES.map((l) => (
              <option key={l.translateCode} value={l.translateCode}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {mode === "file" ? (
        <SingleFileTranslator sourceCode={sourceCode} targetCode={targetCode} />
      ) : (
        <FolderBatchTranslator sourceCode={sourceCode} targetCode={targetCode} />
      )}
    </div>
  );
}
