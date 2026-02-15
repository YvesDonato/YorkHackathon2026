"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Script from "next/script";
import Image from "next/image";
import {
  createSession,
  listSessions,
  getSession,
  deleteSession as deleteSessionApi,
  type ApiGraphLink,
  type ApiGraphNode,
  type Session,
} from "@/lib/api";

declare global {
  interface Window {
    d3?: any;
  }
}

type GraphState = {
  nodes: ApiGraphNode[];
  links: ApiGraphLink[];
};

const DEFAULT_SEED_LINK = "1706.03762";

const createEmptyGraphState = (): GraphState => ({ nodes: [], links: [] });

const toNodeId = (endpoint: string | { id: string }): string =>
  typeof endpoint === "string" ? endpoint : endpoint.id;

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : "Unexpected error";

export default function Home() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isD3Loaded, setIsD3Loaded] = useState(false);
  const [seedInput, setSeedInput] = useState(DEFAULT_SEED_LINK);
  const [graphState, setGraphState] = useState<GraphState>(createEmptyGraphState);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [viewport, setViewport] = useState({ width: 900, height: 560 });
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [rootNodeId, setRootNodeId] = useState<string | null>(null);
  const [viewingPdfId, setViewingPdfId] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => graphState.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graphState.nodes, selectedNodeId],
  );

  const hasOutgoingLinks = useCallback(
    (nodeId: string) => graphState.links.some((link) => link.source === nodeId),
    [graphState.links],
  );

  useEffect(() => {
    const token = localStorage.getItem("access_token")?.trim();
    if (!token) {
      window.location.href = "/login";
      return;
    }

    setIsAuthenticated(true);
    setIsAuthChecking(false);
  }, []);

  // Load sessions on mount
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
    if (!isAuthenticated) {
      return;
    }
    void loadSessions();
  }, [isAuthenticated, loadSessions]);

  // Load a specific session's graph
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

  // Create a new session
  const createNewSession = useCallback(async (seedLink: string) => {
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
      const session = await createSession({ seed_paper_link: normalizedSeed, mode: "references" });
      await loadSessions(); // Refresh session list
      await loadSessionGraph(session.id); // Load the new session's graph
    } catch (error) {
      setGraphError(formatError(error));
      setGraphState(createEmptyGraphState());
      setSelectedNodeId(null);
      setIsLoadingGraph(false);
    }
  }, [loadSessions, loadSessionGraph]);

  // Delete a session
  const deleteSession = useCallback(async (sessionId: string) => {
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
  }, [currentSessionId, loadSessions]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
      setViewingPdfId(null);
    },
    [],
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

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const element = containerRef.current;
    if (!element) {
      return;
    }

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

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (!isD3Loaded || !svgRef.current) {
      return;
    }

    const d3 = window.d3;
    if (!d3) {
      return;
    }

    const simulationNodes = graphState.nodes.map((node) => ({ ...node }));
    const simulationLinks = graphState.links.map((link) => ({ ...link }));

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${viewport.width} ${viewport.height}`);
    svg.attr("preserveAspectRatio", "xMidYMid meet");

    if (simulationNodes.length === 0) {
      return;
    }

    svg
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", viewport.width)
      .attr("height", viewport.height)
      .attr("fill", "transparent")
      .on("click", () => setSelectedNodeId(null));

    // Create a container group for zoom/pan
    const zoomContainer = svg.append("g").attr("class", "zoom-container");

    // Draw concentric radial guide rings
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

    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on("zoom", (event: any) => {
        zoomContainer.attr("transform", event.transform);
      });

    svg.call(zoom as any);

    const linkSelection = zoomContainer
      .append("g")
      .attr("stroke", "#404040")
      .attr("stroke-opacity", 0.6)
      .selectAll("line")
      .data(
        simulationLinks,
        (link: { source: string | { id: string }; target: string | { id: string } }) =>
          `${toNodeId(link.source)}->${toNodeId(link.target)}`,
      )
      .join("line")
      .attr("stroke-width", 2);

    const nodeSelection = zoomContainer
      .append("g")
      .selectAll("g")
      .data(simulationNodes, (node: ApiGraphNode) => node.id)
      .join("g")
      .attr("class", "graph-node cursor-pointer select-none");

    nodeSelection
      .append("circle")
      .attr("r", (node: ApiGraphNode) => (node.id === selectedNodeId ? 32 : 26))
      .attr("fill", (node: ApiGraphNode) => {
        if (node.id === selectedNodeId) {
          return "#ec4899";
        }
        return hasOutgoingLinks(node.id) ? "#a855f7" : "#404040";
      })
      .attr("stroke", (node: ApiGraphNode) =>
        node.id === selectedNodeId ? "#f472b6" : "#525252",
      )
      .attr("stroke-width", (node: ApiGraphNode) =>
        node.id === selectedNodeId ? 3 : 2,
      )
      .style("filter", (node: ApiGraphNode) => {
        if (node.id === selectedNodeId) {
          return "drop-shadow(0 0 12px rgba(236, 72, 153, 0.6))";
        }
        return hasOutgoingLinks(node.id)
          ? "drop-shadow(0 0 8px rgba(168, 85, 247, 0.5))"
          : "none";
      });

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
        const maxCharsPerLine = 12;
        const lines: string[] = [];
        let currentLine = "";

        // Build lines that fit within character limit
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

        // Limit to 2 lines with ellipsis
        if (lines.length > 2 || (lines.length === 2 && currentLine && currentLine !== lines[1])) {
          lines[1] = lines[1].slice(0, 9) + "...";
        }

        // Create tspan for each line
        lines.slice(0, 2).forEach((line, i) => {
          text.append("tspan")
            .attr("x", 0)
            .attr("dy", i === 0 ? "-0.3em" : "1.1em")
            .text(line);
        });
      });

    // ── Radial layout: root at center, distance = inverse similarity ──
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    const maxRadius = Math.min(viewport.width, viewport.height) * 0.4;

    // Build a map: nodeId → best (max) similarity to the root
    const rootId = rootNodeId ?? graphState.nodes.find((n) => n.is_root)?.id ?? simulationNodes[0]?.id;
    const bestSimilarity = new Map<string, number>();
    for (const link of graphState.links) {
      const s = toNodeId(link.source);
      const t = toNodeId(link.target);
      const sim = (link as any).similarity ?? 0;
      if (s === rootId) bestSimilarity.set(t, Math.max(bestSimilarity.get(t) ?? 0, sim));
      if (t === rootId) bestSimilarity.set(s, Math.max(bestSimilarity.get(s) ?? 0, sim));
    }

    // For nodes not directly connected to root, walk one hop
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

    // Pin root node at center
    const rootSimNode = simulationNodes.find((n) => n.id === rootId);
    if (rootSimNode) {
      (rootSimNode as any).fx = cx;
      (rootSimNode as any).fy = cy;
    }

    // Compute target radius for each node: high similarity → small radius
    const nodeRadius = (node: any): number => {
      if (node.id === rootId) return 0;
      const sim = bestSimilarity.get(node.id) ?? 0;
      // sim 1.0 → 15% of maxRadius, sim 0.0 → 100% of maxRadius
      return maxRadius * (1 - sim * 0.85);
    };

    const simulation = d3
      .forceSimulation(simulationNodes)
      .force(
        "link",
        d3
          .forceLink(simulationLinks)
          .id((node: ApiGraphNode) => node.id)
          .distance((link: any) => {
            const sim = link.similarity ?? 0;
            return maxRadius * (1 - sim * 0.85);
          })
          .strength(0.3),
      )
      .force("charge", d3.forceManyBody().strength(-400))
      .force(
        "radial",
        d3.forceRadial(
          (node: any) => nodeRadius(node),
          cx,
          cy,
        ).strength((node: any) => (node.id === rootId ? 1 : 0.8)),
      )
      .force("collision", d3.forceCollide().radius(42));

    // Create tooltip
    let tooltip = d3.select("body").select(".graph-tooltip");
    if (tooltip.empty()) {
      tooltip = d3.select("body")
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
        if (!event.active) {
          simulation.alphaTarget(0.25).restart();
        }
        node.fx = node.x;
        node.fy = node.y;
        handleNodeMouseDown(node.id);
      })
      .on("drag", (event: any, node: any) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on("end", (event: any, node: any) => {
        if (!event.active) {
          simulation.alphaTarget(0);
        }
        // Keep the root node pinned at center
        if (node.id === rootId) {
          node.fx = cx;
          node.fy = cy;
        } else {
          node.fx = null;
          node.fy = null;
        }
        handleNodeMouseUp();
      });

    nodeSelection.call(dragBehavior)
      .on("mouseenter", function (event: MouseEvent, node: ApiGraphNode) {
        if (focusedNodeId) return; // Hide tooltip if focused
        const sim = bestSimilarity.get(node.id);
        const simText = sim != null ? `<div style="color: #94a3b8; font-size: 11px; margin-top: 4px;">Similarity: ${(sim * 100).toFixed(0)}%</div>` : "";
        tooltip
          .style("visibility", "visible")
          .html(`<div style="font-weight: 600; color: #c084fc; margin-bottom: 4px;">${node.id}</div><div>${node.label}</div>${simText}`);
      })
      .on("mousemove", function (event: MouseEvent) {
        if (focusedNodeId) return;
        tooltip
          .style("left", (event.clientX + 15) + "px")
          .style("top", (event.clientY + 15) + "px");
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
      // Clean up tooltip
      d3.select("body").select(".graph-tooltip").remove();
    };
  }, [
    graphState.links,
    graphState.nodes,
    handleNodeClick,
    hasOutgoingLinks,
    isAuthenticated,
    isD3Loaded,
    rootNodeId,
    viewport.height,
    viewport.width,
  ]);

  // Separate effect to handle selection changes without re-rendering entire graph
  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (!isD3Loaded || !svgRef.current) {
      return;
    }

    const d3 = window.d3;
    if (!d3) {
      return;
    }

    const svg = d3.select(svgRef.current);
    const isFocusActive = !!focusedNodeId;

    // Helper to check if a link is connected to the selected or focused node
    const isLinkConnectedToSelected = (link: ApiGraphLink) => {
      if (!selectedNodeId) return false;
      const s = toNodeId(link.source);
      const t = toNodeId(link.target);
      return s === selectedNodeId || t === selectedNodeId;
    };

    // Helper to check if a node is connected to the focused node
    const isConnected = (nodeId: string) => {
      if (!isFocusActive || !focusedNodeId) return false;
      if (nodeId === focusedNodeId) return true;
      return graphState.links.some(
        (link) => {
          const s = toNodeId(link.source);
          const t = toNodeId(link.target);
          return (s === focusedNodeId && t === nodeId) || (t === focusedNodeId && s === nodeId);
        }
      );
    };

    // Update nodes opacity
    svg.selectAll("g.graph-node")
      .transition()
      .duration(300)
      .style("opacity", (node: ApiGraphNode) => {
        if (!isFocusActive) return 1;
        return isConnected(node.id) ? 1 : 0.1;
      })
      .select("circle")
      .transition()
      .duration(300) // Match opacity duration
      .ease(d3.easeQuadOut)
      .attr("r", (node: ApiGraphNode) => (node.id === selectedNodeId ? 32 : 26))
      .attr("fill", (node: ApiGraphNode) => {
        if (node.id === selectedNodeId) {
          return "#ec4899";
        }
        return hasOutgoingLinks(node.id) ? "#a855f7" : "#404040";
      })
      .attr("stroke", (node: ApiGraphNode) =>
        node.id === selectedNodeId ? "#f472b6" : "#525252"
      )
      .attr("stroke-width", (node: ApiGraphNode) =>
        node.id === selectedNodeId ? 3 : 2
      )
      .style("filter", (node: ApiGraphNode) => {
        if (node.id === selectedNodeId) {
          return "drop-shadow(0 0 12px rgba(236, 72, 153, 0.6))";
        }
        return hasOutgoingLinks(node.id)
          ? "drop-shadow(0 0 8px rgba(168, 85, 247, 0.5))"
          : "none";
      });

    // Update links: highlight edges connected to selected or focused node
    svg.selectAll("g.zoom-container line")
      .transition()
      .duration(300)
      .style("opacity", (link: ApiGraphLink) => {
        if (isFocusActive) {
          const s = toNodeId(link.source);
          const t = toNodeId(link.target);
          return (s === focusedNodeId || t === focusedNodeId) ? 1 : 0.1;
        }
        if (selectedNodeId && isLinkConnectedToSelected(link)) return 1;
        if (selectedNodeId) return 0.15;
        return 0.6;
      })
      .attr("stroke", (link: ApiGraphLink) => {
        if (isFocusActive) {
          const s = toNodeId(link.source);
          const t = toNodeId(link.target);
          return (s === focusedNodeId || t === focusedNodeId) ? "#a855f7" : "#404040";
        }
        if (selectedNodeId && isLinkConnectedToSelected(link)) return "#a855f7";
        return "#404040";
      })
      .attr("stroke-width", (link: ApiGraphLink) => {
        if (isFocusActive) {
          const s = toNodeId(link.source);
          const t = toNodeId(link.target);
          return (s === focusedNodeId || t === focusedNodeId) ? 3 : 1;
        }
        if (selectedNodeId && isLinkConnectedToSelected(link)) return 3;
        return 2;
      });

    // Hide tooltip if focus is active
    if (isFocusActive) {
      d3.select("body").select(".graph-tooltip").style("visibility", "hidden");
    }

  }, [selectedNodeId, focusedNodeId, isAuthenticated, isD3Loaded, hasOutgoingLinks, graphState.links]);

  if (isAuthChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <p className="text-sm text-[var(--text-secondary)]">Checking session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <>
      <Script
        src="https://d3js.org/d3.v7.min.js"
        strategy="afterInteractive"
        onLoad={() => setIsD3Loaded(true)}
      />

      {/* GRAPH LAYER (Fixed Background) */}
      <div
        ref={containerRef}
        className="fixed inset-0 z-0 bg-gradient-to-br from-[#0a0a0a] to-[#1a1a1a]"
      >
        <svg
          ref={svgRef}
          className="h-full w-full"
          role="img"
          aria-label="Interactive force graph of arXiv papers"
        />

        {!isD3Loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50">
            <div className="flex flex-col items-center gap-3">
              <svg className="animate-spin w-8 h-8 text-[var(--accent-primary)]" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p className="text-sm font-medium text-[var(--text-secondary)]">Loading graph engine...</p>
            </div>
          </div>
        )}

        {isD3Loaded &&
          !isLoadingGraph &&
          graphState.nodes.length === 0 &&
          !graphError && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center gap-3 text-center bg-black/40 backdrop-blur-md p-6 rounded-2xl border border-white/10">
                <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
                  <svg className="w-8 h-8 text-[var(--text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[var(--text-secondary)]">No citation data found for this paper</p>
              </div>
            </div>
          )}
      </div>

      {/* UI LAYER (Floating Overlays) */}
      <div className="fixed inset-0 z-10 pointer-events-none flex flex-col p-4 sm:p-6 lg:p-8">

        {/* TOP ROW */}
        <div className="flex flex-wrap items-start justify-between gap-6">

          {/* LEFT: Branding & Sessions */}
          <div className="flex flex-col gap-4 max-w-sm pointer-events-auto">
            {/* Logo */}
            <div className="glass-card px-5 py-3 rounded-2xl backdrop-blur-xl border border-white/10 shadow-2xl flex items-center gap-3">
              <div className="relative h-10 w-10 overflow-hidden rounded-lg shadow-lg">
                <Image
                  src="/prismarineLogo.png"
                  alt="Prismarine logo"
                  fill
                  sizes="40px"
                  className="object-contain p-0.5"
                  priority
                />
              </div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
                Prismarine
              </h1>
            </div>

            {/* Sessions List */}
            <aside className="glass-card p-4 rounded-2xl border border-white/10 shadow-2xl max-h-[60vh] overflow-y-auto w-72 backdrop-blur-xl bg-[#0a0a0a]/80">
              <div className="flex items-center gap-2 mb-3 px-1">
                <svg className="w-4 h-4 text-[var(--accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                <h2 className="text-sm font-bold text-[var(--text-primary)]">Sessions</h2>
              </div>

              {isLoadingSessions ? (
                <div className="flex items-center justify-center py-4">
                  <svg className="animate-spin w-5 h-5 text-[var(--accent-primary)]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                </div>
              ) : sessions.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-xs text-[var(--text-tertiary)]">No sessions yet</p>
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
                            {new Date(session.last_accessed).toLocaleDateString()}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteSession(session.id);
                          }}
                          className="flex-shrink-0 p-1 hover:bg-red-500/20 rounded text-red-400/60 hover:text-red-400 transition-colors"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
          <div className="flex-1 max-w-xl pointer-events-auto">
            <form className="glass-card p-1.5 pl-4 rounded-xl backdrop-blur-xl border border-white/10 shadow-2xl flex items-center gap-2 focus-within:border-[var(--accent-primary)] transition-colors" onSubmit={handleSeedSubmit}>
              <svg className="w-5 h-5 text-[var(--text-tertiary)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
                placeholder="Search by arXiv ID (e.g., 1706.03762)"
                className="bg-transparent border-none text-sm text-white placeholder-white/30 focus:ring-0 w-full p-0"
              />
              <button
                type="submit"
                disabled={isLoadingGraph}
                className="bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {isLoadingGraph ? "Loading..." : "Load Graph"}
              </button>
            </form>

            {graphError && (
              <div className="mt-4 glass-card p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-xs flex items-center gap-2 animate-slide-down shadow-xl">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {graphError}
              </div>
            )}
          </div>

          {/* RIGHT: Stats & Details / PDF Viewer */}
          <div className={`flex flex-col gap-4 items-end pointer-events-auto transition-all duration-300 ${viewingPdfId ? "w-[40vw] max-w-2xl" : "w-80"}`}>
            {/* Stats Badge */}
            <div className="glass-card px-3 py-1.5 rounded-lg border border-white/10 backdrop-blur-md shadow-lg flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
              {graphState.nodes.length} nodes · {graphState.links.length} links
            </div>

            {viewingPdfId ? (
              /* ── PDF / HTML Viewer Panel ── */
              <aside className="glass-card rounded-2xl border border-white/10 shadow-2xl w-full h-[calc(100vh-8rem)] backdrop-blur-xl bg-[#0a0a0a]/90 animate-slide-up flex flex-col overflow-hidden">
                {/* Viewer Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 flex-shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <svg className="w-4 h-4 text-[var(--accent-primary)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <span className="text-sm font-bold text-[var(--text-primary)] truncate">
                      {graphState.nodes.find(n => n.id === viewingPdfId)?.label ?? viewingPdfId}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <a
                      href={`https://arxiv.org/pdf/${viewingPdfId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)] flex items-center gap-1 transition-colors px-2 py-1 rounded-lg hover:bg-white/5"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                      Open PDF
                    </a>
                    <button
                      onClick={() => setViewingPdfId(null)}
                      className="p-1.5 hover:bg-white/10 rounded-lg text-[var(--text-secondary)] hover:text-white transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
                {/* Iframe: arXiv PDF viewer */}
                <iframe
                  src={`https://arxiv.org/pdf/${viewingPdfId}`}
                  className="flex-1 w-full bg-white rounded-b-2xl"
                  title={`Paper ${viewingPdfId}`}
                />
              </aside>
            ) : (
            <aside className="glass-card p-5 rounded-2xl border border-white/10 shadow-2xl w-full max-h-[calc(100vh-8rem)] overflow-y-auto backdrop-blur-xl bg-[#0a0a0a]/80 animate-slide-up">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-[var(--accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <h2 className="text-base font-bold text-[var(--text-primary)]">Paper Details</h2>
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
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
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

                  <button
                    onClick={() => setViewingPdfId(selectedNode.id)}
                    className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent-primary)]/20 hover:bg-[var(--accent-primary)]/30 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)] text-xs font-semibold transition-all hover:scale-[1.02]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    View Paper
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
                  <div className="w-12 h-12 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
                    <svg className="w-6 h-6 text-[var(--text-tertiary)] opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[var(--text-secondary)]">
                      No paper selected
                    </p>
                    <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                      Click a node or hold to focus
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
          <div className="glass-card inline-flex items-center gap-3 px-4 py-2 rounded-full text-[10px] font-medium text-[var(--text-secondary)] border border-white/10 shadow-lg backdrop-blur-xl bg-[#0a0a0a]/60">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]"></span>
              Scroll to zoom
            </div>
            <div className="w-px h-3 bg-white/10"></div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]"></span>
              Drag to pan
            </div>
            <div className="w-px h-3 bg-white/10"></div>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]"></span>
              Hold to focus
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
