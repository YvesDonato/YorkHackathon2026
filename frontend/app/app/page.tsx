/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import * as d3 from "d3";
import {
  createSession,
  listSessions,
  getSession,
  deleteSession as deleteSessionApi,
  expandSessionNode,
  FASTAPI_BASE_URL,
  type ApiGraphLink,
  type ApiGraphNode,
  type Session,
} from "@/lib/api";
import SummaryAudioPlayer from "@/app/components/SummaryAudioPlayer";

declare global {
  interface Window {
    d3?: any;
  }
}
import GraphErrorBoundary from "@/app/components/GraphErrorBoundary";

type GraphState = {
  nodes: ApiGraphNode[];
  links: ApiGraphLink[];
};

type ResizeHandle =
  | "move"
  | "left"
  | "right"
  | "bottom"
  | "corner-left"
  | "corner-right";
type PdfPanelSize = {
  width: number;
  height: number;
};
type PdfWindowPosition = {
  x: number;
  y: number;
};

const DEFAULT_SEED_LINK = "";
const DEFAULT_PDF_PANEL_SIZE: PdfPanelSize = { width: 560, height: 700 };
const DEFAULT_PDF_ASPECT_RATIO =
  DEFAULT_PDF_PANEL_SIZE.height / DEFAULT_PDF_PANEL_SIZE.width;
const MIN_PDF_PANEL_WIDTH = 320;
const MIN_PDF_PANEL_HEIGHT = 300;
const PDF_WINDOW_MARGIN = 8;
const TOUCH_LONG_PRESS_MS = 350;
const TOUCH_MOVE_CANCEL_PX = 10;
const RENDERER_MODE_STORAGE_KEY = "prismarine_renderer_mode";
const ENABLE_3D_EXPERIMENTAL =
  process.env.NEXT_PUBLIC_ENABLE_3D_EXPERIMENTAL === "true";

type RendererMode = "2d" | "3d";

const GraphRenderer3D = dynamic(
  () => import("@/app/components/GraphRenderer3D"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-white/50">
        Loading 3D Engine...
      </div>
    ),
  },
);

const PdfViewer = dynamic(
  () => import("@/app/components/PdfViewer"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-[var(--text-secondary)]">
        Loading PDF viewer...
      </div>
    ),
  },
);

const createEmptyGraphState = (): GraphState => ({ nodes: [], links: [] });

const toNodeId = (endpoint: string | { id: string }): string =>
  typeof endpoint === "string" ? endpoint : endpoint.id;

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export default function Home() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Auth & General State
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [viewport, setViewport] = useState({ width: 900, height: 560 });

  // Data State
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [seedInput, setSeedInput] = useState(DEFAULT_SEED_LINK);

  // Graph State
  const [graphState, setGraphState] = useState<GraphState>(
    createEmptyGraphState,
  );
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  // Interaction State
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNodeIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
  }, [selectedNodeId]);

  const [rootNodeId, setRootNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null); // For 3D
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null); // For 2D
  const [viewingPdfId, setViewingPdfId] = useState<string | null>(null);
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null);
  const [isMobileDetailsOpen, setIsMobileDetailsOpen] = useState(false);
  const [pdfPanelSize, setPdfPanelSize] = useState<PdfPanelSize>(
    DEFAULT_PDF_PANEL_SIZE,
  );
  const [pdfAspectRatio, setPdfAspectRatio] = useState(
    DEFAULT_PDF_ASPECT_RATIO,
  );
  const [pdfWindowPosition, setPdfWindowPosition] = useState<PdfWindowPosition>(
    { x: 24, y: 96 },
  );
  const [isPdfFullscreen, setIsPdfFullscreen] = useState(false);
  const [activeResizeHandle, setActiveResizeHandle] =
    useState<ResizeHandle | null>(null);
  const resizeStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    width: number;
    height: number;
    x: number;
    y: number;
  } | null>(null);
  const pdfHeaderTouchHoldTimerRef = useRef<number | null>(null);
  const pdfHeaderTouchStartRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);

  // Renderer State
  const [rendererMode, setRendererMode] = useState<RendererMode>("2d");
  const [rendererNotice, setRendererNotice] = useState<string | null>(null);
  const [rendererInstanceKey, setRendererInstanceKey] = useState(0);

  const selectedNode = useMemo(
    () => graphState.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graphState.nodes, selectedNodeId],
  );

  const hasOutgoingLinks = useCallback(
    (nodeId: string) => graphState.links.some((link) => link.source === nodeId),
    [graphState.links],
  );

  // Authentication Check
  useEffect(() => {
    const token = localStorage.getItem("access_token")?.trim();
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setIsAuthenticated(true);
    setIsAuthChecking(false);
  }, []);

  // Load Sessions
  const loadSessions = useCallback(async () => {
    try {
      const sessionList = await listSessions();
      setSessions(sessionList);
    } catch (error) {
      console.error("Failed to load sessions:", error);
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadSessions();
  }, [isAuthenticated, loadSessions]);

  // Viewport Resize
  useEffect(() => {
    if (!isAuthenticated) return;
    const element = containerRef.current;
    if (!element) return;

    const updateViewport = () => {
      const rect = element.getBoundingClientRect();
      setViewport({
        width: Math.max(320, Math.floor(rect.width)),
        height: Math.max(420, Math.floor(rect.height)),
      });
    };

    updateViewport();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateViewport);
      return () => window.removeEventListener("resize", updateViewport);
    }

    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isAuthenticated]);

  // 3D Mode Logic
  useEffect(() => {
    if (typeof window === "undefined") return;

    let nextMode: RendererMode = "2d";
    if (ENABLE_3D_EXPERIMENTAL) {
      const queryMode = new URLSearchParams(window.location.search).get(
        "renderer",
      );
      const savedMode = localStorage.getItem(RENDERER_MODE_STORAGE_KEY);
      if (queryMode === "3d" || savedMode === "3d") {
        nextMode = "3d";
      }
    }
    setRendererMode(nextMode);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (rendererMode === "3d" && !ENABLE_3D_EXPERIMENTAL) {
      setRendererMode("2d");
      return;
    }
    localStorage.setItem(RENDERER_MODE_STORAGE_KEY, rendererMode);
  }, [rendererMode]);

  const activeRenderer: RendererMode =
    rendererMode === "3d" && ENABLE_3D_EXPERIMENTAL ? "3d" : "2d";

  useEffect(() => {
    setRendererInstanceKey((previous) => previous + 1);
    setHoveredNodeId(null);
    setFocusedNodeId(null);
  }, [activeRenderer]);

  const handle3DRuntimeError = useCallback((error: Error) => {
    console.error("3D renderer failed, falling back to 2D:", error);
    setRendererNotice("3D renderer failed. Switched to 2D renderer.");
    setRendererMode("2d");
  }, []);

  const getPdfPanelBounds = useCallback(() => {
    const maxWidth = Math.max(
      MIN_PDF_PANEL_WIDTH,
      Math.min(1200, viewport.width - PDF_WINDOW_MARGIN * 2),
    );
    const maxHeight = Math.max(
      MIN_PDF_PANEL_HEIGHT,
      viewport.height - PDF_WINDOW_MARGIN * 2,
    );
    return { maxWidth, maxHeight };
  }, [viewport.height, viewport.width]);

  const clampPdfWindowPosition = useCallback(
    (x: number, y: number, width: number, height: number): PdfWindowPosition => {
      const maxX = Math.max(PDF_WINDOW_MARGIN, viewport.width - width - PDF_WINDOW_MARGIN);
      const maxY = Math.max(
        PDF_WINDOW_MARGIN,
        viewport.height - height - PDF_WINDOW_MARGIN,
      );
      return {
        x: clamp(x, PDF_WINDOW_MARGIN, maxX),
        y: clamp(y, PDF_WINDOW_MARGIN, maxY),
      };
    },
    [viewport.height, viewport.width],
  );

  useEffect(() => {
    const { maxWidth, maxHeight } = getPdfPanelBounds();
    setPdfPanelSize((current) => ({
      width: clamp(current.width, MIN_PDF_PANEL_WIDTH, maxWidth),
      height: clamp(current.height, MIN_PDF_PANEL_HEIGHT, maxHeight),
    }));
  }, [getPdfPanelBounds]);

  useEffect(() => {
    setPdfWindowPosition((current) =>
      clampPdfWindowPosition(
        current.x,
        current.y,
        pdfPanelSize.width,
        pdfPanelSize.height,
      ),
    );
  }, [
    clampPdfWindowPosition,
    pdfPanelSize.height,
    pdfPanelSize.width,
    viewport.height,
    viewport.width,
  ]);

  useEffect(() => {
    if (!viewingPdfId) {
      setIsPdfFullscreen(false);
      setActiveResizeHandle(null);
      resizeStartRef.current = null;
      return;
    }

    const centered = clampPdfWindowPosition(
      (viewport.width - pdfPanelSize.width) / 2,
      (viewport.height - pdfPanelSize.height) / 2,
      pdfPanelSize.width,
      pdfPanelSize.height,
    );
    setPdfWindowPosition(centered);
  }, [
    clampPdfWindowPosition,
    pdfPanelSize.height,
    pdfPanelSize.width,
    viewingPdfId,
    viewport.height,
    viewport.width,
  ]);

  useEffect(() => {
    if (!isPdfFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPdfFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPdfFullscreen]);

  const clearPdfHeaderTouchHold = useCallback(() => {
    if (pdfHeaderTouchHoldTimerRef.current !== null) {
      window.clearTimeout(pdfHeaderTouchHoldTimerRef.current);
      pdfHeaderTouchHoldTimerRef.current = null;
    }
    pdfHeaderTouchStartRef.current = null;
  }, []);

  useEffect(
    () => () => {
      clearPdfHeaderTouchHold();
    },
    [clearPdfHeaderTouchHold],
  );

  useEffect(() => {
    if (!activeResizeHandle) return;

    const cursor =
      activeResizeHandle === "move"
        ? "move"
        : activeResizeHandle === "right" || activeResizeHandle === "left"
          ? "ew-resize"
          : activeResizeHandle === "bottom"
            ? "ns-resize"
            : activeResizeHandle === "corner-right"
              ? "nwse-resize"
              : "nesw-resize";

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";

    const handleResizeDrag = (clientX: number, clientY: number) => {
      const start = resizeStartRef.current;
      if (!start) return;

      const deltaX = clientX - start.mouseX;
      const deltaY = clientY - start.mouseY;
      const { maxWidth, maxHeight } = getPdfPanelBounds();
      const ratio =
        Number.isFinite(pdfAspectRatio) && pdfAspectRatio > 0
          ? pdfAspectRatio
          : DEFAULT_PDF_ASPECT_RATIO;
      const minWidth = Math.max(MIN_PDF_PANEL_WIDTH, MIN_PDF_PANEL_HEIGHT / ratio);
      const rightEdge = start.x + start.width;
      const maxHeightFromTop = Math.min(
        maxHeight,
        viewport.height - start.y - PDF_WINDOW_MARGIN,
      );

      let nextX = start.x;
      let nextY = start.y;
      let nextWidth = start.width;
      let nextHeight = start.height;

      const clampWidthFromTopLeft = (
        desiredWidth: number,
        x: number,
      ): number => {
        const maxWidthFromLeft = Math.min(
          maxWidth,
          viewport.width - x - PDF_WINDOW_MARGIN,
        );
        const maxWidthFromHeight = maxHeightFromTop / ratio;
        const maxAllowedWidth = Math.max(
          Math.min(maxWidthFromLeft, maxWidthFromHeight),
          1,
        );
        const minAllowedWidth = Math.min(minWidth, maxAllowedWidth);
        return clamp(desiredWidth, minAllowedWidth, maxAllowedWidth);
      };

      switch (activeResizeHandle) {
        case "move": {
          nextX = start.x + deltaX;
          nextY = start.y + deltaY;
          break;
        }
        case "right":
        case "corner-right": {
          const widthDeltaForCorner =
            Math.abs(deltaY / ratio) > Math.abs(deltaX)
              ? deltaY / ratio
              : deltaX;
          const desiredWidth =
            activeResizeHandle === "corner-right"
              ? start.width + widthDeltaForCorner
              : start.width + deltaX;
          nextWidth = clampWidthFromTopLeft(desiredWidth, start.x);
          nextHeight = nextWidth * ratio;
          break;
        }
        case "left":
        case "corner-left": {
          const widthDeltaForCorner =
            Math.abs(deltaY / ratio) > Math.abs(deltaX)
              ? deltaY / ratio
              : -deltaX;
          const desiredWidth =
            activeResizeHandle === "corner-left"
              ? start.width + widthDeltaForCorner
              : start.width - deltaX;
          const maxWidthFromLeftEdge = Math.min(
            maxWidth,
            rightEdge - PDF_WINDOW_MARGIN,
          );
          const maxWidthFromHeight = maxHeightFromTop / ratio;
          const maxAllowedWidth = Math.max(
            Math.min(maxWidthFromLeftEdge, maxWidthFromHeight),
            1,
          );
          const minAllowedWidth = Math.min(minWidth, maxAllowedWidth);
          nextWidth = clamp(desiredWidth, minAllowedWidth, maxAllowedWidth);
          nextX = rightEdge - nextWidth;
          nextHeight = nextWidth * ratio;
          break;
        }
        case "bottom": {
          const desiredWidth = (start.height + deltaY) / ratio;
          nextWidth = clampWidthFromTopLeft(desiredWidth, start.x);
          nextHeight = nextWidth * ratio;
          break;
        }
      }

      const clampedPosition = clampPdfWindowPosition(
        nextX,
        nextY,
        nextWidth,
        nextHeight,
      );
      setPdfPanelSize({ width: nextWidth, height: nextHeight });
      setPdfWindowPosition(clampedPosition);
    };

    const endResizeDrag = () => {
      setActiveResizeHandle(null);
      resizeStartRef.current = null;
    };

    const onMouseMove = (event: MouseEvent) => {
      handleResizeDrag(event.clientX, event.clientY);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      handleResizeDrag(event.clientX, event.clientY);
    };
    const onMouseUp = () => {
      endResizeDrag();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      endResizeDrag();
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [
    activeResizeHandle,
    clampPdfWindowPosition,
    getPdfPanelBounds,
    pdfAspectRatio,
    viewport.height,
    viewport.width,
  ]);

  const startPdfResize = useCallback(
    (clientX: number, clientY: number, handle: ResizeHandle) => {
      resizeStartRef.current = {
        mouseX: clientX,
        mouseY: clientY,
        width: pdfPanelSize.width,
        height: pdfPanelSize.height,
        x: pdfWindowPosition.x,
        y: pdfWindowPosition.y,
      };
      setActiveResizeHandle(handle);
    },
    [
      pdfPanelSize.height,
      pdfPanelSize.width,
      pdfWindowPosition.x,
      pdfWindowPosition.y,
    ],
  );

  const handlePdfResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, handle: ResizeHandle) => {
      if (isPdfFullscreen) return;
      event.preventDefault();
      event.stopPropagation();
      startPdfResize(event.clientX, event.clientY, handle);
    },
    [isPdfFullscreen, startPdfResize],
  );

  const handlePdfHeaderMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("a,button")) return;
      handlePdfResizeMouseDown(event, "move");
    },
    [handlePdfResizeMouseDown],
  );

  const handlePdfHeaderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch" || isPdfFullscreen) return;

      const target = event.target as HTMLElement;
      if (target.closest("a,button")) return;

      clearPdfHeaderTouchHold();
      pdfHeaderTouchStartRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);

      pdfHeaderTouchHoldTimerRef.current = window.setTimeout(() => {
        const start = pdfHeaderTouchStartRef.current;
        if (!start) return;
        startPdfResize(start.x, start.y, "move");
        clearPdfHeaderTouchHold();
      }, TOUCH_LONG_PRESS_MS);
    },
    [clearPdfHeaderTouchHold, isPdfFullscreen, startPdfResize],
  );

  const handlePdfHeaderPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch" || activeResizeHandle === "move") return;
      const touchStart = pdfHeaderTouchStartRef.current;
      if (!touchStart || touchStart.pointerId !== event.pointerId) return;

      const movedDistance = Math.hypot(
        event.clientX - touchStart.x,
        event.clientY - touchStart.y,
      );
      if (movedDistance > TOUCH_MOVE_CANCEL_PX) {
        clearPdfHeaderTouchHold();
      }
    },
    [activeResizeHandle, clearPdfHeaderTouchHold],
  );

  const handlePdfHeaderPointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "touch") return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      clearPdfHeaderTouchHold();
    },
    [clearPdfHeaderTouchHold],
  );

  const handleClosePdfViewer = useCallback(() => {
    setViewingPdfId(null);
    setIsPdfFullscreen(false);
    setActiveResizeHandle(null);
    setPdfAspectRatio(DEFAULT_PDF_ASPECT_RATIO);
    resizeStartRef.current = null;
    clearPdfHeaderTouchHold();
  }, [clearPdfHeaderTouchHold]);

  const handlePdfAspectRatioChange = useCallback((ratio: number) => {
    if (!Number.isFinite(ratio) || ratio <= 0) return;
    setPdfAspectRatio(ratio);
  }, []);

  // Graph Operations
  const loadSessionGraph = useCallback(async (sessionId: string) => {
    setIsLoadingGraph(true);
    setGraphError(null);

    try {
      const response = await getSession(sessionId);
      setGraphState({ nodes: response.nodes, links: response.links });
      setSelectedNodeId(response.seed_id);
      setRootNodeId(response.seed_id);
      setCurrentSessionId(sessionId);

      // Update session title with seed paper's title if not already set
      const currentSession = sessions.find(s => s.id === sessionId);
      if (currentSession && !currentSession.title) {
        const seedNode = response.nodes.find(n => n.id === response.seed_id);
        if (seedNode?.label) {
          try {
            await fetch(`${FASTAPI_BASE_URL}/sessions/${sessionId}`, {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${localStorage.getItem("access_token")}`
              },
              body: JSON.stringify({ title: seedNode.label })
            });
            await loadSessions();
          } catch (err) {
            console.error("Failed to update session title:", err);
          }
        }
      }
    } catch (error) {
      setGraphError(formatError(error));
      setGraphState(createEmptyGraphState());
      setSelectedNodeId(null);
    } finally {
      setIsLoadingGraph(false);
    }
  }, [sessions, loadSessions]);

  const createNewSession = useCallback(
    async (seedLink: string) => {
      const normalizedSeed = seedLink.trim();
      if (!normalizedSeed) {
        setGraphError("Enter an arXiv URL or ID.");
        setGraphState(createEmptyGraphState());
        setSelectedNodeId(null);
        setIsLoadingGraph(false);
        return;
      }

      setIsLoadingGraph(true);
      setGraphError(null);

      try {
        const session = await createSession({
          seed_paper_link: normalizedSeed,
          mode: "grounding",
        });
        await loadSessions();
        await loadSessionGraph(session.id);
      } catch (error) {
        setGraphError(formatError(error));
        setGraphState(createEmptyGraphState());
        setSelectedNodeId(null);
        setIsLoadingGraph(false);
      }
    },
    [loadSessions, loadSessionGraph],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await deleteSessionApi(sessionId);
        await loadSessions();
        if (currentSessionId === sessionId) {
          setGraphState(createEmptyGraphState());
          setSelectedNodeId(null);
          setCurrentSessionId(null);
        }
      } catch (error) {
        console.error("Failed to delete session:", error);
      }
    },
    [currentSessionId, loadSessions],
  );

  // Auto-load first session
  useEffect(() => {
    if (!isAuthenticated || isLoadingSessions) return;
    if (currentSessionId) return; // Already have a session loaded
    if (sessions.length > 0) {
      void loadSessionGraph(sessions[0].id);
    }
  }, [isAuthenticated, isLoadingSessions, sessions, currentSessionId, loadSessionGraph]);

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setViewingPdfId(null);
    setIsMobileDetailsOpen(!!nodeId);
  }, []);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setViewingPdfId(null);
    setIsMobileDetailsOpen(true);
  }, []);

  useEffect(() => {
    if (!selectedNodeId) {
      setIsMobileDetailsOpen(false);
    }
  }, [selectedNodeId]);

  useEffect(() => {
    if (viewingPdfId) {
      setIsMobileDetailsOpen(false);
    }
  }, [viewingPdfId]);

  const closeMobileDetailsPopup = useCallback(() => {
    setIsMobileDetailsOpen(false);
  }, []);

  const handleExpandNode = useCallback(
    (nodeId: string) => {
      if (!currentSessionId || expandingNodeId) return;

      setExpandingNodeId(nodeId);
      expandSessionNode(currentSessionId, nodeId)
        .then((response) => {
          setGraphState({ nodes: response.nodes, links: response.links });
        })
        .catch((error) => {
          console.error("Failed to expand node:", error);
          setGraphError(`Failed to expand node: ${formatError(error)}`);
        })
        .finally(() => {
          setExpandingNodeId(null);
        });
    },
    [currentSessionId, expandingNodeId],
  );

  const handleNodeMouseDown = useCallback((nodeId: string) => {
    setFocusedNodeId(nodeId);
  }, []);

  const handleNodeMouseUp = useCallback(() => {
    setFocusedNodeId(null);
  }, []);

  const handleSeedSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void createNewSession(seedInput);
    },
    [createNewSession, seedInput],
  );

  // ── D3 2D Graph Rendering ──
  useEffect(() => {
    if (activeRenderer !== "2d") return;
    if (!isAuthenticated) return;
    if (!svgRef.current) return;

    const simulationNodes = graphState.nodes.map((node) => ({ ...node }));
    const simulationLinks = graphState.links.map((link) => ({ ...link }));

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
    svg.attr("preserveAspectRatio", "xMidYMid meet");

    if (simulationNodes.length === 0) return;

    svg
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", viewport.width)
      .attr("height", viewport.height)
      .attr("fill", "transparent")
      .on("click", () => setSelectedNodeId(null));

    const zoomContainer = svg.append("g").attr("class", "zoom-container");

    const guideCx = viewport.width / 2;
    const guideCy = viewport.height / 2;
    const guideMaxR = Math.min(viewport.width, viewport.height) * 0.4;
    const ringCount = 4;
    for (let i = 1; i <= ringCount; i++) {
      const r = (guideMaxR / ringCount) * i;
      zoomContainer
        .append("circle")
        .attr("cx", guideCx)
        .attr("cy", guideCy)
        .attr("r", r)
        .attr("fill", "none")
        .attr("stroke", "rgba(168, 85, 247, 0.08)")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,6");
    }

    const zoom = d3
      .zoom()
      .scaleExtent([0.1, 4])
      .on("zoom", (event: any) => {
        zoomContainer.attr("transform", event.transform);
      });

    svg.call(zoom as any);

    const linkSelection = zoomContainer
      .append("g")
      .attr("stroke", "#9ca3af")
      .attr("stroke-opacity", 0.6)
      .selectAll<SVGLineElement, ApiGraphLink>("line")
      .data(
        simulationLinks as ApiGraphLink[],
        (link: ApiGraphLink) =>
          `${toNodeId(link.source)}->${toNodeId(link.target)}`,
      )
      .join("line")
      .attr("stroke-width", 2);

    const rootId =
      rootNodeId ??
      graphState.nodes.find((n) => n.is_root)?.id ??
      simulationNodes[0]?.id;

    const nodeSelection = zoomContainer
      .append("g")
      .selectAll<SVGGElement, ApiGraphNode>("g")
      .data(simulationNodes as ApiGraphNode[], (node: ApiGraphNode) => node.id)
      .join("g")
      .attr("class", "graph-node cursor-pointer select-none");

    nodeSelection
      .append("circle")
      .attr("class", "node-circle")
      .attr("r", 36)
      .attr("fill", (node: ApiGraphNode) => {
        if (node.id === expandingNodeId) return "#f59e0b";
        if (node.id === selectedNodeId) return "#f472b6"; // Selected
        if (node.id === rootId) return "#d8b4fe"; // Light purple
        return "#a855f7"; // Match 3D default for all other nodes (including leaves)
      })
      .style("filter", (node: ApiGraphNode) => {
        if (node.id === expandingNodeId)
          return "drop-shadow(0 0 14px rgba(245, 158, 11, 0.7))";
        if (node.id === rootId)
          return "drop-shadow(0 0 12px rgba(216, 180, 254, 0.6))"; // Light purple shadow
        return hasOutgoingLinks(node.id)
          ? "drop-shadow(0 0 8px rgba(168, 85, 247, 0.5))"
          : "none";
      });

    nodeSelection
      .append("circle")
      .attr("class", "selection-ring")
      .attr("r", 40)
      .attr("fill", "none")
      .attr("stroke", (node: ApiGraphNode) =>
        node.id === selectedNodeId ? "#f472b6" : "none",
      )
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.9)
      .style("filter", (node: ApiGraphNode) =>
        node.id === selectedNodeId
          ? "drop-shadow(0 0 8px rgba(244, 114, 182, 0.7))"
          : "none",
      );

    nodeSelection
      .append("text")
      .attr("fill", "#f5f5f5")
      .attr("font-size", 9)
      .attr("font-weight", 600)
      .attr("text-anchor", "middle")
      .attr("pointer-events", "none")
      .each(function (this: SVGTextElement, node: ApiGraphNode) {
        const text = d3.select(this);
        const words = node.label.split(/\s+/);
        const maxCharsPerLine = 15;
        const lines: string[] = [];
        let currentLine = "";

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          if (testLine.length <= maxCharsPerLine) {
            currentLine = testLine;
          } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          }
        }
        if (currentLine && lines.length < 2) lines.push(currentLine);

        if (
          lines.length > 2 ||
          (lines.length === 2 && currentLine && currentLine !== lines[1])
        ) {
          lines[1] = lines[1].slice(0, 9) + "...";
        }

        lines.slice(0, 2).forEach((line, i) => {
          text
            .append("tspan")
            .attr("x", 0)
            .attr("dy", i === 0 ? "0.1em" : "1.2em")
            .text(line);
        });
      });

    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    const maxRadius = Math.min(viewport.width, viewport.height) * 0.4;

    const bestSimilarity = new Map<string, number>();
    for (const link of graphState.links) {
      const s = toNodeId(link.source);
      const t = toNodeId(link.target);
      const sim = (link as any).similarity ?? 0;
      if (s === rootId)
        bestSimilarity.set(t, Math.max(bestSimilarity.get(t) ?? 0, sim));
      if (t === rootId)
        bestSimilarity.set(s, Math.max(bestSimilarity.get(s) ?? 0, sim));
    }

    for (const link of graphState.links) {
      const s = toNodeId(link.source);
      const t = toNodeId(link.target);
      const sim = (link as any).similarity ?? 0;
      if (bestSimilarity.has(s) && !bestSimilarity.has(t) && t !== rootId) {
        bestSimilarity.set(t, bestSimilarity.get(s)! * sim);
      }
      if (bestSimilarity.has(t) && !bestSimilarity.has(s) && s !== rootId) {
        bestSimilarity.set(s, bestSimilarity.get(t)! * sim);
      }
    }

    const rootSimNode = simulationNodes.find((n) => n.id === rootId);
    if (rootSimNode) {
      (rootSimNode as any).fx = cx;
      (rootSimNode as any).fy = cy;
    }

    const allSims = Array.from(bestSimilarity.values());
    const minSim = allSims.length > 0 ? Math.min(...allSims) : 0;
    const maxSim = allSims.length > 0 ? Math.max(...allSims) : 1;
    const simRange = maxSim - minSim || 1;

    const nodeRadius = (node: any): number => {
      if (node.id === rootId) return 0;
      const sim = bestSimilarity.get(node.id) ?? 0;
      const normalized = (sim - minSim) / simRange;
      return maxRadius * (1 - normalized * 0.85);
    };

    const simulation = d3
      .forceSimulation(simulationNodes as any)
      .force(
        "link",
        d3
          .forceLink(simulationLinks as any)
          .id((node: any) => node.id)
          .distance((link: any) => {
            const sim = link.similarity ?? 0;
            const normalized = (sim - minSim) / simRange;
            return maxRadius * (1 - normalized * 0.85);
          })
          .strength(0.3),
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force(
        "radial",
        d3
          .forceRadial((node: any) => nodeRadius(node), cx, cy)
          .strength((node: any) => (node.id === rootId ? 1 : 1.2)),
      )
      .force("collision", d3.forceCollide().radius(60));

    let tooltip = d3.select("body").select(".graph-tooltip") as any;
    if (tooltip.empty()) {
      tooltip = d3
        .select("body")
        .append("div")
        .attr("class", "graph-tooltip")
        .style("position", "fixed")
        .style("visibility", "hidden")
        .style("background", "rgba(26, 26, 26, 0.95)")
        .style("color", "#f5f5f5")
        .style("padding", "12px 16px")
        .style("border-radius", "12px")
        .style("border", "1px solid rgba(168, 85, 247, 0.3)")
        .style("font-size", "13px")
        .style("font-weight", "500")
        .style("max-width", "300px")
        .style("box-shadow", "0 10px 15px -3px rgba(0, 0, 0, 0.5)")
        .style("pointer-events", "none")
        .style("z-index", "9999")
        .style("backdrop-filter", "blur(6px)")
        .style("transition", "opacity 0.8s ease");
    }

    const getTooltipHtml = (node: ApiGraphNode): string => {
      const sim = bestSimilarity.get(node.id);
      const simText =
        sim != null
          ? `<div style="color: #94a3b8; font-size: 11px; margin-top: 4px;">Similarity: ${(sim * 100).toFixed(0)}%</div>`
          : "";
      return `<div style="font-weight: 600; color: #c084fc; margin-bottom: 4px;">${node.id}</div><div>${node.label}</div>${simText}`;
    };

    const showTooltipForNode = (
      node: ApiGraphNode,
      clientX: number,
      clientY: number,
    ) => {
      tooltip
        .style("visibility", "visible")
        .html(getTooltipHtml(node))
        .style("left", clientX + 15 + "px")
        .style("top", clientY + 15 + "px");
    };

    let touchLongPressTimer: number | null = null;
    let touchPressedNode: ApiGraphNode | null = null;
    let touchPointerId: number | null = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let suppressNextTouchClickNodeId: string | null = null;

    const clearTouchLongPressTimer = () => {
      if (touchLongPressTimer !== null) {
        window.clearTimeout(touchLongPressTimer);
        touchLongPressTimer = null;
      }
    };

    const resetTouchLongPressState = () => {
      clearTouchLongPressTimer();
      touchPressedNode = null;
      touchPointerId = null;
    };

    nodeSelection.on("click", (event: MouseEvent, node: ApiGraphNode) => {
      event.stopPropagation();
      if (suppressNextTouchClickNodeId === node.id) {
        suppressNextTouchClickNodeId = null;
        return;
      }
      handleNodeClick(node.id);
    });

    const dragBehavior = d3
      .drag()
      .on("start", (event: any, node: any) => {
        if (!event.active) simulation.alphaTarget(0.25).restart();
        node.fx = node.x;
        node.fy = node.y;
        handleNodeMouseDown(node.id);
      })
      .on("drag", (event: any, node: any) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on("end", (event: any, node: any) => {
        if (!event.active) simulation.alphaTarget(0);
        if (node.id === rootId) {
          node.fx = cx;
          node.fy = cy;
        } else {
          node.fx = null;
          node.fy = null;
        }
        handleNodeMouseUp();
      });
    nodeSelection
      .call(dragBehavior as any)
      .on("mouseenter", function (event: MouseEvent, node: ApiGraphNode) {
        if (focusedNodeId) return;

        // Hover effect: Lighten color to match 3D highlight (#c084fc)
        d3.select(this).select("circle.node-circle").attr("fill", "#c084fc");

        const sim = bestSimilarity.get(node.id);
        const simText =
          sim != null
            ? `<div style="color: #94a3b8; font-size: 11px; margin-top: 4px;">Similarity: ${(sim * 100).toFixed(0)}%</div>`
            : "";
        tooltip
          .style("visibility", "visible")
          .html(
            `<div style="font-weight: 600; color: #c084fc; margin-bottom: 4px;">${node.id}</div><div>${node.label}</div>${simText}`,
          );
      })
      .on("mousemove", function (event: MouseEvent) {
        if (focusedNodeId) return;
        tooltip
          .style("left", event.clientX + 15 + "px")
          .style("top", event.clientY + 15 + "px");
      })
      .on("mouseleave", function (event: MouseEvent, node: ApiGraphNode) {
        if (focusedNodeId) return;

        // Restore original color
        d3.select(this).select("circle.node-circle").attr("fill", (n: any) => {
          if (n.id === expandingNodeId) return "#f59e0b";
          if (n.id === selectedNodeIdRef.current) return "#f472b6";
          if (n.id === rootId) return "#d8b4fe";
          return "#a855f7";
        });

        handleNodeMouseUp();
        resetTouchLongPressState();
        tooltip.style("visibility", "hidden");
      })
      .on("pointerdown", function (event: PointerEvent, node: ApiGraphNode) {
        if (event.pointerType !== "touch") return;
        resetTouchLongPressState();
        touchPressedNode = node;
        touchPointerId = event.pointerId;
        touchStartX = event.clientX;
        touchStartY = event.clientY;

        touchLongPressTimer = window.setTimeout(() => {
          if (!touchPressedNode) return;
          showTooltipForNode(touchPressedNode, touchStartX, touchStartY);
          suppressNextTouchClickNodeId = touchPressedNode.id;
          touchLongPressTimer = null;
        }, TOUCH_LONG_PRESS_MS);
      })
      .on("pointermove", function (event: PointerEvent) {
        if (event.pointerType !== "touch") return;
        if (touchPointerId !== event.pointerId) return;

        if (touchLongPressTimer !== null) {
          const movedDistance = Math.hypot(
            event.clientX - touchStartX,
            event.clientY - touchStartY,
          );
          if (movedDistance > TOUCH_MOVE_CANCEL_PX) {
            resetTouchLongPressState();
          }
          return;
        }

        if (touchPressedNode) {
          tooltip
            .style("left", event.clientX + 15 + "px")
            .style("top", event.clientY + 15 + "px");
        }
      })
      .on("pointerup", function (event: PointerEvent) {
        if (event.pointerType !== "touch") return;
        if (touchPointerId !== event.pointerId) return;
        resetTouchLongPressState();
        tooltip.style("visibility", "hidden");
      })
      .on("pointercancel", function (event: PointerEvent) {
        if (event.pointerType !== "touch") return;
        if (touchPointerId !== event.pointerId) return;
        resetTouchLongPressState();
        tooltip.style("visibility", "hidden");
      })
      .on("pointerleave", function (event: PointerEvent) {
        if (event.pointerType !== "touch") return;
        if (touchPointerId !== event.pointerId) return;
        resetTouchLongPressState();
        tooltip.style("visibility", "hidden");
      });

    simulation.on("tick", () => {
      linkSelection
        .attr("x1", (link: any) => link.source.x ?? 0)
        .attr("y1", (link: any) => link.source.y ?? 0)
        .attr("x2", (link: any) => link.target.x ?? 0)
        .attr("y2", (link: any) => link.target.y ?? 0);

      nodeSelection.attr(
        "transform",
        (node: any) => `translate(${node.x ?? 0},${node.y ?? 0})`,
      );
    });

    simulation.alpha(0.9).restart();

    return () => {
      simulation.stop();
      clearTouchLongPressTimer();
      d3.select("body").select(".graph-tooltip").remove();
    };
  }, [
    activeRenderer,
    graphState.links,
    graphState.nodes,
    handleNodeClick,
    hasOutgoingLinks,
    isAuthenticated,
    rootNodeId,
    expandingNodeId,
    viewport.height,
    viewport.width,
  ]);

  // Separate effect for 2D selection/focus changes without re-rendering entire graph
  useEffect(() => {
    if (activeRenderer !== "2d") return;
    if (!isAuthenticated) return;
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const isFocusActive = !!focusedNodeId;

    const isLinkConnectedToSelected = (link: any) => {
      if (!selectedNodeId) return false;
      const s = toNodeId(link.source);
      const t = toNodeId(link.target);
      return s === selectedNodeId || t === selectedNodeId;
    };

    const isConnected = (nodeId: string) => {
      if (!isFocusActive || !focusedNodeId) return false;
      if (nodeId === focusedNodeId) return true;
      return graphState.links.some((link) => {
        const s = toNodeId(link.source);
        const t = toNodeId(link.target);
        return (
          (s === focusedNodeId && t === nodeId) ||
          (t === focusedNodeId && s === nodeId)
        );
      });
    };

    const rootId =
      rootNodeId ??
      graphState.nodes.find((n) => n.is_root)?.id ??
      graphState.nodes[0]?.id;

    const nodeParams = svg
      .selectAll("g.graph-node")
      .transition()
      .duration(300);

    // Opacity update
    nodeParams
      .style("opacity", (node: any) => {
        if (!isFocusActive) return 1;
        return isConnected(node.id) ? 1 : 0.1;
      });

    // Selection Ring update
    nodeParams
      .select("circle.selection-ring")
      .attr("stroke", (node: any) =>
        node.id === selectedNodeId ? "#f472b6" : "none",
      )
      .attr("stroke-width", 2)
      .style("filter", (node: any) =>
        node.id === selectedNodeId
          ? "drop-shadow(0 0 8px rgba(244, 114, 182, 0.7))"
          : "none",
      );

    // Node Circle Fill update
    nodeParams
      .select("circle.node-circle")
      .attr("fill", (node: any) => {
        if (node.id === expandingNodeId) return "#f59e0b";
        if (node.id === selectedNodeId) return "#f472b6";
        if (node.id === rootId) return "#d8b4fe";
        return "#a855f7";
      });

    svg
      .selectAll("g.zoom-container line")
      .transition()
      .duration(300)
      .style("opacity", (link: any) => {
        if (isFocusActive) {
          const s = toNodeId(link.source);
          const t = toNodeId(link.target);
          return s === focusedNodeId || t === focusedNodeId ? 1 : 0.1;
        }
        if (selectedNodeId && isLinkConnectedToSelected(link as any)) return 1;
        if (selectedNodeId) return 0.15;
        return 0.6;
      })
      .attr("stroke", (link: any) => {
        if (isFocusActive) {
          const s = toNodeId(link.source);
          const t = toNodeId(link.target);
          return s === focusedNodeId || t === focusedNodeId
            ? "#a855f7"
            : "#9ca3af";
        }
        if (selectedNodeId && isLinkConnectedToSelected(link as any)) return "#a855f7";
        return "#9ca3af";
      })
      .attr("stroke-width", (link: any) => {
        if (isFocusActive) {
          const s = toNodeId(link.source);
          const t = toNodeId(link.target);
          return s === focusedNodeId || t === focusedNodeId ? 3 : 1;
        }
        if (selectedNodeId && isLinkConnectedToSelected(link as any)) return 3;
        return 2;
      });

    if (isFocusActive) {
      d3.select("body").select(".graph-tooltip").style("visibility", "hidden");
    }
  }, [
    activeRenderer,
    selectedNodeId,
    focusedNodeId,
    isAuthenticated,
    hasOutgoingLinks,
    graphState.links,
  ]);

  if (isAuthChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <p className="text-sm text-[var(--text-secondary)]">
          Checking session...
        </p>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const paperDetailsBody = selectedNode ? (
    <div key={selectedNode.id} className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="badge badge-secondary font-mono text-[10px] px-2 py-0.5">
          {selectedNode.id}
        </span>
        <a
          href={`https://arxiv.org/abs/${selectedNode.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-medium text-[var(--accent-primary)] hover:text-[#f472b6] flex items-center gap-1 transition-colors"
        >
          View on arXiv
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
        </a>
      </div>

      <div>
        <h3 className="text-sm font-bold text-[var(--text-primary)] leading-snug mb-2">
          {selectedNode.label}
        </h3>

        <div className="text-xs text-[var(--text-secondary)] leading-relaxed max-h-40 overflow-y-auto pr-2 custom-scrollbar">
          {selectedNode.content ? (
            <p>{selectedNode.content}</p>
          ) : (
            <p className="italic text-[var(--text-tertiary)]">
              No abstract available.
            </p>
          )}
        </div>
      </div>

      <div className="pt-3 border-t border-[var(--border-secondary)] space-y-2">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-[var(--text-tertiary)]">Connections</span>
          <span className="font-medium text-[var(--text-secondary)]">
            {hasOutgoingLinks(selectedNode.id) ? "Has Citations" : "Leaf Node"}
          </span>
        </div>
      </div>

      <div className="mt-2 space-y-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            onClick={() => setViewingPdfId(selectedNode.id)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--accent-primary)]/40 bg-[var(--accent-primary)]/15 px-3 py-2 text-xs font-semibold text-[var(--accent-primary)] transition-all duration-300 hover:bg-[var(--accent-primary)]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]/50"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            View Paper
          </button>

          {currentSessionId && (
            <button
              onClick={() => handleExpandNode(selectedNode.id)}
              disabled={expandingNodeId === selectedNode.id}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-300 transition-all duration-300 hover:bg-amber-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {expandingNodeId === selectedNode.id ? (
                <>
                  <svg
                    className="animate-spin w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Expanding...
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  Expand
                </>
              )}
            </button>
          )}
        </div>
        <div className="rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)]/45 p-3">
          <SummaryAudioPlayer
            summary={selectedNode.content ?? ""}
            variant="dark"
          />
        </div>
      </div>
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
      <div className="w-12 h-12 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
        <svg
          className="w-6 h-6 text-[var(--text-tertiary)] opacity-50"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"
          />
        </svg>
      </div>
      <div>
        <p className="text-xs font-medium text-[var(--text-secondary)]">
          No paper selected
        </p>
        <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
          Click a node to view details
        </p>
      </div>
    </div>
  );

  const rendererToggleButtons = (
    <>
      <button
        type="button"
        onClick={() => {
          setRendererNotice(null);
          setRendererMode("2d");
        }}
        className={`flex h-8 items-center rounded-md px-3 text-[11px] font-semibold transition-colors ${activeRenderer === "2d"
          ? "bg-[var(--accent-primary)]/20 text-white"
          : "text-[var(--text-secondary)] hover:bg-white/10"
          }`}
      >
        2D
      </button>
      {ENABLE_3D_EXPERIMENTAL && (
        <button
          type="button"
          onClick={() => {
            setRendererNotice(null);
            setRendererMode("3d");
          }}
          className={`flex h-8 items-center rounded-md px-3 text-[11px] font-semibold transition-colors ${activeRenderer === "3d"
            ? "bg-[var(--accent-primary)]/20 text-white"
            : "text-[var(--text-secondary)] hover:bg-white/10"
            }`}
        >
          3D (Experimental)
        </button>
      )}
    </>
  );

  return (
    <>
      {/* GRAPH LAYER (Fixed Background) */}
      <div
        ref={containerRef}
        className="fixed inset-0 z-0 bg-gradient-to-br from-[#0a0a0a] to-[#1a1a1a]"
      >
        {activeRenderer === "3d" ? (
          viewport.width > 0 && (
            <GraphErrorBoundary onError={handle3DRuntimeError}>
              <GraphRenderer3D
                key={`3d-${rendererInstanceKey}`}
                width={viewport.width}
                height={viewport.height}
                graphState={graphState}
                rootNodeId={rootNodeId}
                selectedNodeId={selectedNodeId}
                hoveredNodeId={hoveredNodeId}
                onHoverNodeIdChange={setHoveredNodeId}
                onSelectNodeId={handleNodeSelect}
                onRuntimeError={handle3DRuntimeError}
              />
            </GraphErrorBoundary>
          )
        ) : (
          <svg
            ref={svgRef}
            className="h-full w-full"
            role="img"
            aria-label="Interactive force graph of arXiv papers"
          />
        )}

        {isLoadingGraph && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50">
            <div className="flex flex-col items-center gap-3">
              <svg
                className="animate-spin w-8 h-8 text-[var(--accent-primary)]"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                Loading graph engine...
              </p>
            </div>
          </div>
        )}

        {!isLoadingGraph && graphState.nodes.length === 0 && !graphError && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-3 text-center bg-black/40 backdrop-blur-md p-6 rounded-2xl border border-white/10">
              <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-[var(--text-tertiary)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                No citation data found
              </p>
            </div>
          </div>
        )}
      </div>

      {/* UI LAYER (Floating Overlays) */}
      <div className="fixed inset-0 z-10 pointer-events-none flex flex-col gap-3 overflow-y-auto overscroll-contain p-3 pb-6 sm:gap-4 sm:p-6 lg:overflow-visible lg:p-8">
        {/* TOP ROW */}
        <div className="flex flex-wrap items-start justify-between gap-6 lg:grid lg:grid-cols-[max-content_minmax(0,1fr)_20rem] lg:items-start lg:justify-normal">
          {/* LEFT: Branding & Sessions */}
          <div className="pointer-events-auto order-2 flex w-full max-w-none flex-col gap-4 lg:order-none lg:col-start-1 lg:w-fit lg:max-w-none">
            {/* Logo */}
            <a href="/" className="hidden lg:flex lg:h-14 lg:w-72 glass-card items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 shadow-2xl backdrop-blur-xl sm:px-5">
              <div className="relative h-8 w-8 overflow-hidden rounded-lg bg-gradient-to-br from-[#a855f7]/20 to-[#ec4899]/20 shadow-lg ring-1 ring-white/20">
                <Image
                  src="/prismarinelogo.png"
                  alt="Prismarine logo"
                  fill
                  sizes="32px"
                  className="object-contain p-0.5"
                  priority
                />
              </div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
                Prismarine
              </h1>
            </a>

            {/* Sessions List */}
            <aside className="glass-card w-full rounded-2xl border border-white/10 bg-[#0a0a0a]/80 p-3 shadow-2xl backdrop-blur-xl sm:p-4 lg:w-72">
              <div className="flex items-center gap-2 mb-3 px-1">
                <svg
                  className="w-4 h-4 text-[var(--accent-primary)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
                <h2 className="text-sm font-bold text-[var(--text-primary)]">
                  Sessions
                </h2>
              </div>

              {isLoadingSessions ? (
                <div className="flex items-center justify-center py-4">
                  <svg
                    className="animate-spin w-5 h-5 text-[var(--accent-primary)]"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-xs text-[var(--text-tertiary)]">
                    No sessions yet
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`p-2.5 rounded-lg border transition-all cursor-pointer hover:border-[var(--accent-primary)] ${currentSessionId === session.id
                        ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10"
                        : "border-transparent hover:bg-white/5"
                        }`}
                      onClick={() => void loadSessionGraph(session.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                            {session.title || session.id.slice(0, 8)}
                          </p>
                          <p className="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5">
                            {new Date(
                              session.last_accessed,
                            ).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteSession(session.id);
                          }}
                          className="flex-shrink-0 p-1 cursor-pointer hover:bg-red-500/20 rounded text-red-400/60 hover:text-red-400 transition-colors"
                        >
                          <svg
                            className="w-3 h-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>

          {/* CENTER: Search Bar */}
          <div className="pointer-events-auto order-1 w-full max-w-none lg:order-none lg:col-start-2 lg:min-w-0 lg:max-w-none">
            <form
              className="glass-card min-h-14 h-auto flex flex-wrap items-start gap-2 rounded-xl border border-white/10 p-2 shadow-2xl backdrop-blur-xl transition-colors focus-within:border-[var(--accent-primary)] sm:h-14 sm:flex-nowrap sm:items-center sm:p-1.5 sm:pl-4"
              onSubmit={handleSeedSubmit}
            >
              <svg
                className="w-5 h-5 text-[var(--text-tertiary)] flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <input
                type="text"
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
                placeholder="Search by arXiv or PMC URL or ID (e.g., 1706.03762)"
                className="bg-transparent border-none text-sm text-white placeholder-white/30 focus:ring-0 min-w-0 flex-1 basis-40 p-0"
              />
              <button
                type="submit"
                disabled={isLoadingGraph}
                className="w-full rounded-lg bg-white/10 px-4 py-2 text-xs cursor-pointer font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-50 sm:w-auto"
              >
                {isLoadingGraph ? "Loading..." : "Load Graph"}
              </button>
            </form>

            {graphError && (
              <div className="mt-4 glass-card p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-xs flex items-center gap-2 animate-slide-down shadow-xl">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                {graphError}
              </div>
            )}
          </div>

          {/* RIGHT: Stats & Details / PDF Viewer / 3D Toggle */}
          <div className="pointer-events-auto order-3 flex w-full flex-col items-end gap-4 lg:order-none lg:col-start-3 lg:w-full">
            {rendererNotice && (
              <div className="glass-card px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-[11px] font-medium">
                {rendererNotice}
              </div>
            )}
            {false ? (
              /* ── PDF / HTML Viewer Panel ── */
              <aside
                className="glass-card relative rounded-2xl border border-white/10 shadow-2xl h-auto backdrop-blur-xl bg-[#0a0a0a]/90 animate-slide-up flex flex-col overflow-hidden"
                style={{
                  width: `${pdfPanelSize.width}px`,
                  height: `${pdfPanelSize.height}px`,
                }}
              >
                {/* Viewer Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg
                      className="w-4 h-4 text-[var(--accent-primary)] flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                      />
                    </svg>
                    <span className="text-sm font-bold text-[var(--text-primary)] truncate">
                      {graphState.nodes.find((n) => n.id === viewingPdfId)
                        ?.label ?? viewingPdfId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={`https://arxiv.org/pdf/${viewingPdfId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] flex items-center gap-1 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                      Open PDF
                    </a>
                    <button
                      onClick={() => setIsPdfFullscreen(true)}
                      className="px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)] hover:text-white flex items-center gap-1 transition-colors rounded-lg hover:bg-white/5"
                    >
                      <svg
                        className="w-3 h-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"
                        />
                      </svg>
                      Fullscreen
                    </button>
                    <button
                      onClick={handleClosePdfViewer}
                      className="p-1.5 hover:bg-white/10 rounded-lg text-[var(--text-secondary)] hover:text-white transition-colors"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
                <PdfViewer
                  pdfId={viewingPdfId!}
                  onAspectRatioChange={handlePdfAspectRatioChange}
                />

                <div
                  role="separator"
                  aria-label="Resize PDF panel width"
                  className="absolute right-0 top-0 h-full w-2 cursor-ew-resize"
                  onMouseDown={(event) =>
                    handlePdfResizeMouseDown(event, "right")
                  }
                />
                <div
                  role="separator"
                  aria-label="Resize PDF panel height"
                  className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize"
                  onMouseDown={(event) =>
                    handlePdfResizeMouseDown(event, "bottom")
                  }
                />
                <div
                  role="separator"
                  aria-label="Resize PDF panel width and height"
                  className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
                  onMouseDown={(event) =>
                    handlePdfResizeMouseDown(event, "corner-right")
                  }
                />
              </aside>
            ) : !viewingPdfId ? (
              <aside className="hidden lg:block glass-card p-5 rounded-2xl border border-white/10 shadow-2xl w-full max-h-[calc(100vh-8rem)] overflow-y-auto backdrop-blur-xl bg-[#0a0a0a]/80 animate-slide-up">
                <div className="flex items-center gap-2 mb-4">
                  <svg
                    className="w-5 h-5 text-[var(--accent-primary)]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <h2 className="text-base font-bold text-[var(--text-primary)]">
                    Paper Details
                  </h2>
                </div>
                {paperDetailsBody}
              </aside>
            ) : null}
          </div>
        </div>

        {/* BOTTOM LEFT: Controls Help */}
        <div className="mt-auto pointer-events-auto self-start">
          <div className="hidden lg:flex items-center gap-3">
            {/* Stats Badge */}
            <div className="glass-card flex h-10 w-fit items-center gap-2 self-start rounded-lg border border-white/10 px-3 text-xs font-medium text-[var(--text-secondary)] shadow-lg backdrop-blur-md whitespace-nowrap lg:self-auto">
              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
              {graphState.nodes.length} nodes · {graphState.links.length} links
            </div>
            <div className="glass-card flex h-10 w-fit items-center gap-3 rounded-lg border border-white/10 bg-[#0a0a0a]/60 px-4 text-[10px] font-medium text-[var(--text-secondary)] shadow-lg backdrop-blur-xl whitespace-nowrap">
              {activeRenderer === "3d" ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-[var(--accent-primary)]"></span>
                    Left click to rotate
                  </div>
                  <div className="w-px h-3 bg-white/10"></div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-[var(--accent-primary)]"></span>
                    Scroll to zoom
                  </div>
                  <div className="w-px h-3 bg-white/10"></div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-[var(--accent-primary)]"></span>
                    Click node to fly
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-[var(--accent-primary)]"></span>
                    Scroll to zoom
                  </div>
                  <div className="w-px h-3 bg-white/10"></div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-[var(--accent-primary)]"></span>
                    Drag to pan
                  </div>
                  <div className="w-px h-3 bg-white/10"></div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-[var(--accent-primary)]"></span>
                    Hold to focus
                  </div>
                  <div className="w-px h-3 bg-white/10"></div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-amber-500"></span>
                    Click leaf to expand
                  </div>
                </>
              )}
            </div>
            <div className="glass-card flex h-10 items-center gap-1 rounded-lg border border-white/10 p-1 shadow-lg backdrop-blur-md">
              {rendererToggleButtons}
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-3 right-3 z-20 pointer-events-auto lg:hidden">
        <div className="glass-card flex items-center gap-1 rounded-lg border border-white/10 p-1 shadow-lg backdrop-blur-md">
          {rendererToggleButtons}
        </div>
      </div>
      {selectedNode && !viewingPdfId && isMobileDetailsOpen && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            type="button"
            aria-label="Close paper details"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeMobileDetailsPopup}
          />
          <aside className="pointer-events-auto absolute inset-x-3 bottom-3 max-h-[78vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0a0a0a]/92 p-4 shadow-2xl backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <svg
                  className="w-5 h-5 text-[var(--accent-primary)]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <h2 className="truncate text-base font-bold text-[var(--text-primary)]">
                  Paper Details
                </h2>
              </div>
              <button
                type="button"
                onClick={closeMobileDetailsPopup}
                className="rounded-lg p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-white/10 hover:text-white"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
            {paperDetailsBody}
          </aside>
        </div>
      )}

      {viewingPdfId && !isPdfFullscreen && (
        <div className="fixed inset-0 z-40 pointer-events-none">
          <aside
            className="pointer-events-auto absolute glass-card flex h-auto flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a]/92 shadow-2xl backdrop-blur-xl"
            style={{
              left: `${pdfWindowPosition.x}px`,
              top: `${pdfWindowPosition.y}px`,
              width: `${pdfPanelSize.width}px`,
              height: `${pdfPanelSize.height}px`,
            }}
          >
            <div
              className="flex items-center justify-between border-b border-white/10 px-4 py-3"
              onMouseDown={handlePdfHeaderMouseDown}
              onPointerDown={handlePdfHeaderPointerDown}
              onPointerMove={handlePdfHeaderPointerMove}
              onPointerUp={handlePdfHeaderPointerEnd}
              onPointerCancel={handlePdfHeaderPointerEnd}
            >
              <div className="flex min-w-0 items-center gap-2">
                <svg
                  className="w-4 h-4 text-[var(--accent-primary)] flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
                <span className="truncate text-sm font-bold text-[var(--text-primary)]">
                  {graphState.nodes.find((n) => n.id === viewingPdfId)?.label ??
                    viewingPdfId}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <a
                  href={`https://arxiv.org/pdf/${viewingPdfId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] flex items-center gap-1 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                  Open PDF
                </a>
                <button
                  onClick={() => setIsPdfFullscreen(true)}
                  className="px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)] hover:text-white flex items-center gap-1 transition-colors rounded-lg hover:bg-white/5"
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4"
                    />
                  </svg>
                  Fullscreen
                </button>
                <button
                  onClick={handleClosePdfViewer}
                  className="p-1.5 rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-white/10 hover:text-white"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>

            <PdfViewer
              pdfId={viewingPdfId!}
              onAspectRatioChange={handlePdfAspectRatioChange}
            />

            <div
              role="separator"
              aria-label="Resize PDF panel from left edge"
              className="absolute left-0 top-0 h-full w-2 cursor-ew-resize"
              onMouseDown={(event) => handlePdfResizeMouseDown(event, "left")}
            />
            <div
              role="separator"
              aria-label="Resize PDF panel from right edge"
              className="absolute right-0 top-0 h-full w-2 cursor-ew-resize"
              onMouseDown={(event) => handlePdfResizeMouseDown(event, "right")}
            />
            <div
              role="separator"
              aria-label="Resize PDF panel height"
              className="absolute bottom-0 left-0 h-2 w-full cursor-ns-resize"
              onMouseDown={(event) =>
                handlePdfResizeMouseDown(event, "bottom")
              }
            />
            <div
              role="separator"
              aria-label="Resize PDF panel from bottom left corner"
              className="absolute bottom-0 left-0 h-4 w-4 cursor-nesw-resize"
              onMouseDown={(event) =>
                handlePdfResizeMouseDown(event, "corner-left")
              }
            />
            <div
              role="separator"
              aria-label="Resize PDF panel from bottom right corner"
              className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
              onMouseDown={(event) =>
                handlePdfResizeMouseDown(event, "corner-right")
              }
            />
          </aside>
        </div>
      )}

      {viewingPdfId && isPdfFullscreen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setIsPdfFullscreen(false)}
        >
          <aside
            className="glass-card flex h-auto max-h-[92vh] w-full max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a]/95 shadow-2xl lg:max-w-[1400px]"
            onClick={(event) => event.stopPropagation()}
            style={{ height: "min(92vh, 1000px)" }}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <svg
                  className="w-4 h-4 text-[var(--accent-primary)] flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
                <span className="truncate text-sm font-bold text-[var(--text-primary)]">
                  {graphState.nodes.find((n) => n.id === viewingPdfId)?.label ??
                    viewingPdfId}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setIsPdfFullscreen(false)}
                  className="px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)] hover:text-white flex items-center gap-1 transition-colors rounded-lg hover:bg-white/5"
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"
                    />
                  </svg>
                  Exit Fullscreen
                </button>
                <button
                  onClick={handleClosePdfViewer}
                  className="p-1.5 rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-white/10 hover:text-white"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
            <PdfViewer
              pdfId={viewingPdfId!}
              onAspectRatioChange={handlePdfAspectRatioChange}
            />
          </aside>
        </div>
      )}
    </>
  );
}
