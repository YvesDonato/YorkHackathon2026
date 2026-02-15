"use client";

import { useEffect, useMemo, useState } from "react";
import * as d3 from "d3";
import type { ApiGraphLink, ApiGraphNode } from "@/lib/api";

type GraphState = {
  nodes: ApiGraphNode[];
  links: ApiGraphLink[];
};

type NodeDatum = ApiGraphNode &
  d3.SimulationNodeDatum & {
    x: number;
    y: number;
  };

type LinkDatum = d3.SimulationLinkDatum<NodeDatum> & {
  source: string | NodeDatum;
  target: string | NodeDatum;
  similarity?: number;
};

type GraphRenderer2DProps = {
  width: number;
  height: number;
  graphState: GraphState;
  rootNodeId: string | null;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  onHoverNodeIdChange: (nodeId: string | null) => void;
  onSelectNodeId: (nodeId: string | null) => void;
};

type LayoutState = {
  nodes: NodeDatum[];
  links: LinkDatum[];
};

const createSeededNodes = (
  nodes: ApiGraphNode[],
  width: number,
  height: number,
): NodeDatum[] => {
  const count = Math.max(1, nodes.length);
  const radius = Math.max(80, Math.min(width, height) * 0.28);

  return nodes.map((node, index) => {
    const angle = (index / count) * Math.PI * 2;
    return {
      ...node,
      x: width / 2 + radius * Math.cos(angle),
      y: height / 2 + radius * Math.sin(angle),
    };
  });
};

export default function GraphRenderer2D({
  width,
  height,
  graphState,
  rootNodeId,
  selectedNodeId,
  hoveredNodeId,
  onHoverNodeIdChange,
  onSelectNodeId,
}: GraphRenderer2DProps) {
  const initialNodes = useMemo(
    () => createSeededNodes(graphState.nodes, width, height),
    [graphState.nodes, width, height],
  );

  const initialLinks = useMemo<LinkDatum[]>(
    () =>
      graphState.links.map((link) => ({
        source: link.source,
        target: link.target,
        similarity: link.similarity,
      })),
    [graphState.links],
  );

  const [layout, setLayout] = useState<LayoutState>({
    nodes: initialNodes,
    links: initialLinks,
  });

  useEffect(() => {
    if (initialNodes.length === 0) {
      setLayout({ nodes: [], links: [] });
      return;
    }

    const nodes = initialNodes.map((node) => ({ ...node }));
    const links = initialLinks.map((link) => ({ ...link }));

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink<NodeDatum, LinkDatum>(links)
          .id((node) => node.id)
          .distance((link) => 180 - (link.similarity ?? 0) * 150),
      )
      .force("charge", d3.forceManyBody().strength(-260))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide<NodeDatum>().radius(18))
      .stop();

    for (let i = 0; i < 260; i += 1) {
      simulation.tick();
    }

    setLayout({ nodes, links });

    return () => {
      simulation.stop();
    };
  }, [initialNodes, initialLinks, width, height]);

  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );

  return (
    <svg
      width={width}
      height={height}
      className="h-full w-full"
      role="img"
      aria-label="Interactive 2D citation graph"
    >
      <rect
        width={width}
        height={height}
        fill="transparent"
        onClick={() => onSelectNodeId(null)}
      />

      <g>
        {layout.links.map((link, index) => {
          const sourceId = typeof link.source === "string" ? link.source : link.source.id;
          const targetId = typeof link.target === "string" ? link.target : link.target.id;
          const source = nodeById.get(sourceId);
          const target = nodeById.get(targetId);
          if (!source || !target) return null;

          const isSelectedPath = sourceId === selectedNodeId || targetId === selectedNodeId;
          return (
            <line
              key={`${sourceId}-${targetId}-${index}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={isSelectedPath ? "rgba(168, 85, 247, 0.8)" : "rgba(255,255,255,0.2)"}
              strokeWidth={isSelectedPath ? 2 : 1}
              opacity={0.85}
            />
          );
        })}
      </g>

      <g>
        {layout.nodes.map((node) => {
          const isRoot = node.id === rootNodeId;
          const isHovered = node.id === hoveredNodeId;
          const isSelected = node.id === selectedNodeId;
          const isHighlighted = isHovered || isSelected;

          const fillColor = isRoot
            ? isHighlighted
              ? "#f9a8d4"
              : "#ec4899"
            : isHighlighted
              ? "#d8b4fe"
              : "#a855f7";

          const radius = isSelected ? 10 : isRoot ? 8 : 6;

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y})`}
              className="cursor-pointer"
              onMouseEnter={() => onHoverNodeIdChange(node.id)}
              onMouseLeave={() => onHoverNodeIdChange(null)}
              onClick={(event) => {
                event.stopPropagation();
                onSelectNodeId(node.id);
              }}
            >
              <circle
                r={radius + 6}
                fill="rgba(255,255,255,0)"
              />
              <circle
                r={radius}
                fill={fillColor}
                stroke={isSelected ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)"}
                strokeWidth={isSelected ? 2 : 1}
              />
              {isSelected && (
                <text
                  x={12}
                  y={4}
                  fill="rgba(255,255,255,0.92)"
                  fontSize="10"
                  fontWeight="600"
                  pointerEvents="none"
                >
                  {node.label.slice(0, 44)}
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
