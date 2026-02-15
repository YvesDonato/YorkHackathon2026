"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import SpriteText from "three-spritetext";
import type { ApiGraphLink, ApiGraphNode } from "@/lib/api";
import GraphErrorBoundary from "@/app/components/GraphErrorBoundary";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-white/50">
      Loading 3D Engine...
    </div>
  ),
});

type GraphState = {
  nodes: ApiGraphNode[];
  links: ApiGraphLink[];
};

type GraphRenderer3DProps = {
  width: number;
  height: number;
  graphState: GraphState;
  rootNodeId: string | null;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  onHoverNodeIdChange: (nodeId: string | null) => void;
  onSelectNodeId: (nodeId: string | null) => void;
  onRuntimeError?: (error: Error) => void;
};

const toNodeId = (endpoint: string | { id: string }): string =>
  typeof endpoint === "string" ? endpoint : endpoint.id;

export default function GraphRenderer3D({
  width,
  height,
  graphState,
  rootNodeId,
  selectedNodeId,
  hoveredNodeId,
  onHoverNodeIdChange,
  onSelectNodeId,
  onRuntimeError,
}: GraphRenderer3DProps) {
  const fgRef = useRef<any>(null);

  useEffect(() => {
    if (!fgRef.current) return;

    fgRef.current.d3Force("link").distance((link: any) => {
      const similarity = link.similarity ?? 0.0;
      return 180 - similarity * 150;
    });
    fgRef.current.d3ReheatSimulation();
  }, [graphState]);

  return (
    <GraphErrorBoundary onError={(error) => onRuntimeError?.(error)}>
      <ForceGraph3D
        ref={fgRef}
        width={width}
        height={height}
        graphData={graphState}
        backgroundColor="rgba(0,0,0,0)"
        nodeLabel="label"
        nodeColor={(node: any) => {
          const isRoot = node.id === rootNodeId;
          const isHighlighted = node.id === hoveredNodeId || node.id === selectedNodeId;

          if (isRoot) {
            return isHighlighted ? "#f9a8d4" : "#ec4899";
          }
          return isHighlighted ? "#d8b4fe" : "#a855f7";
        }}
        onNodeHover={(node: any) => onHoverNodeIdChange(node ? node.id : null)}
        nodeRelSize={6}
        nodeThreeObjectExtend={true}
        nodeThreeObject={(node: any) => {
          const sprite = new SpriteText(node.label);
          sprite.material.depthWrite = false;
          sprite.color = node.id === selectedNodeId ? "#fff" : "rgba(255, 255, 255, 0.8)";
          sprite.textHeight = node.id === selectedNodeId ? 6 : 4;
          sprite.center.y = 0;
          sprite.position.y = 12;
          return sprite;
        }}
        linkColor={(link: any) => {
          const source = toNodeId(link.source);
          const target = toNodeId(link.target);
          if (source === selectedNodeId || target === selectedNodeId) {
            return "rgba(168, 85, 247, 0.8)";
          }
          return "rgba(255,255,255,0.2)";
        }}
        linkWidth={(link: any) => {
          const source = toNodeId(link.source);
          const target = toNodeId(link.target);
          return source === selectedNodeId || target === selectedNodeId ? 2 : 0.5;
        }}
        linkOpacity={0.3}
        linkLabel={(link: any) => `Similarity: ${(link.similarity * 100).toFixed(0)}%`}
        onNodeClick={(node: any) => {
          onSelectNodeId(node.id);
          if (!fgRef.current) return;

          const distance = 120;
          const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);
          fgRef.current.cameraPosition(
            { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
            node,
            2000,
          );
        }}
        onBackgroundClick={() => onSelectNodeId(null)}
        controlType="orbit"
      />
    </GraphErrorBoundary>
  );
}
