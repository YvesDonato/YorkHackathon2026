"use client";

import { useEffect, useMemo, useRef } from "react";
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
    const safeGraphData = useMemo(
        () => ({
            nodes: graphState.nodes.map((node) => ({ ...node })),
            links: graphState.links.map((link) => ({ ...link })),
        }),
        [graphState.nodes, graphState.links],
    );

    useEffect(() => {
        return () => {
            const fg = fgRef.current;
            if (!fg) return;
            fg.pauseAnimation?.();
            fg._destructor?.();
            fgRef.current = null;
        };
    }, []);

    return (
        <GraphErrorBoundary onError={(error) => onRuntimeError?.(error)}>
            <ForceGraph3D
                ref={fgRef}
                width={width}
                height={height}
                graphData={safeGraphData}
                backgroundColor="rgba(0,0,0,0)"
                nodeLabel="label"
                enableNodeDrag={false}
                nodeColor={(node: any) => {
                    const isRoot = node.id === rootNodeId;
                    const isHighlighted = node.id === hoveredNodeId || node.id === selectedNodeId;

                    if (isRoot) {
                        return isHighlighted ? "#f9a8d4" : "#ec4899";
                    }
                    return isHighlighted ? "#d8b4fe" : "#a855f7";
                }}
                onNodeHover={(node: any) => onHoverNodeIdChange(node ? node.id : null)}
                nodeRelSize={10}
                nodeThreeObjectExtend={true}
                nodeThreeObject={(node: any) => {
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

                    if (lines.length > 2 || (lines.length === 2 && currentLine && currentLine !== lines[1])) {
                        lines[1] = lines[1].slice(0, 12) + "...";
                    }
                    const wrappedLabel = lines.slice(0, 2).join("\n");

                    const sprite = new SpriteText(wrappedLabel);
                    sprite.material.depthWrite = false;
                    sprite.material.depthTest = false;
                    sprite.material.transparent = true;
                    sprite.renderOrder = 999; // Render on top of everything Else
                    sprite.color = "#ffffff";
                    sprite.textHeight = node.id === selectedNodeId ? 6 : 4;
                    sprite.center.y = 0.5;
                    sprite.position.y = 0;
                    return sprite;
                }}
                linkColor={(link: any) => {
                    const source = toNodeId(link.source);
                    const target = toNodeId(link.target);
                    if (source === selectedNodeId || target === selectedNodeId) {
                        return "rgba(168, 85, 247, 0.8)";
                    }
                    return "rgba(209, 213, 219, 0.45)";
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
                    if (
                        typeof node?.x !== "number" ||
                        typeof node?.y !== "number" ||
                        typeof node?.z !== "number"
                    ) {
                        return;
                    }

                    const distance = 120;
                    const nodeDistance = Math.hypot(node.x, node.y, node.z);
                    const distRatio = nodeDistance > 0 ? 1 + distance / nodeDistance : 1;
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
