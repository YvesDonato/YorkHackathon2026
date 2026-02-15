"use client";

import { useEffect, useRef } from "react";

type NodePoint = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
};

const NODE_COUNT_DESKTOP = 38;
const NODE_COUNT_MOBILE = 24;
const MAX_LINK_DISTANCE = 180;
const NODE_RADIUS_MIN = 2.8;
const NODE_RADIUS_VARIANCE = 2.6;

export default function LandingNodeBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");
    if (!context) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduceMotion = mediaQuery.matches;
    let width = 0;
    let height = 0;
    let rafId = 0;

    const makeNode = (): NodePoint => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      r: Math.random() * NODE_RADIUS_VARIANCE + NODE_RADIUS_MIN,
    });

    const getNodeCount = () =>
      window.innerWidth < 768 ? NODE_COUNT_MOBILE : NODE_COUNT_DESKTOP;

    let nodes: NodePoint[] = [];

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      nodes = Array.from({ length: getNodeCount() }, makeNode);
    };

    const renderFrame = () => {
      context.clearRect(0, 0, width, height);

      for (let i = 0; i < nodes.length; i += 1) {
        const node = nodes[i];
        node.x += node.vx;
        node.y += node.vy;

        if (node.x <= 0 || node.x >= width) node.vx *= -1;
        if (node.y <= 0 || node.y >= height) node.vy *= -1;
      }

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const distance = Math.hypot(dx, dy);
          if (distance > MAX_LINK_DISTANCE) continue;

          const alpha = 1 - distance / MAX_LINK_DISTANCE;
          context.beginPath();
          context.moveTo(nodes[i].x, nodes[i].y);
          context.lineTo(nodes[j].x, nodes[j].y);
          context.strokeStyle = `rgba(168, 85, 247, ${alpha * 0.16})`;
          context.lineWidth = 1;
          context.stroke();
        }
      }

      for (const node of nodes) {
        context.beginPath();
        context.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        context.fillStyle = "rgba(236, 72, 153, 0.55)";
        context.fill();
      }

      rafId = window.requestAnimationFrame(renderFrame);
    };

    resize();

    if (reduceMotion) {
      renderFrame();
      window.cancelAnimationFrame(rafId);
    } else {
      rafId = window.requestAnimationFrame(renderFrame);
    }

    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-0 opacity-70"
    />
  );
}
