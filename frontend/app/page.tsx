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

    const linkSelection = svg
      .append("g")
      .attr("stroke", "#64748b")
      .attr("stroke-opacity", 0.45)
      .selectAll("line")
      .data(
        simulationLinks,
        (link: { source: string | { id: string }; target: string | { id: string } }) =>
          `${toNodeId(link.source)}->${toNodeId(link.target)}`,
      )
      .join("line")
      .attr("stroke-width", 1.8);

    const nodeSelection = svg
      .append("g")
      .selectAll("g")
      .data(simulationNodes, (node: ApiGraphNode) => node.id)
      .join("g")
      .attr("class", "cursor-pointer select-none");

    nodeSelection
      .append("circle")
      .attr("r", (node: ApiGraphNode) => (node.id === selectedNodeId ? 30 : 24))
      .attr("fill", (node: ApiGraphNode) => {
        if (node.id === selectedNodeId) {
          return "#0f172a";
        }

        return hasOutgoingLinks(node.id) ? "#0369a1" : "#334155";
      })
      .attr("stroke", (node: ApiGraphNode) =>
        node.id === selectedNodeId ? "#f59e0b" : "#e2e8f0",
      )
      .attr("stroke-width", (node: ApiGraphNode) =>
        node.id === selectedNodeId ? 3 : 2,
      );

    nodeSelection
      .append("text")
      .text((node: ApiGraphNode) => {
        if (node.label.length <= 22) {
          return node.label;
        }

        return `${node.label.slice(0, 19)}...`;
      })
      .attr("fill", "#f8fafc")
      .attr("font-size", 11)
      .attr("font-weight", 600)
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("pointer-events", "none");

    const simulation = d3
      .forceSimulation(simulationNodes)
      .force(
        "link",
        d3
          .forceLink(simulationLinks)
          .id((node: ApiGraphNode) => node.id)
          .distance(130)
          .strength(0.6),
      )
      .force("charge", d3.forceManyBody().strength(-700))
      .force("center", d3.forceCenter(viewport.width / 2, viewport.height / 2))
      .force("collision", d3.forceCollide().radius(38));

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

    nodeSelection.call(dragBehavior);

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

    return () => simulation.stop();
  }, [
    graphState.links,
    graphState.nodes,
    handleNodeClick,
    hasOutgoingLinks,
    isD3Loaded,
    selectedNodeId,
    viewport.height,
    viewport.width,
  ]);

  return (
    <>
      <Script
        src="https://d3js.org/d3.v7.min.js"
        strategy="afterInteractive"
        onLoad={() => setIsD3Loaded(true)}
      />

      <div className="min-h-screen bg-slate-100 px-4 py-8 text-slate-900 sm:px-6 lg:px-10">
        <main className="mx-auto grid w-full max-w-7xl gap-6 lg:grid-cols-[minmax(0,2.45fr)_minmax(280px,1fr)]">
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  arXiv Reference Graph
                </h1>
                <p className="text-sm text-slate-600">
                  Click a node to view its details in the sidebar.
                </p>
              </div>

              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {graphState.nodes.length} nodes | {graphState.links.length} links
              </span>
            </div>

            <form className="mb-4 flex flex-wrap gap-2" onSubmit={handleSeedSubmit}>
              <input
                type="text"
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
                placeholder="Enter arXiv ID or URL"
                className="min-w-[240px] flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={isLoadingGraph}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isLoadingGraph ? "Loading..." : "Load Graph"}
              </button>
            </form>

            {graphError ? (
              <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {graphError}
              </p>
            ) : null}

            <div
              ref={containerRef}
              className="relative h-[68vh] min-h-[430px] overflow-hidden rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_30%_20%,_#f8fafc,_#e2e8f0)]"
            >
              <svg
                ref={svgRef}
                className="h-full w-full"
                role="img"
                aria-label="Interactive force graph of arXiv papers"
              />

              {!isD3Loaded ? (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-sm font-medium text-slate-600">
                  Loading D3 graph engine...
                </div>
              ) : null}

              {isD3Loaded &&
              !isLoadingGraph &&
              graphState.nodes.length === 0 &&
              !graphError ? (
                <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-sm font-medium text-slate-600">
                  No nodes returned for this paper.
                </div>
              ) : null}

              <p className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/80 px-3 py-2 text-xs text-slate-700 shadow-sm backdrop-blur">
                Tip: click any node to update the sidebar details.
              </p>
            </div>
          </section>

          <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Selected Node</h2>

            {selectedNode ? (
              <div className="mt-4 space-y-4">
                <span className="inline-flex rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                  {selectedNode.id}
                </span>

                <h3 className="text-base font-semibold text-slate-900">
                  {selectedNode.label}
                </h3>

                <p className="text-sm leading-7 text-slate-700">
                  {selectedNode.content || "No summary available for this node."}
                </p>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-7 text-slate-600">
                Load a graph and click a node to view paper details.
              </p>
            )}
          </aside>
        </main>
      </div>
    </>
  );
}
