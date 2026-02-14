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
import { fetchGraph, type ApiGraphLink, type ApiGraphNode } from "@/lib/api";

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

  const [isD3Loaded, setIsD3Loaded] = useState(false);
  const [seedInput, setSeedInput] = useState(DEFAULT_SEED_LINK);
  const [graphState, setGraphState] = useState<GraphState>(createEmptyGraphState);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(true);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ width: 900, height: 560 });

  const selectedNode = useMemo(
    () => graphState.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [graphState.nodes, selectedNodeId],
  );

  const hasOutgoingLinks = useCallback(
    (nodeId: string) => graphState.links.some((link) => link.source === nodeId),
    [graphState.links],
  );

  const loadGraph = useCallback(async (seedLink: string) => {
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
      const response = await fetchGraph(normalizedSeed);
      setGraphState({ nodes: response.nodes, links: response.links });
      setSelectedNodeId(response.seed_id);
    } catch (error) {
      setGraphError(formatError(error));
      setGraphState(createEmptyGraphState());
      setSelectedNodeId(null);
    } finally {
      setIsLoadingGraph(false);
    }
  }, []);

  useEffect(() => {
    void loadGraph(DEFAULT_SEED_LINK);
  }, [loadGraph]);

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNodeId(nodeId);
    },
    [],
  );

  const handleSeedSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void loadGraph(seedInput);
    },
    [loadGraph, seedInput],
  );

  useEffect(() => {
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
  }, []);

  useEffect(() => {
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

    const simulation = d3
      .forceSimulation(simulationNodes)
      .force(
        "link",
        d3
          .forceLink(simulationLinks)
          .id((node: ApiGraphNode) => node.id)
          .distance(140)
          .strength(0.6),
      )
      .force("charge", d3.forceManyBody().strength(-750))
      .force("center", d3.forceCenter(viewport.width / 2, viewport.height / 2))
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
      })
      .on("drag", (event: any, node: any) => {
        node.fx = event.x;
        node.fy = event.y;
      })
      .on("end", (event: any, node: any) => {
        if (!event.active) {
          simulation.alphaTarget(0);
        }
        node.fx = null;
        node.fy = null;
      });

    nodeSelection.call(dragBehavior)
      .on("mouseenter", function (event: MouseEvent, node: ApiGraphNode) {
        tooltip
          .style("visibility", "visible")
          .html(`<div style="font-weight: 600; color: #c084fc; margin-bottom: 4px;">${node.id}</div><div>${node.label}</div>`);
      })
      .on("mousemove", function (event: MouseEvent) {
        tooltip
          .style("left", (event.clientX + 15) + "px")
          .style("top", (event.clientY + 15) + "px");
      })
      .on("mouseleave", function () {
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
    isD3Loaded,
    viewport.height,
    viewport.width,
  ]);

  // Separate effect to handle selection changes without re-rendering entire graph
  useEffect(() => {
    if (!isD3Loaded || !svgRef.current) {
      return;
    }

    const d3 = window.d3;
    if (!d3) {
      return;
    }

    const svg = d3.select(svgRef.current);

    // Update all nodes with smooth transitions
    svg.selectAll("g.graph-node")
      .select("circle")
      .transition()
      .duration(600)
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
  }, [selectedNodeId, isD3Loaded, hasOutgoingLinks]);

  return (
    <>
      <Script
        src="https://d3js.org/d3.v7.min.js"
        strategy="afterInteractive"
        onLoad={() => setIsD3Loaded(true)}
      />

      <div className="min-h-screen px-4 py-8 sm:px-6 lg:px-10 animate-fade-in">
        <main className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[minmax(0,2.5fr)_minmax(320px,1fr)]">
          {/* Main Graph Section */}
          <section className="card-elevated p-6 sm:p-8 animate-slide-up">
            {/* Header */}
            <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#a855f7] to-[#ec4899] flex items-center justify-center shadow-lg">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h1 className="text-3xl font-bold gradient-text">
                    Research Graph Explorer
                  </h1>
                </div>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                  Explore research papers and their citation networks
                </p>
              </div>

              <div className="badge badge-primary flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
                <span>{graphState.nodes.length} nodes · {graphState.links.length} links</span>
              </div>
            </div>

            {/* Search Form */}
            <form className="mb-6 flex flex-wrap gap-3" onSubmit={handleSeedSubmit}>
              <div className="relative flex-1 min-w-[280px]">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={seedInput}
                  onChange={(event) => setSeedInput(event.target.value)}
                  placeholder="Enter arXiv ID or URL (e.g., 1706.03762)"
                  className="input-primary w-full !pl-10"
                />
              </div>
              <button
                type="submit"
                disabled={isLoadingGraph}
                className="relative overflow-hidden bg-gradient-to-r from-[#a855f7] to-[#ec4899] text-white font-semibold px-6 py-2.5 rounded-lg shadow-md hover:shadow-[0_0_20px_rgba(168,85,247,0.6)] transition-all duration-300 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
              >
                {isLoadingGraph ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Load Graph
                  </>
                )}
              </button>
            </form>

            {/* Error Message */}
            {graphError && (
              <div className="error-message mb-6 animate-slide-down">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{graphError}</span>
                </div>
              </div>
            )}

            {/* Graph Container */}
            <div
              ref={containerRef}
              className="relative h-[68vh] min-h-[480px] overflow-hidden rounded-2xl border border-[var(--border-secondary)] bg-gradient-to-br from-[#0a0a0a] to-[#1a1a1a] shadow-inner animate-scale-in"
            >
              <svg
                ref={svgRef}
                className="h-full w-full"
                role="img"
                aria-label="Interactive force graph of arXiv papers"
              />

              {!isD3Loaded && (
                <div className="absolute inset-0 flex items-center justify-center glass-card">
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
                  <div className="absolute inset-0 flex items-center justify-center glass-card">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
                        <svg className="w-8 h-8 text-[var(--text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <p className="text-sm font-medium text-[var(--text-secondary)]">No citation data found for this paper</p>
                    </div>
                  </div>
                )}

              <div className="glass-card pointer-events-none absolute bottom-4 left-4 px-4 py-2.5 text-xs text-[var(--text-secondary)] backdrop-blur-md">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-[var(--accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Scroll to zoom • Drag to pan • Click nodes for details</span>
                </div>
              </div>
            </div>
          </section>

          {/* Sidebar */}
          <aside className="card-elevated p-6 animate-slide-up" style={{ animationDelay: "200ms" }}>
            <div className="flex items-center gap-2 mb-4">
              <svg className="w-5 h-5 text-[var(--accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <h2 className="text-xl font-bold text-[var(--text-primary)]">Paper Details</h2>
            </div>

            {selectedNode ? (
              <div className="space-y-5 animate-fade-in">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="badge badge-secondary font-mono text-xs">
                    {selectedNode.id}
                  </span>
                  <a
                    href={`https://arxiv.org/abs/${selectedNode.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)] flex items-center gap-1 transition-smooth"
                  >
                    View on arXiv
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-[var(--text-primary)] leading-snug mb-3">
                    {selectedNode.label}
                  </h3>

                  <div className="text-sm text-[var(--text-secondary)] leading-relaxed space-y-2">
                    {selectedNode.content ? (
                      <p>{selectedNode.content}</p>
                    ) : (
                      <p className="italic text-[var(--text-tertiary)]">
                        No abstract available for this paper.
                      </p>
                    )}
                  </div>
                </div>

                <div className="pt-4 border-t border-[var(--border-secondary)] space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-tertiary)]">Status</span>
                    <span className="font-medium text-[var(--text-secondary)]">
                      {hasOutgoingLinks(selectedNode.id) ? "Has Citations" : "No Citations"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--text-tertiary)]">Node Type</span>
                    <span className="font-medium text-[var(--text-secondary)]">
                      {selectedNodeId === selectedNode.id ? "Selected" : "Standard"}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#0ea5e9]/20 to-[#f59e0b]/20 flex items-center justify-center">
                  <svg className="w-10 h-10 text-[var(--text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-secondary)] mb-1">
                    No paper selected
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Click a node in the graph to view details
                  </p>
                </div>
              </div>
            )}
          </aside>
        </main>
      </div>
    </>
  );
}
