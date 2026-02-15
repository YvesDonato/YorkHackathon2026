"use client";

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type FormEvent,
} from "react";
import Image from "next/image";
import dynamic from "next/dynamic";
import {
    createSession,
    listSessions,
    getSession,
    deleteSession as deleteSessionApi,
    type ApiGraphLink,
    type ApiGraphNode,
    type Session,
} from "@/lib/api";
import GraphRenderer2D from "@/app/components/GraphRenderer2D";
import GraphErrorBoundary from "@/app/components/GraphErrorBoundary";

type GraphState = {
    nodes: ApiGraphNode[];
    links: ApiGraphLink[];
};

const DEFAULT_SEED_LINK = "1706.03762";
const RENDERER_MODE_STORAGE_KEY = "prismarine_renderer_mode";
const ENABLE_3D_EXPERIMENTAL =
    process.env.NEXT_PUBLIC_ENABLE_3D_EXPERIMENTAL === "true";

type RendererMode = "2d" | "3d";

const GraphRenderer3D = dynamic(() => import("@/app/components/GraphRenderer3D"), {
    ssr: false,
    loading: () => (
        <div className="flex h-full items-center justify-center text-white/50">
            Loading 3D Engine...
        </div>
    ),
});

const createEmptyGraphState = (): GraphState => ({ nodes: [], links: [] });

const toNodeId = (endpoint: string | { id: string }): string =>
    typeof endpoint === "string" ? endpoint : endpoint.id;

const formatError = (error: unknown): string =>
    error instanceof Error ? error.message : "Unexpected error";

export default function Home() {
    const containerRef = useRef<HTMLDivElement | null>(null);

    const [isAuthChecking, setIsAuthChecking] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [seedInput, setSeedInput] = useState(DEFAULT_SEED_LINK);
    const [graphState, setGraphState] = useState<GraphState>(createEmptyGraphState);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [rootNodeId, setRootNodeId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [isLoadingGraph, setIsLoadingGraph] = useState(false);
    const [graphError, setGraphError] = useState<string | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [isLoadingSessions, setIsLoadingSessions] = useState(true);
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [rendererMode, setRendererMode] = useState<RendererMode>("2d");
    const [rendererNotice, setRendererNotice] = useState<string | null>(null);

    const selectedNode = useMemo(
        () => graphState.nodes.find((node) => node.id === selectedNodeId) ?? null,
        [graphState.nodes, selectedNodeId],
    );

    const hasOutgoingLinks = useCallback(
        (nodeId: string) => graphState.links.some((link) => link.source === nodeId),
        [graphState.links],
    );

    useEffect(() => {
        const token = localStorage.getItem("access_token")?.trim();
        if (!token) {
            window.location.href = "/login";
            return;
        }

        setIsAuthenticated(true);
        setIsAuthChecking(false);
    }, []);

    const loadSessions = useCallback(async () => {
        try {
            const sessionList = await listSessions();
            setSessions(sessionList);
        } catch (error) {
            console.error("Failed to load sessions:", error);
        } finally {
            setIsLoadingSessions(false);
        }
    }, []);

    useEffect(() => {
        if (!isAuthenticated) return;
        void loadSessions();
    }, [isAuthenticated, loadSessions]);

    const loadSessionGraph = useCallback(async (sessionId: string) => {
        setIsLoadingGraph(true);
        setGraphError(null);

        try {
            const response = await getSession(sessionId);
            setGraphState({ nodes: response.nodes, links: response.links });
            setSelectedNodeId(response.seed_id);
            setRootNodeId(response.seed_id);
            setCurrentSessionId(sessionId);
        } catch (error) {
            setGraphError(formatError(error));
            setGraphState(createEmptyGraphState());
            setSelectedNodeId(null);
        } finally {
            setIsLoadingGraph(false);
        }
    }, []);

    const createNewSession = useCallback(async (seedLink: string) => {
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
            const session = await createSession({ seed_paper_link: normalizedSeed, mode: "grounding" });
            await loadSessions();
            await loadSessionGraph(session.id);
        } catch (error) {
            setGraphError(formatError(error));
            setGraphState(createEmptyGraphState());
            setSelectedNodeId(null);
            setIsLoadingGraph(false);
        }
    }, [loadSessions, loadSessionGraph]);

    const deleteSession = useCallback(async (sessionId: string) => {
        try {
            await deleteSessionApi(sessionId);
            await loadSessions();
            if (currentSessionId === sessionId) {
                setGraphState(createEmptyGraphState());
                setSelectedNodeId(null);
                setCurrentSessionId(null);
            }
        } catch (error) {
            console.error("Failed to delete session:", error);
        }
    }, [currentSessionId, loadSessions]);

    const handleNodeSelect = useCallback((nodeId: string | null) => {
        setSelectedNodeId(nodeId);
    }, []);

    const handleSeedSubmit = useCallback(
        (event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void createNewSession(seedInput);
        },
        [createNewSession, seedInput],
    );

    useEffect(() => {
        if (!isAuthenticated) return;
        const element = containerRef.current;
        if (!element) return;

        const updateViewport = () => {
            const rect = element.getBoundingClientRect();
            setViewport({
                width: rect.width,
                height: rect.height,
            });
        };

        updateViewport();
        const observer = new ResizeObserver(updateViewport);
        observer.observe(element);
        return () => observer.disconnect();
    }, [isAuthenticated]);

    useEffect(() => {
        if (typeof window === "undefined") return;

        let nextMode: RendererMode = "2d";

        if (ENABLE_3D_EXPERIMENTAL) {
            const queryMode = new URLSearchParams(window.location.search).get("renderer");
            const savedMode = localStorage.getItem(RENDERER_MODE_STORAGE_KEY);
            if (queryMode === "3d" || savedMode === "3d") {
                nextMode = "3d";
            }
        }

        setRendererMode(nextMode);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (rendererMode === "3d" && !ENABLE_3D_EXPERIMENTAL) {
            setRendererMode("2d");
            return;
        }
        localStorage.setItem(RENDERER_MODE_STORAGE_KEY, rendererMode);
    }, [rendererMode]);

    const handle3DRuntimeError = useCallback((error: Error) => {
        console.error("3D renderer failed, falling back to 2D:", error);
        setRendererNotice("3D renderer failed. Switched to 2D renderer.");
        setRendererMode("2d");
    }, []);

    const activeRenderer: RendererMode =
        rendererMode === "3d" && ENABLE_3D_EXPERIMENTAL ? "3d" : "2d";

    if (isAuthChecking) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
                <p className="text-sm text-[var(--text-secondary)]">Checking session...</p>
            </div>
        );
    }

    if (!isAuthenticated) return null;

    return (
        <>
            {/* GRAPH LAYER (Fixed Background) */}
            <div
                ref={containerRef}
                className="fixed inset-0 z-0 bg-gradient-to-br from-[#0a0a0a] to-[#1a1a1a]"
            >
                {viewport.width > 0 && (
                    activeRenderer === "3d" ? (
                        <GraphErrorBoundary onError={(error) => handle3DRuntimeError(error)}>
                            <GraphRenderer3D
                                width={viewport.width}
                                height={viewport.height}
                                graphState={graphState}
                                rootNodeId={rootNodeId}
                                selectedNodeId={selectedNodeId}
                                hoveredNodeId={hoveredNodeId}
                                onHoverNodeIdChange={setHoveredNodeId}
                                onSelectNodeId={handleNodeSelect}
                                onRuntimeError={handle3DRuntimeError}
                            />
                        </GraphErrorBoundary>
                    ) : (
                        <GraphRenderer2D
                            width={viewport.width}
                            height={viewport.height}
                            graphState={graphState}
                            rootNodeId={rootNodeId}
                            selectedNodeId={selectedNodeId}
                            hoveredNodeId={hoveredNodeId}
                            onHoverNodeIdChange={setHoveredNodeId}
                            onSelectNodeId={handleNodeSelect}
                        />
                    )
                )}

                {isLoadingGraph && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-50">
                        <div className="flex flex-col items-center gap-3">
                            <svg className="animate-spin w-8 h-8 text-[var(--accent-primary)]" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <p className="text-sm font-medium text-[var(--text-secondary)]">Loading graph engine...</p>
                        </div>
                    </div>
                )}

                {!isLoadingGraph &&
                    graphState.nodes.length === 0 &&
                    !graphError && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="flex flex-col items-center gap-3 text-center bg-black/40 backdrop-blur-md p-6 rounded-2xl border border-white/10">
                                <div className="w-16 h-16 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center">
                                    <svg className="w-8 h-8 text-[var(--text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                </div>
                                <p className="text-sm font-medium text-[var(--text-secondary)]">No citation data found</p>
                            </div>
                        </div>
                    )}
            </div>

            {/* UI LAYER (Floating Overlays) */}
            <div className="fixed inset-0 z-10 pointer-events-none flex flex-col p-4 sm:p-6 lg:p-8">

                {/* TOP ROW */}
                <div className="flex flex-wrap items-start justify-between gap-6">

                    {/* LEFT: Branding & Sessions */}
                    <div className="flex flex-col gap-4 max-w-sm pointer-events-auto">
                        {/* Logo */}
                        <div className="glass-card px-5 py-3 rounded-2xl backdrop-blur-xl border border-white/10 shadow-2xl flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#a855f7] to-[#ec4899] flex items-center justify-center shadow-lg">
                                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                            </div>
                            <h1 className="text-lg font-bold bg-gradient-to-r from-white to-white/70 bg-clip-text text-transparent">
                                Research Graph
                            </h1>
                        </div>

                        {/* Sessions List */}
                        <aside className="glass-card p-4 rounded-2xl border border-white/10 shadow-2xl max-h-[60vh] overflow-y-auto w-72 backdrop-blur-xl bg-[#0a0a0a]/80">
                            <div className="flex items-center gap-2 mb-3 px-1">
                                <svg className="w-4 h-4 text-[var(--accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                </svg>
                                <h2 className="text-sm font-bold text-[var(--text-primary)]">Sessions</h2>
                            </div>

                            {isLoadingSessions ? (
                                <div className="flex items-center justify-center py-4">
                                    <svg className="animate-spin w-5 h-5 text-[var(--accent-primary)]" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                </div>
                            ) : sessions.length === 0 ? (
                                <div className="text-center py-4">
                                    <p className="text-xs text-[var(--text-tertiary)]">No sessions yet</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {sessions.map((session) => (
                                        <div
                                            key={session.id}
                                            className={`p-2.5 rounded-lg border transition-all cursor-pointer hover:border-[var(--accent-primary)] ${currentSessionId === session.id
                                                ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10"
                                                : "border-transparent hover:bg-white/5"
                                                }`}
                                            onClick={() => void loadSessionGraph(session.id)}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                                        {session.title || session.id.slice(0, 8)}
                                                    </p>
                                                    <p className="text-[10px] text-[var(--text-tertiary)] truncate mt-0.5">
                                                        {new Date(session.last_accessed).toLocaleDateString()}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        void deleteSession(session.id);
                                                    }}
                                                    className="flex-shrink-0 p-1 hover:bg-red-500/20 rounded text-red-400/60 hover:text-red-400 transition-colors"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </aside>
                    </div>

                    {/* CENTER: Search Bar */}
                    <div className="flex-1 max-w-xl pointer-events-auto">
                        <form className="glass-card p-1.5 pl-4 rounded-xl backdrop-blur-xl border border-white/10 shadow-2xl flex items-center gap-2 focus-within:border-[var(--accent-primary)] transition-colors" onSubmit={handleSeedSubmit}>
                            <svg className="w-5 h-5 text-[var(--text-tertiary)] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                                type="text"
                                value={seedInput}
                                onChange={(event) => setSeedInput(event.target.value)}
                                placeholder="Search by arXiv ID (e.g., 1706.03762)"
                                className="bg-transparent border-none text-sm text-white placeholder-white/30 focus:ring-0 w-full p-0"
                            />
                            <button
                                type="submit"
                                disabled={isLoadingGraph}
                                className="bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                            >
                                {isLoadingGraph ? "Loading..." : "Load Graph"}
                            </button>
                        </form>

                        {graphError && (
                            <div className="mt-4 glass-card p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-200 text-xs flex items-center gap-2 animate-slide-down shadow-xl">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {graphError}
                            </div>
                        )}
                    </div>

                    {/* RIGHT: Stats & Details */}
                    <div className="flex flex-col gap-4 items-end pointer-events-auto w-80">
                        <div className="glass-card p-1 rounded-lg border border-white/10 backdrop-blur-md shadow-lg flex items-center gap-1">
                            <button
                                type="button"
                                onClick={() => {
                                    setRendererNotice(null);
                                    setRendererMode("2d");
                                }}
                                className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${activeRenderer === "2d"
                                        ? "bg-[var(--accent-primary)]/20 text-white"
                                        : "text-[var(--text-secondary)] hover:bg-white/10"
                                    }`}
                            >
                                2D
                            </button>
                            {ENABLE_3D_EXPERIMENTAL && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setRendererNotice(null);
                                        setRendererMode("3d");
                                    }}
                                    className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${activeRenderer === "3d"
                                            ? "bg-[var(--accent-primary)]/20 text-white"
                                            : "text-[var(--text-secondary)] hover:bg-white/10"
                                        }`}
                                >
                                    3D (Experimental)
                                </button>
                            )}
                        </div>

                        {rendererNotice && (
                            <div className="glass-card px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-[11px] font-medium">
                                {rendererNotice}
                            </div>
                        )}

                        {/* Stats Badge */}
                        <div className="glass-card px-3 py-1.5 rounded-lg border border-white/10 backdrop-blur-md shadow-lg flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                            <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                            {graphState.nodes.length} nodes · {graphState.links.length} links
                        </div>

                        {/* Details Panel */}
                        <aside className="glass-card p-5 rounded-2xl border border-white/10 shadow-2xl w-full max-h-[calc(100vh-8rem)] overflow-y-auto backdrop-blur-xl bg-[#0a0a0a]/80 animate-slide-up">
                            <div className="flex items-center gap-2 mb-4">
                                <svg className="w-5 h-5 text-[var(--accent-primary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <h2 className="text-base font-bold text-[var(--text-primary)]">Paper Details</h2>
                            </div>

                            {selectedNode ? (
                                <div key={selectedNode.id} className="space-y-4">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="badge badge-secondary font-mono text-[10px] px-2 py-0.5">
                                            {selectedNode.id}
                                        </span>
                                        <a
                                            href={`https://arxiv.org/abs/${selectedNode.id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[10px] font-medium text-[var(--accent-primary)] hover:text-[#f472b6] flex items-center gap-1 transition-colors"
                                        >
                                            View on arXiv
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                        </a>
                                    </div>

                                    <div>
                                        <h3 className="text-sm font-bold text-[var(--text-primary)] leading-snug mb-2">
                                            {selectedNode.label}
                                        </h3>

                                        <div className="text-xs text-[var(--text-secondary)] leading-relaxed max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                                            {selectedNode.content ? (
                                                <p>{selectedNode.content}</p>
                                            ) : (
                                                <p className="italic text-[var(--text-tertiary)]">
                                                    No abstract available.
                                                </p>
                                            )}
                                        </div>
                                    </div>

                                    <div className="pt-3 border-t border-[var(--border-secondary)] space-y-2">
                                        <div className="flex items-center justify-between text-[10px]">
                                            <span className="text-[var(--text-tertiary)]">Connections</span>
                                            <span className="font-medium text-[var(--text-secondary)]">
                                                {hasOutgoingLinks(selectedNode.id) ? "Has Citations" : "Leaf Node"}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center py-8 text-center space-y-3">
                                    <div className="w-12 h-12 rounded-xl bg-[var(--bg-tertiary)] flex items-center justify-center">
                                        <svg className="w-6 h-6 text-[var(--text-tertiary)] opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p className="text-xs font-medium text-[var(--text-secondary)]">
                                            No paper selected
                                        </p>
                                        <p className="text-[10px] text-[var(--text-tertiary)] mt-1">
                                            Click a node to view details
                                        </p>
                                    </div>
                                </div>
                            )}
                        </aside>
                    </div>

                </div>

                {/* BOTTOM LEFT: Controls Help */}
                <div className="mt-auto pointer-events-auto self-start">
                    <div className="glass-card inline-flex items-center gap-3 px-4 py-2 rounded-full text-[10px] font-medium text-[var(--text-secondary)] border border-white/10 shadow-lg backdrop-blur-xl bg-[#0a0a0a]/60">
                        {activeRenderer === "3d" ? (
                            <>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]"></span>
                                    Left click to rotate
                                </div>
                                <div className="w-px h-3 bg-white/10"></div>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]"></span>
                                    Scroll to zoom
                                </div>
                                <div className="w-px h-3 bg-white/10"></div>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]"></span>
                                    Click node to fly
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]"></span>
                                    Hover nodes to inspect graph
                                </div>
                                <div className="w-px h-3 bg-white/10"></div>
                                <div className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-primary)]"></span>
                                    Click node to open details
                                </div>
                            </>
                        )}
                    </div>
                </div>

            </div>
        </>
    );
}
