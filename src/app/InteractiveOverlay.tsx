"use client";

import { useCallback, useRef, useState } from "react";
import styles from "./page.module.css";
import type { ComposableLine } from "@/lib/compose";

export type InteractionMode = "click" | "drag";

interface Props {
  imageUrl: string;
  lines: ComposableLine[];
  imageWidth: number;
  imageHeight: number;
  mode: InteractionMode;
}

interface PctRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Hotspots are padded a bit past the raw OCR box — the box is drawn tight
// around the glyphs, which makes for a fussy, thin click target otherwise.
const HOTSPOT_PAD_X = 2.2;
const HOTSPOT_PAD_Y = 3;

function bboxToPercent(
  bbox: { x0: number; y0: number; x1: number; y1: number },
  imageWidth: number,
  imageHeight: number
): PctRect {
  const left = (bbox.x0 / imageWidth) * 100 - HOTSPOT_PAD_X;
  const top = (bbox.y0 / imageHeight) * 100 - HOTSPOT_PAD_Y;
  const width = ((bbox.x1 - bbox.x0) / imageWidth) * 100 + HOTSPOT_PAD_X * 2;
  const height = ((bbox.y1 - bbox.y0) / imageHeight) * 100 + HOTSPOT_PAD_Y * 2;
  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: Math.min(100 - Math.max(0, left), width),
    height: Math.min(100 - Math.max(0, top), height),
  };
}

function rectsOverlap(a: PctRect, b: PctRect): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

/**
 * Shows the untouched original page with invisible-until-hovered markers
 * over each bubble line, and reveals a translation label on demand instead
 * of baking it into the image — lets someone browse the original at full
 * quality and only surface a translation for the line they're actually
 * looking at.
 */
export default function InteractiveOverlay({ imageUrl, lines, imageWidth, imageHeight, mode }: Props) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [dragRect, setDragRect] = useState<PctRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

  const toPercent = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)),
    };
  }, []);

  const toggleIds = useCallback((ids: string[]) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== "drag") return;
      const p = toPercent(e.clientX, e.clientY);
      dragStartRef.current = p;
      setDragRect({ left: p.x, top: p.y, width: 0, height: 0 });
    },
    [mode, toPercent]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (mode !== "drag" || !dragStartRef.current) return;
      const p = toPercent(e.clientX, e.clientY);
      const start = dragStartRef.current;
      setDragRect({
        left: Math.min(start.x, p.x),
        top: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      });
    },
    [mode, toPercent]
  );

  const finishDrag = useCallback(
    (clientX: number, clientY: number) => {
      const start = dragStartRef.current;
      if (mode !== "drag" || !start) return;
      const p = toPercent(clientX, clientY);
      const isTap = Math.abs(p.x - start.x) < 1.2 && Math.abs(p.y - start.y) < 1.2;
      const selRect: PctRect = {
        left: Math.min(start.x, p.x),
        top: Math.min(start.y, p.y),
        width: Math.abs(p.x - start.x),
        height: Math.abs(p.y - start.y),
      };

      const matched: string[] = [];
      for (const line of lines) {
        const hb = bboxToPercent(line.bbox, imageWidth, imageHeight);
        const hit = isTap
          ? p.x >= hb.left && p.x <= hb.left + hb.width && p.y >= hb.top && p.y <= hb.top + hb.height
          : rectsOverlap(selRect, hb);
        if (hit) matched.push(line.id);
      }
      if (matched.length > 0) toggleIds(matched);

      dragStartRef.current = null;
      setDragRect(null);
    },
    [mode, toPercent, lines, imageWidth, imageHeight, toggleIds]
  );

  const handleMouseUp = useCallback((e: React.MouseEvent) => finishDrag(e.clientX, e.clientY), [finishDrag]);
  const handleMouseLeave = useCallback(() => {
    dragStartRef.current = null;
    setDragRect(null);
  }, []);

  return (
    <div
      ref={containerRef}
      className={styles.interactiveContainer}
      data-mode={mode}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="원본 페이지 (대화형)" className={styles.previewImage} draggable={false} />

      {lines.map((line) => {
        const hb = bboxToPercent(line.bbox, imageWidth, imageHeight);
        const isRevealed = revealed.has(line.id);
        return (
          <button
            key={line.id}
            type="button"
            className={styles.hotspot}
            data-revealed={isRevealed}
            style={{ left: `${hb.left}%`, top: `${hb.top}%`, width: `${hb.width}%`, height: `${hb.height}%` }}
            onClick={() => mode === "click" && toggleIds([line.id])}
            aria-label={isRevealed ? line.translated ?? "" : "번역 보기"}
          >
            {isRevealed && <span className={styles.hotspotLabel}>{line.translated}</span>}
          </button>
        );
      })}

      {dragRect && (
        <div
          className={styles.dragSelectRect}
          style={{ left: `${dragRect.left}%`, top: `${dragRect.top}%`, width: `${dragRect.width}%`, height: `${dragRect.height}%` }}
        />
      )}
    </div>
  );
}
