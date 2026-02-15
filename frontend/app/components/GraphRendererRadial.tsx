"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import { type ApiGraphLink, type ApiGraphNode } from "@/lib/api";

type GraphState = {
    nodes: ApiGraphNode[];
    links: ApiGraphLink[];
};

type GraphRendererRadialProps = {
    width: number;
    height: number;
    graphState: GraphState;
    rootNodeId: string | null;
    selectedNodeId: string | null;
    hoveredNodeId: string | null;
    onHoverNodeIdChange: (nodeId: string | null) => void;
    onSelectNodeId: (nodeId: string | null) => void;
};

const toNodeId = (endpoint: string | { id: string }): string =>
    typeof endpoint === "string" ? endpoint : endpoint.id;

export default function GraphRendererRadial({
    width,
    height,
    graphState,
    rootNodeId,
    selectedNodeId,
    hoveredNodeId,
    onHoverNodeIdChange,
    onSelectNodeId,
}: GraphRendererRadialProps) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);

    const hasOutgoingLinks = useCallback(
        (nodeId: string) => graphState.links.some((link) => link.source === nodeId),
        [graphState.links],
    );

    // Main D3 Simulation Effect
    useEffect(() => {
        if (!svgRef.current) return;

        const simulationNodes = graphState.nodes.map((node) => ({ ...node }));
        const simulationLinks = graphState.links.map((link) => ({ ...link }));

        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        svg.attr("viewBox", `0 0 ${width} ${height}`);
        svg.attr("preserveAspectRatio", "xMidYMid meet");

        if (simulationNodes.length === 0) return;

        svg
            .append("rect")
            .attr("x", 0)
            .attr("y", 0)
            .attr("width", width)
            .attr("height", height)
            .attr("fill", "transparent")
            .on("click", () => onSelectNodeId(null));

        // Create a container group for zoom/pan
        const zoomContainer = svg.append("g").attr("class", "zoom-container");

        // Draw concentric radial guide rings
        const guideCx = width / 2;
        const guideCy = height / 2;
        const guideMaxR = Math.min(width, height) * 0.4;
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
                (link: any) => `${toNodeId(link.source)}->${toNodeId(link.target)}`,
            )
            .join("line")
            .attr("stroke-width", 2);

        const nodeSelection = zoomContainer
            .append("g")
            .selectAll("g")
            .data(simulationNodes, (node: any) => node.id)
            .join("g")
            .attr("class", "graph-node cursor-pointer select-none");

        const getNodeColor = (node: any) => {
            if (node.id === rootNodeId) return "#ec4899";
            return hasOutgoingLinks(node.id) ? "#a855f7" : "#404040";
        };

        nodeSelection
            .append("circle")
            .attr("r", 26)
            .attr("fill", getNodeColor)
            .attr("stroke", "#525252")
            .attr("stroke-width", 2)
            .style("filter", (node: any) => {
                if (node.id === rootNodeId) {
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
            .each(function (this: SVGTextElement, node: any) {
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
        const cx = width / 2;
        const cy = height / 2;
        const maxRadius = Math.min(width, height) * 0.4;

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
            .forceSimulation(simulationNodes as any)
            .force(
                "link",
                d3
                    .forceLink(simulationLinks)
                    .id((node: any) => node.id)
                    .distance((link: any) => {
                        const sim = link.similarity ?? 0;
                        return maxRadius * (1 - sim * 0.85);
                    })
                    .strength(0.3),
            )
            .force("charge", d3.forceManyBody().strength(-400))
            .force(
                "radial",
                (d3 as any).forceRadial(
                    (node: any) => nodeRadius(node),
                    cx,
                    cy,
                ).strength((node: any) => (node.id === rootId ? 1 : 0.8)),
            )
            .force("collision", d3.forceCollide().radius(42));

        // Create tooltip
        let tooltip = d3.select("body").select(".graph-tooltip") as any;
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

        nodeSelection.on("click", (event: MouseEvent, node: any) => {
            event.stopPropagation();
            onSelectNodeId(node.id);
        });

        const dragBehavior = d3
            .drag()
            .on("start", (event: any, node: any) => {
                if (!event.active) {
                    simulation.alphaTarget(0.25).restart();
                }
                node.fx = node.x;
                node.fy = node.y;
                setFocusedNodeId(node.id);
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
                setFocusedNodeId(null);
            });

        nodeSelection.call(dragBehavior as any)
            .on("mouseenter", function (event: MouseEvent, node: any) {
                if (focusedNodeId) return; // Hide tooltip if focused
                onHoverNodeIdChange(node.id);
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
                onHoverNodeIdChange(null);
                setFocusedNodeId(null);
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
        rootNodeId,
        width,
        height,
        hasOutgoingLinks,
    ]);

    // Update effects (highlighting without re-simulating)
    useEffect(() => {
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
            return graphState.links.some(
                (link) => {
                    const s = toNodeId(link.source);
                    const t = toNodeId(link.target);
                    return (s === focusedNodeId && t === nodeId) || (t === focusedNodeId && s === nodeId);
                }
            );
        };

        svg.selectAll("g.graph-node")
            .transition()
            .duration(300)
            .style("opacity", (node: any) => {
                if (!isFocusActive) return 1;
                return isConnected(node.id) ? 1 : 0.1;
            })
            .select("circle")
            .transition()
            .duration(300)
            .attr("r", (node: any) => (node.id === selectedNodeId ? 32 : 26))
            .attr("fill", (node: any) => {
                if (node.id === selectedNodeId) return "#ec4899";
                return hasOutgoingLinks(node.id) ? "#a855f7" : "#404040";
            })
            .attr("stroke", (node: any) =>
                node.id === selectedNodeId ? "#f472b6" : "#525252"
            )
            .attr("stroke-width", (node: any) =>
                node.id === selectedNodeId ? 3 : 2
            )
            .style("filter", (node: any) => {
                if (node.id === selectedNodeId) {
                    return "drop-shadow(0 0 12px rgba(236, 72, 153, 0.6))";
                }
                return hasOutgoingLinks(node.id)
                    ? "drop-shadow(0 0 8px rgba(168, 85, 247, 0.5))"
                    : "none";
            });

        svg.selectAll("g.zoom-container line")
            .transition()
            .duration(300)
            .style("opacity", (link: any) => {
                if (isFocusActive) {
                    const s = toNodeId(link.source);
                    const t = toNodeId(link.target);
                    return (s === focusedNodeId || t === focusedNodeId) ? 1 : 0.1;
                }
                if (selectedNodeId && isLinkConnectedToSelected(link)) return 1;
                if (selectedNodeId) return 0.15;
                return 0.6;
            })
            .attr("stroke", (link: any) => {
                if (isFocusActive) {
                    const s = toNodeId(link.source);
                    const t = toNodeId(link.target);
                    return (s === focusedNodeId || t === focusedNodeId) ? "#a855f7" : "#404040";
                }
                if (selectedNodeId && isLinkConnectedToSelected(link)) return "#a855f7";
                return "#404040";
            })
            .attr("stroke-width", (link: any) => {
                if (isFocusActive) {
                    const s = toNodeId(link.source);
                    const t = toNodeId(link.target);
                    return (s === focusedNodeId || t === focusedNodeId) ? 3 : 1;
                }
                if (selectedNodeId && isLinkConnectedToSelected(link)) return 3;
                return 2;
            });

    }, [selectedNodeId, focusedNodeId, hasOutgoingLinks, graphState.links]);

    return <svg ref={svgRef} className="w-full h-full" />;
}
