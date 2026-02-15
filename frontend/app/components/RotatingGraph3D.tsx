"use client";

import { useEffect, useRef, useMemo } from "react";
import * as d3 from "d3";

interface Node {
  id: string;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  color: string;
  size: number;
}

interface Link {
  source: string | Node;
  target: string | Node;
}

export default function RotatingGraph3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const animationRef = useRef<number>(0);
  const rotationRef = useRef({ x: 0.5, y: 0 });

  const { nodes, links } = useMemo(() => {
    const nodeCount = 30;
    const linkCount = 45;
    const colors = ["#a855f7", "#ec4899", "#c084fc", "#f472b6", "#8b5cf6"];
    
    const generatedNodes: Node[] = Array.from({ length: nodeCount }, (_, i) => ({
      id: `node-${i}`,
      x: (Math.random() - 0.5) * 400,
      y: (Math.random() - 0.5) * 400,
      z: (Math.random() - 0.5) * 200,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() * 6 + 4,
    }));

    const generatedLinks: Link[] = Array.from({ length: linkCount }, () => ({
      source: `node-${Math.floor(Math.random() * nodeCount)}`,
      target: `node-${Math.floor(Math.random() * nodeCount)}`,
    })).filter(l => l.source !== l.target);

    return { nodes: generatedNodes, links: generatedLinks };
  }, []);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const width = 600;
    const height = 450;
    const svg = d3.select(svgRef.current);
    
    svg.attr("width", width).attr("height", height);

    const centerX = width / 2;
    const centerY = height / 2;

    // Create force simulation
    const simulation = d3.forceSimulation<Node>(nodes)
      .force("link", d3.forceLink<Node, Link>(links).id(d => d.id).distance(80))
      .force("charge", d3.forceManyBody().strength(-150))
      .force("center", d3.forceCenter(0, 0))
      .force("collision", d3.forceCollide<Node>().radius(d => d.size + 5))
      .stop();

    // Run simulation for a bit to settle nodes
    for (let i = 0; i < 300; i++) simulation.tick();

    const g = svg.append("g").attr("transform", `translate(${centerX}, ${centerY})`);

    // Create gradient definitions
    const defs = svg.append("defs");
    
    const glowFilter = defs.append("filter")
      .attr("id", "glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");
    
    glowFilter.append("feGaussianBlur")
      .attr("stdDeviation", "3")
      .attr("result", "coloredBlur");
    
    glowFilter.append("feMerge")
      .append("feMergeNode")
      .attr("in", "coloredBlur");
    
    glowFilter.append("feMerge")
      .append("feMergeNode")
      .attr("in", "SourceGraphic");

    // Draw links
    const linkElements = g.selectAll("line.link")
      .data(links)
      .enter()
      .append("line")
      .attr("class", "link")
      .attr("stroke", "rgba(168, 85, 247, 0.3)")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.6);

    // Draw nodes
    const nodeElements = g.selectAll("circle.node")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("class", "node")
      .attr("r", d => d.size)
      .attr("fill", d => d.color)
      .attr("filter", "url(#glow)");

    // 3D projection and rotation
    const project3D = (x: number, y: number, z: number) => {
      const cosX = Math.cos(rotationRef.current.x);
      const sinX = Math.sin(rotationRef.current.x);
      const cosY = Math.cos(rotationRef.current.y);
      const sinY = Math.sin(rotationRef.current.y);

      const y1 = y * cosX - z * sinX;
      const z1 = y * sinX + z * cosX;
      const x1 = x * cosY + z1 * sinY;
      const z2 = -x * sinY + z1 * cosY;

      const scale = 800 / (800 + z2);
      return { x: x1 * scale, y: y1 * scale, scale, z: z2 };
    };

    const animate = () => {
      rotationRef.current.y += 0.003;
      rotationRef.current.x = 0.4 + Math.sin(Date.now() * 0.0005) * 0.2;

      const projectedNodes = nodes.map(node => ({
        ...node,
        projected: project3D(node.x || 0, node.y || 0, node.z || 0),
      }));

      // Update links
      linkElements
        .attr("x1", (d: any) => {
          const source = projectedNodes.find(n => n.id === (typeof d.source === "string" ? d.source : d.source.id));
          return source?.projected.x || 0;
        })
        .attr("y1", (d: any) => {
          const source = projectedNodes.find(n => n.id === (typeof d.source === "string" ? d.source : d.source.id));
          return source?.projected.y || 0;
        })
        .attr("x2", (d: any) => {
          const target = projectedNodes.find(n => n.id === (typeof d.target === "string" ? d.target : d.target.id));
          return target?.projected.x || 0;
        })
        .attr("y2", (d: any) => {
          const target = projectedNodes.find(n => n.id === (typeof d.target === "string" ? d.target : d.target.id));
          return target?.projected.y || 0;
        })
        .attr("stroke-opacity", (d: any) => {
          const source = projectedNodes.find(n => n.id === (typeof d.source === "string" ? d.source : d.source.id));
          const target = projectedNodes.find(n => n.id === (typeof d.target === "string" ? d.target : d.target.id));
          const avgZ = ((source?.projected.z || 0) + (target?.projected.z || 0)) / 2;
          return Math.max(0.1, 0.6 - avgZ / 400);
        });

      // Update nodes
      nodeElements
        .attr("cx", d => projectedNodes.find(n => n.id === d.id)?.projected.x || 0)
        .attr("cy", d => projectedNodes.find(n => n.id === d.id)?.projected.y || 0)
        .attr("r", d => {
          const projected = projectedNodes.find(n => n.id === d.id)?.projected;
          return d.size * (projected?.scale || 1);
        })
        .attr("opacity", d => {
          const projected = projectedNodes.find(n => n.id === d.id)?.projected;
          return Math.max(0.3, Math.min(1, (projected?.scale || 1) * 0.8));
        });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      simulation.stop();
    };
  }, [nodes, links]);

  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-pink-500/5 rounded-2xl" />
      <svg
        ref={svgRef}
        className="relative z-10"
        style={{ filter: "drop-shadow(0 0 30px rgba(168, 85, 247, 0.3))" }}
      />
    </div>
  );
}
