"use client";

import { useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import SpriteText from "three-spritetext";
import * as THREE from "three";
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

    // Helper to create materials
    const materials = useMemo(() => {
        const createMaterial = (color: string) =>
            new THREE.MeshPhysicalMaterial({
                color,
                metalness: 0.1,
                roughness: 0.3,
                clearcoat: 1.0,
                clearcoatRoughness: 0.1,
            });

        return {
            root: createMaterial("#ec4899"),
            rootHighlight: createMaterial("#f9a8d4"),
            default: createMaterial("#a855f7"),
            highlight: createMaterial("#d8b4fe"),
            selected: createMaterial("#f472b6"),
        };
    }, []);

    const geometries = useMemo(() => ({
        sphere: new THREE.SphereGeometry(6), // Base size (scaled by nodeVal)
    }), []);

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
                nodeThreeObjectExtend={false}
                nodeThreeObject={(node: any) => {
                    const isRoot = node.id === rootNodeId;
                    const isSelected = node.id === selectedNodeId;
                    const isHovered = node.id === hoveredNodeId;
                    const isHighlighted = isHovered || isSelected;

                    // 1. Create the main node mesh
                    let material = materials.default;
                    if (isRoot) material = isHighlighted ? materials.rootHighlight : materials.root;
                    else if (isSelected) material = materials.selected;
                    else if (isHighlighted) material = materials.highlight;

                    const mesh = new THREE.Mesh(geometries.sphere, material);

                    // Scale root and selected nodes
                    const scale = isRoot ? 1.5 : isSelected ? 1.3 : 1;
                    mesh.scale.set(scale, scale, scale);

                    // 2. Create the label sprite
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
                    sprite.renderOrder = 999;
                    sprite.color = "#ffffff";
                    sprite.textHeight = isSelected ? 8 : (isRoot ? 7 : 4);

                    // Position label above the node
                    // Base geometry radius is 6, scaled by 'scale'
                    const offset = 6 * scale + 4;
                    sprite.position.set(0, offset, 0);

                    // 3. Group them
                    const group = new THREE.Group();
                    group.add(mesh);
                    group.add(sprite);

                    // 4. Highlight Ring (Glow Effect) for Root or Selected
                    if (isRoot || isSelected) {
                        const ringGeo = new THREE.RingGeometry(8 * scale, 9 * scale, 32);
                        const ringMat = new THREE.MeshBasicMaterial({
                            color: isRoot ? "#ec4899" : "#f472b6",
                            side: THREE.DoubleSide,
                            transparent: true,
                            opacity: 0.5,
                        });
                        const ring = new THREE.Mesh(ringGeo, ringMat);
                        // Make ring face camera always?
                        // Actually Sprite looks best for glow, but Ring is okay if we orient it.
                        // For simplicity, let's just make it a billboard or sprite if we want.
                        // Using a simple point light for shading emphasis
                        if (isRoot) {
                            const light = new THREE.PointLight(0xec4899, 2, 50);
                            group.add(light);
                        }
                    }

                    return group;
                }}
                nodeVal={(node: any) => {
                    // ForceGraph3D uses nodeVal for radius calculation if we weren't replacing the object.
                    // But we are replacing it. The simulation still uses it for collision radius defaults.
                    return node.id === rootNodeId ? 30 : 10;
                }}
                onNodeHover={(node: any) => onHoverNodeIdChange(node ? node.id : null)}
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
