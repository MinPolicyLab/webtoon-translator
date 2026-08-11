"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";
import type { ComposableLine } from "@/lib/compose";
import InteractiveOverlay, { type InteractionMode } from "./InteractiveOverlay";

export interface LightboxItem {
  label: string;
  url: string;
  /** Untouched original page — enables the "원본" and interactive views. */
  sourceUrl?: string;
  /** Recognized bubble lines — presence of this is what turns on the
   * interactive click/drag view toggle for this item. */
  lines?: ComposableLine[];
  imageWidth?: number;
  imageHeight?: number;
}

interface Props {
  items: LightboxItem[];
  initialIndex: number;
  initialSpread?: boolean;
  onClose: () => void;
}

type ViewMode = "translated" | "interactive" | "original";

export default function Lightbox({ items, initialIndex, initialSpread = false, onClose }: Props) {
  const wantsSpread = initialSpread && items.length > 1;
  const [index, setIndex] = useState(() => {
    const start = Math.max(0, Math.min(items.length - 1, initialIndex));
    // A spread needs a next item to pair with; if the requested start is the
    // last item, shift back one so the very first render already has a pair
    // instead of silently falling back to a single page.
    return wantsSpread && start >= items.length - 1 ? Math.max(0, start - 1) : start;
  });
  const [spread, setSpread] = useState(wantsSpread);
  const [viewMode, setViewMode] = useState<ViewMode>("translated");
  const [interactionMode, setInteractionMode] = useState<InteractionMode>("click");

  const step = spread ? 2 : 1;
  const clamp = useCallback((i: number) => Math.max(0, Math.min(items.length - 1, i)), [items.length]);

  const goPrev = useCallback(() => setIndex((i) => clamp(i - step)), [clamp, step]);
  const goNext = useCallback(() => setIndex((i) => clamp(i + step)), [clamp, step]);

  const enableSpread = useCallback(() => {
    setSpread(true);
    // Same boundary fix as above, applied when the user toggles into spread
    // mode manually rather than opening straight into it.
    setIndex((i) => (i >= items.length - 1 && items.length > 1 ? Math.max(0, i - 1) : i));
  }, [items.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, goPrev, goNext]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  if (items.length === 0) return null;

  const current = items[index];
  const second = spread ? items[index + 1] : undefined;
  // The interactive/원본 toggle only makes sense for items that carry OCR
  // line data (currently only the batch grid supplies this) — single-file's
  // 원본/번역본 pairing has its own separate interactive view outside the
  // lightbox, so those items simply won't show the extra toggle.
  const supportsInteractive = !!current.lines && current.lines.length > 0;

  function renderPage(item: LightboxItem, alt: string) {
    if (viewMode === "interactive" && item.lines && item.sourceUrl && item.imageWidth && item.imageHeight) {
      return (
        <div
          className={styles.lightboxInteractiveWrap}
          style={{ aspectRatio: `${item.imageWidth} / ${item.imageHeight}` }}
        >
          <InteractiveOverlay
            imageUrl={item.sourceUrl}
            lines={item.lines}
            imageWidth={item.imageWidth}
            imageHeight={item.imageHeight}
            mode={interactionMode}
          />
        </div>
      );
    }
    const src = viewMode === "original" ? (item.sourceUrl ?? item.url) : item.url;
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  }

  return (
    <div className={styles.lightboxBackdrop} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.lightboxTop} onClick={(e) => e.stopPropagation()}>
        <span className={styles.lightboxCounter}>
          {second ? `${index + 1}–${index + 2}` : `${index + 1}`} / {items.length}
        </span>
        <div className={styles.lightboxTools}>
          {supportsInteractive && (
            <>
              <button
                type="button"
                className={viewMode === "translated" ? styles.pagerActive : undefined}
                onClick={() => setViewMode("translated")}
              >
                번역본
              </button>
              <button
                type="button"
                className={viewMode === "interactive" ? styles.pagerActive : undefined}
                onClick={() => setViewMode("interactive")}
              >
                원본+클릭 번역
              </button>
              <button
                type="button"
                className={viewMode === "original" ? styles.pagerActive : undefined}
                onClick={() => setViewMode("original")}
              >
                원본
              </button>
            </>
          )}
          {supportsInteractive && viewMode === "interactive" && (
            <>
              <button
                type="button"
                className={interactionMode === "click" ? styles.pagerActive : undefined}
                onClick={() => setInteractionMode("click")}
              >
                클릭
              </button>
              <button
                type="button"
                className={interactionMode === "drag" ? styles.pagerActive : undefined}
                onClick={() => setInteractionMode("drag")}
              >
                드래그
              </button>
            </>
          )}
          <button type="button" className={!spread ? styles.pagerActive : undefined} onClick={() => setSpread(false)}>
            1장
          </button>
          <button
            type="button"
            className={spread ? styles.pagerActive : undefined}
            onClick={enableSpread}
            disabled={items.length < 2}
          >
            2장
          </button>
          <a className={styles.downloadBtn} href={current.url} download={`${current.label.replace(/\.[^.]+$/, "")}.png`}>
            다운로드
          </a>
          <button type="button" className={styles.lightboxClose} onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
      </div>

      <div className={styles.lightboxStage} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.lightboxNav} onClick={goPrev} disabled={index <= 0} aria-label="이전 페이지">
          ‹
        </button>

        <div className={styles.lightboxImages} data-spread={second ? "true" : "false"}>
          {renderPage(current, current.label)}
          {second && renderPage(second, second.label)}
        </div>

        <button
          type="button"
          className={styles.lightboxNav}
          onClick={goNext}
          disabled={index + step >= items.length}
          aria-label="다음 페이지"
        >
          ›
        </button>
      </div>

      <div className={styles.lightboxLabel}>{second ? `${current.label} · ${second.label}` : current.label}</div>
    </div>
  );
}
