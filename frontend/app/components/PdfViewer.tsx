"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page, pdfjs } from "react-pdf";

type PdfViewerProps = {
  pdfId: string;
  onAspectRatioChange?: (ratio: number) => void;
};

const MIN_SCALE = 0.75;
const MAX_SCALE = 2;
const SCALE_STEP = 0.1;

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export default function PdfViewer({ pdfId, onAspectRatioChange }: PdfViewerProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const scrollAnchorRef = useRef<{ xRatio: number; yRatio: number } | null>(null);
  const shouldRestoreScrollRef = useRef(false);
  const lastAspectRatioRef = useRef<number | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [pageWidth, setPageWidth] = useState(700);
  const [loadError, setLoadError] = useState<string | null>(null);

  const pdfUrl = useMemo(() => `/pdf-proxy/${pdfId}`, [pdfId]);

  const captureScrollAnchor = useCallback(() => {
    const container = viewerRef.current;
    if (!container) return;
    const scrollWidth = Math.max(container.scrollWidth, 1);
    const scrollHeight = Math.max(container.scrollHeight, 1);
    scrollAnchorRef.current = {
      xRatio: (container.scrollLeft + container.clientWidth / 2) / scrollWidth,
      yRatio: (container.scrollTop + container.clientHeight / 2) / scrollHeight,
    };
  }, []);

  const scheduleScrollRestore = useCallback(() => {
    shouldRestoreScrollRef.current = true;
  }, []);

  const updateScale = useCallback(
    (direction: "in" | "out") => {
      captureScrollAnchor();
      scheduleScrollRestore();
      setScale((current) => {
        const delta = direction === "in" ? SCALE_STEP : -SCALE_STEP;
        return clamp(Number((current + delta).toFixed(2)), MIN_SCALE, MAX_SCALE);
      });
    },
    [captureScrollAnchor, scheduleScrollRestore],
  );

  useEffect(() => {
    setPageNumber(1);
    setNumPages(null);
    setLoadError(null);
    scrollAnchorRef.current = null;
    shouldRestoreScrollRef.current = false;
    lastAspectRatioRef.current = null;
  }, [pdfId]);

  useEffect(() => {
    const element = viewerRef.current;
    if (!element) return;

    const updateWidth = () => {
      const width = Math.floor(element.getBoundingClientRect().width);
      const nextWidth = Math.max(320, width - 24);
      setPageWidth((current) => {
        if (current === nextWidth) return current;
        captureScrollAnchor();
        scheduleScrollRestore();
        return nextWidth;
      });
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, [captureScrollAnchor, scheduleScrollRestore]);

  useLayoutEffect(() => {
    if (!shouldRestoreScrollRef.current) return;
    const container = viewerRef.current;
    const anchor = scrollAnchorRef.current;
    if (!container || !anchor) {
      shouldRestoreScrollRef.current = false;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const left = anchor.xRatio * container.scrollWidth - container.clientWidth / 2;
      const top = anchor.yRatio * container.scrollHeight - container.clientHeight / 2;
      container.scrollLeft = clamp(left, 0, maxLeft);
      container.scrollTop = clamp(top, 0, maxTop);
      shouldRestoreScrollRef.current = false;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pageNumber, pageWidth, scale]);

  const canGoPrev = pageNumber > 1;
  const canGoNext = !!numPages && pageNumber < numPages;
  const zoomLabel = `${Math.round(scale * 100)}%`;

  return (
    <div className="flex h-full min-h-0 flex-col bg-black/10">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-[11px] text-[var(--text-secondary)]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            disabled={!canGoPrev}
            className="rounded-md border border-white/20 px-2 py-1 text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() =>
              setPageNumber((current) =>
                numPages ? Math.min(numPages, current + 1) : current,
              )
            }
            disabled={!canGoNext}
            className="rounded-md border border-white/20 px-2 py-1 text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
          <span className="min-w-[90px] text-center font-medium">
            Page {pageNumber}
            {numPages ? ` / ${numPages}` : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updateScale("out")}
            className="rounded-md border border-white/20 px-2 py-1 text-white transition-colors hover:bg-white/10"
          >
            -
          </button>
          <span className="w-12 text-center font-medium">{zoomLabel}</span>
          <button
            type="button"
            onClick={() => updateScale("in")}
            className="rounded-md border border-white/20 px-2 py-1 text-white transition-colors hover:bg-white/10"
          >
            +
          </button>
        </div>
      </div>

      <div ref={viewerRef} className="min-h-0 flex-1 overflow-auto p-3">
        <Document
          file={pdfUrl}
          loading={
            <div className="flex min-h-[280px] items-center justify-center text-sm text-[var(--text-secondary)]">
              Loading PDF...
            </div>
          }
          onLoadSuccess={(documentProxy) => {
            const pages = documentProxy.numPages;
            setNumPages(pages);
            setPageNumber((current) => Math.min(current, pages));
            setLoadError(null);

            void documentProxy
              .getPage(1)
              .then((page) => {
                const viewport = page.getViewport({ scale: 1 });
                if (!viewport.width || !viewport.height) return;
                const aspectRatio = viewport.height / viewport.width;
                if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return;
                if (lastAspectRatioRef.current === aspectRatio) return;
                lastAspectRatioRef.current = aspectRatio;
                onAspectRatioChange?.(aspectRatio);
              })
              .catch((error) => {
                console.warn("Unable to read PDF aspect ratio:", error);
              });
          }}
          onLoadError={(error) => {
            console.error("Failed to load PDF:", error);
            setLoadError("Unable to load this PDF right now.");
          }}
          error={
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-center text-sm text-red-300">
              <p>{loadError ?? "Unable to render this PDF."}</p>
              <button
                type="button"
                onClick={() => {
                  setLoadError(null);
                  setNumPages(null);
                  setPageNumber(1);
                }}
                className="rounded-md border border-red-300/50 px-3 py-1.5 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/10"
              >
                Retry
              </button>
            </div>
          }
        >
          <div className="mx-auto w-fit rounded-xl bg-white/95 p-2 shadow-2xl">
            <Page
              pageNumber={pageNumber}
              width={pageWidth}
              scale={scale}
              renderAnnotationLayer={false}
              renderTextLayer={false}
            />
          </div>
        </Document>
      </div>
    </div>
  );
}
