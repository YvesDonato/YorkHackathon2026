/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
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

const DEFAULT_SEED_LINK = "1706.03762";
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

const createEmptyGraphState = (): GraphState => ({ nodes: [], links: [] });

const toNodeId = (endpoint: string | { id: string }): string =>
  typeof endpoint === "string" ? endpoint : endpoint.id;

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

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
  const [rootNodeId, setRootNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null); // For 3D
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null); // For 2D
  const [viewingPdfId, setViewingPdfId] = useState<string | null>(null);
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null);

  // Renderer State
  const [rendererMode, setRendererMode] = useState<RendererMode>("2d");
  const [rendererNotice, setRendererNotice] = useState<string | null>(null);

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

  const handle3DRuntimeError = useCallback((error: Error) => {
    console.error("3D renderer failed, falling back to 2D:", error);
    setRendererNotice("3D renderer failed. Switched to 2D renderer.");
    setRendererMode("2d");
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
    } catch (error) {
      setGraphError(formatError(error));
      setGraphState(createEmptyGraphState());
      setSelectedNodeId(null);
    } finally {
      setIsLoadingGraph(false);
    }
  }, []);

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

  const handleNodeSelect = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setViewingPdfId(null);
  }, []);

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setViewingPdfId(null);
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
      .attr("stroke", "#404040")
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
        if (node.id === rootId) return "#ec4899";
        return hasOutgoingLinks(node.id) ? "#a855f7" : "#404040";
      })
      .attr("stroke", "#525252")
      .attr("stroke-width", 2)
      .style("filter", (node: ApiGraphNode) => {
        if (node.id === expandingNodeId)
          return "drop-shadow(0 0 14px rgba(245, 158, 11, 0.7))";
        if (node.id === rootId)
          return "drop-shadow(0 0 12px rgba(236, 72, 153, 0.6))";
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
      .attr("stroke-width", 3)
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
        .style("backdrop-filter", "blur(12px)")
        .style("transition", "opacity 0.2s ease");
    }

    nodeSelection.on("click", (event: MouseEvent, node: ApiGraphNode) => {
      event.stopPropagation();
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
      .on("mouseleave", function () {
        handleNodeMouseUp();
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

    svg
      .selectAll("g.graph-node")
      .transition()
      .duration(300)
      .style("opacity", (node: any) => {
        if (!isFocusActive) return 1;
        return isConnected(node.id) ? 1 : 0.1;
      })
      .select("circle.selection-ring")
      .transition()
      .duration(300)
      .ease(d3.easeQuadOut)
      .attr("stroke", (node: any) =>
        node.id === selectedNodeId ? "#f472b6" : "none",
      )
      .style("filter", (node: any) =>
        node.id === selectedNodeId
          ? "drop-shadow(0 0 8px rgba(244, 114, 182, 0.7))"
          : "none",
      );

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
        if (selectedNodeId && isLinkConnectedToSelected(link)) return 1;
        if (selectedNodeId) return 0.15;
        return 0.6;
      })
      .attr("stroke", (link: any) => {
        if (isFocusActive) {
          const s = toNodeId(link.source);
          const t = toNodeId(link.target);
          return s === focusedNodeId || t === focusedNodeId
            ? "#a855f7"
            : "#404040";
        }
        if (selectedNodeId && isLinkConnectedToSelected(link)) return "#a855f7";
        return "#404040";
      })
      .attr("stroke-width", (link: any) => {
        if (isFocusActive) {
          const s = toNodeId(link.source);
          const t = toNodeId(link.target);
          return s === focusedNodeId || t === focusedNodeId ? 3 : 1;
        }
        if (selectedNodeId && isLinkConnectedToSelected(link)) return 3;
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
        <div className="flex flex-wrap items-start justify-between gap-6">
          {/* LEFT: Branding & Sessions */}
          <div className="pointer-events-auto flex flex-col gap-4 max-w-sm">
            {/* Logo */}
            <div className="glass-card flex items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 shadow-2xl backdrop-blur-xl sm:px-5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#a855f7] to-[#ec4899] flex items-center justify-center shadow-lg">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
                Prismarine
              </h1>
            </div>

            {/* Sessions List */}
            <aside className="glass-card w-full max-h-40 overflow-y-auto rounded-2xl border border-white/10 bg-[#0a0a0a]/80 p-3 shadow-2xl backdrop-blur-xl sm:max-h-52 sm:p-4 lg:w-72 lg:max-h-[60vh]">
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
                      className={`p-2.5 rounded-lg border transition-all cursor-pointer hover:border-[var(--accent-primary)] ${
                        currentSessionId === session.id
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
                          className="flex-shrink-0 p-1 hover:bg-red-500/20 rounded text-red-400/60 hover:text-red-400 transition-colors"
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
          <div className="pointer-events-auto flex-1 max-w-xl">
            <form
              className="glass-card flex flex-wrap items-center gap-2 rounded-xl border border-white/10 p-2 shadow-2xl backdrop-blur-xl transition-colors focus-within:border-[var(--accent-primary)] sm:flex-nowrap sm:p-1.5 sm:pl-4"
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
                placeholder="Search by arXiv ID (e.g., 1706.03762)"
                className="bg-transparent border-none text-sm text-white placeholder-white/30 focus:ring-0 min-w-0 flex-1 basis-40 p-0"
              />
              <button
                type="submit"
                disabled={isLoadingGraph}
                className="w-full rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-50 sm:w-auto"
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
          <div className="flex flex-col gap-4 items-end pointer-events-auto w-80">
            {/* View Mode Toggle */}
            <div className="glass-card p-1 rounded-lg border border-white/10 backdrop-blur-md shadow-lg flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setRendererNotice(null);
                  setRendererMode("2d");
                }}
                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                  activeRenderer === "2d"
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
                  className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${
                    activeRenderer === "3d"
                      ? "bg-[var(--accent-primary)]/20 text-white"
                      : "text-[var(--text-secondary)] hover:bg-white/10"
                  }`}
                >
                  3D (Experimental)
                </button>
              )}
            </div>

            {rendererNotice && (
              <div className="glass-card px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-[11px] font-medium">
                {rendererNotice}
              </div>
            )}

            {/* Stats Badge */}
            <div className="glass-card flex w-fit items-center gap-2 self-start rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] shadow-lg backdrop-blur-md lg:self-auto">
              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
              {graphState.nodes.length} nodes · {graphState.links.length} links
            </div>

            {viewingPdfId ? (
              /* ── PDF / HTML Viewer Panel ── */
              <aside className="glass-card rounded-2xl border border-white/10 shadow-2xl w-full h-[calc(100vh-12rem)] backdrop-blur-xl bg-[#0a0a0a]/90 animate-slide-up flex flex-col overflow-hidden">
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
                      onClick={() => setViewingPdfId(null)}
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
                {/* Iframe: arXiv PDF viewer */}
                <iframe
                  src={`/pdf-proxy/${viewingPdfId}`}
                  className="flex-1 w-full bg-white rounded-b-2xl"
                  title={`Paper ${viewingPdfId}`}
                />
              </aside>
            ) : (
              <aside className="glass-card p-5 rounded-2xl border border-white/10 shadow-2xl w-full max-h-[calc(100vh-8rem)] overflow-y-auto backdrop-blur-xl bg-[#0a0a0a]/80 animate-slide-up">
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

                {selectedNode ? (
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
                        <span className="text-[var(--text-tertiary)]">
                          Connections
                        </span>
                        <span className="font-medium text-[var(--text-secondary)]">
                          {hasOutgoingLinks(selectedNode.id)
                            ? "Has Citations"
                            : "Leaf Node"}
                        </span>
                      </div>
                    </div>

                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => setViewingPdfId(selectedNode.id)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent-primary)]/20 hover:bg-[var(--accent-primary)]/30 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)] text-xs font-semibold transition-all hover:scale-[1.02]"
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
                      <div className="pt-3 border-t border-[var(--border-secondary)]">
                        <SummaryAudioPlayer
                          summary={selectedNode.content ?? ""}
                          variant="dark"
                        />
                      </div>

                      {currentSessionId && (
                        <button
                          onClick={() => handleExpandNode(selectedNode.id)}
                          disabled={expandingNodeId === selectedNode.id}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-amber-400 text-xs font-semibold transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
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
                )}
              </aside>
            )}
          </div>
        </div>

        {/* BOTTOM LEFT: Controls Help */}
        <div className="mt-auto pointer-events-auto self-start">
          <div className="glass-card inline-flex items-center gap-3 px-4 py-2 text-[10px] font-medium text-[var(--text-secondary)] border border-white/10 shadow-lg backdrop-blur-xl bg-[#0a0a0a]/60">
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
        </div>
      </div>
    </>
  );
}
