"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type GraphErrorBoundaryProps = {
  children: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
};

type GraphErrorBoundaryState = {
  hasError: boolean;
};

export default class GraphErrorBoundary extends Component<
  GraphErrorBoundaryProps,
  GraphErrorBoundaryState
> {
  state: GraphErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): GraphErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Graph runtime error:", error, info);
    this.props.onError?.(error, info);
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-auto">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-white/20 bg-[#111111]/95 p-6 text-center shadow-2xl">
            <h2 className="text-lg font-bold text-white">Graph failed to load</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              The 3D renderer hit a client error. You can retry without leaving this page.
            </p>
            <button
              type="button"
              onClick={this.handleRetry}
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-[#a855f7] to-[#ec4899] px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
            >
              Retry Graph
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
