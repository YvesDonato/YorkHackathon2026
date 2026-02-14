import os
import xml.etree.ElementTree as ET
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from auth import get_current_user, router as auth_router, validate_auth_config
from database import close_db, connect_db, get_db
from papers import (
    cosine_similarity,
    find_similar_papers_via_search,
    generate_embedding,
    generate_embeddings_batch,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage database connection lifecycle."""
    validate_auth_config()
    await connect_db()
    yield
    await close_db()


app = FastAPI(title="arXiv Paper API", lifespan=lifespan)

ARXIV_API_URL = "https://export.arxiv.org/api/query"
SEMANTIC_SCHOLAR_API_URL = "https://api.semanticscholar.org/graph/v1/paper"

ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}
RAW_FRONTEND_ORIGINS = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
FRONTEND_ORIGINS = [
    origin.strip() for origin in RAW_FRONTEND_ORIGINS.split(",") if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth_router)


@app.get("/healthz")
async def healthz():
    if get_db() is None:
        raise HTTPException(status_code=503, detail="Database not initialized")
    return {"status": "ok"}


# Include routers
app.include_router(auth_router)


class GraphNode(BaseModel):
    id: str
    label: str
    content: str
    url: str | None = None
    published: str | None = None
    authors: list[str] = Field(default_factory=list)
    summary: str = ""
    is_root: bool = False


class GraphLink(BaseModel):
    source: str
    target: str
    similarity: float | None = None


class GraphResponse(BaseModel):
    seed_id: str
    nodes: list[GraphNode]
    links: list[GraphLink]
    partial_data: bool = False
    references_error: str | None = None


class SessionCreate(BaseModel):
    seed_paper_link: str
    mode: str = "grounding"
    title: str | None = None


class SessionUpdate(BaseModel):
    title: str | None = None


class SessionResponse(BaseModel):
    id: str
    user_id: str
    title: str | None
    seed_paper_id: str
    mode: str
    created_at: str
    last_accessed: str


def normalize_whitespace(value: str) -> str:
    return " ".join(value.split())


async def fetch_arxiv_paper(paper_id: str) -> dict[str, Any] | None:
    params = {"id_list": paper_id}
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(ARXIV_API_URL, params=params)
    response.raise_for_status()

    root = ET.fromstring(response.text)
    entry = root.find("atom:entry", ATOM_NS)

    if entry is None:
        return None

    title = normalize_whitespace(entry.findtext("atom:title", default="", namespaces=ATOM_NS))
    url = normalize_whitespace(entry.findtext("atom:id", default="", namespaces=ATOM_NS))
    published = normalize_whitespace(
        entry.findtext("atom:published", default="", namespaces=ATOM_NS)
    )
    summary = normalize_whitespace(
        entry.findtext("atom:summary", default="", namespaces=ATOM_NS)
    )
    authors = [
        normalize_whitespace(a.findtext("atom:name", default="", namespaces=ATOM_NS))
        for a in entry.findall("atom:author", ATOM_NS)
    ]

    return {
        "title": title,
        "url": url,
        "published": published,
        "authors": authors,
        "summary": summary,
    }


async def fetch_arxiv_papers_batch(paper_ids: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch metadata for multiple arXiv papers in one request."""
    if not paper_ids:
        return {}
    params = {"id_list": ",".join(paper_ids), "max_results": len(paper_ids)}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(ARXIV_API_URL, params=params)
    response.raise_for_status()

    root = ET.fromstring(response.text)
    results = {}
    for entry in root.findall("atom:entry", ATOM_NS):
        entry_id = normalize_whitespace(entry.findtext("atom:id", default="", namespaces=ATOM_NS))
        # Extract the arXiv ID from the full URL (e.g. http://arxiv.org/abs/1706.03762v5 -> 1706.03762)
        arxiv_id = entry_id.split("/abs/")[-1].split("v")[0] if "/abs/" in entry_id else entry_id
        title = normalize_whitespace(entry.findtext("atom:title", default="", namespaces=ATOM_NS))
        if not title or title.startswith("Error"):
            continue
        results[arxiv_id] = {
            "title": title,
            "url": entry_id,
            "published": normalize_whitespace(
                entry.findtext("atom:published", default="", namespaces=ATOM_NS)
            ),
            "authors": [
                normalize_whitespace(a.findtext("atom:name", default="", namespaces=ATOM_NS))
                for a in entry.findall("atom:author", ATOM_NS)
            ],
            "summary": normalize_whitespace(
                entry.findtext("atom:summary", default="", namespaces=ATOM_NS)
            ),
        }
    return results


def extract_paper_id(link: str) -> str:
    """Extract paper ID from an arXiv link or raw ID."""
    if "/abs/" in link:
        return link.split("/abs/")[-1].rstrip("/")
    if "/pdf/" in link:
        return link.split("/pdf/")[-1].replace(".pdf", "")
    return link


def canonicalize_paper_id(value: str) -> str:
    paper_id = extract_paper_id(value.strip())

    if paper_id.lower().startswith("arxiv:"):
        paper_id = paper_id.split(":", maxsplit=1)[1]

    base, separator, suffix = paper_id.rpartition("v")
    if separator and base and suffix.isdigit():
        paper_id = base

    return paper_id.strip()


def build_root_node(paper_id: str, paper: dict[str, Any]) -> GraphNode:
    title = normalize_whitespace(str(paper.get("title", "")).strip()) or paper_id
    summary = normalize_whitespace(str(paper.get("summary", "")).strip())
    published = normalize_whitespace(str(paper.get("published", "")).strip()) or None
    url = normalize_whitespace(str(paper.get("url", "")).strip()) or f"https://arxiv.org/abs/{paper_id}"

    authors_raw = paper.get("authors") or []
    authors = [normalize_whitespace(str(author)) for author in authors_raw if str(author).strip()]

    return GraphNode(
        id=paper_id,
        label=title,
        content=summary or f"arXiv paper {paper_id}",
        url=url,
        published=published,
        authors=authors,
        summary=summary,    
        is_root=True,
    )


async def fetch_references(paper_id: str) -> list[dict[str, Any]]:
    """Fetch referenced papers via Semantic Scholar, enriched with arXiv metadata."""
    url = f"{SEMANTIC_SCHOLAR_API_URL}/ArXiv:{paper_id}"
    params = {"fields": "references.title,references.externalIds,references.url"}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(url, params=params)
    response.raise_for_status()
    data = response.json()

    refs = []
    arxiv_ids = []
    for ref in data.get("references", []):
        ext_ids = ref.get("externalIds") or {}
        entry = {"title": ref.get("title", "")}
        if ext_ids.get("ArXiv"):
            entry["arxiv_id"] = ext_ids["ArXiv"]
            entry["arxiv_url"] = f"https://arxiv.org/abs/{ext_ids['ArXiv']}"
            arxiv_ids.append(ext_ids["ArXiv"])
        if ext_ids.get("DOI"):
            entry["doi_url"] = f"https://doi.org/{ext_ids['DOI']}"
        if ref.get("url"):
            entry["semantic_scholar_url"] = ref["url"]
        refs.append(entry)

    # Batch-fetch arXiv metadata for all references that have arXiv IDs
    if arxiv_ids:
        try:
            arxiv_meta = await fetch_arxiv_papers_batch(arxiv_ids)
        except (httpx.HTTPError, ET.ParseError):
            arxiv_meta = {}
        for entry in refs:
            aid = entry.pop("arxiv_id", None)
            if aid and aid in arxiv_meta:
                meta = arxiv_meta[aid]
                entry["title"] = meta["title"]
                entry["url"] = meta["url"]
                entry["published"] = meta["published"]
                entry["authors"] = meta["authors"]
                entry["summary"] = meta["summary"]

    return refs


def summarize_references_error(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        if status_code == 429:
            retry_after = exc.response.headers.get("Retry-After")
            if retry_after:
                return (
                    "Semantic Scholar rate limit reached (HTTP 429). "
                    f"Retry-After: {retry_after}."
                )
            return "Semantic Scholar rate limit reached (HTTP 429). Try again shortly."
        return f"Semantic Scholar request failed with HTTP {status_code}."

    if isinstance(exc, httpx.TimeoutException):
        return "Timed out while fetching references from Semantic Scholar."

    if isinstance(exc, httpx.HTTPError):
        return "Failed to fetch references from Semantic Scholar."

    if isinstance(exc, ET.ParseError):
        return "Failed to parse reference metadata from arXiv."

    return "Failed to fetch references."


def extract_reference_paper_id(reference: dict[str, Any]) -> str | None:
    url_candidate = reference.get("url") or reference.get("arxiv_url")
    if not isinstance(url_candidate, str) or not url_candidate.strip():
        return None
    paper_id = canonicalize_paper_id(url_candidate)
    return paper_id or None


def build_reference_node(reference: dict[str, Any]) -> GraphNode | None:
    paper_id = extract_reference_paper_id(reference)
    if not paper_id:
        return None

    title = normalize_whitespace(str(reference.get("title", "")).strip()) or paper_id
    summary = normalize_whitespace(str(reference.get("summary", "")).strip())
    published = normalize_whitespace(str(reference.get("published", "")).strip()) or None
    url = normalize_whitespace(
        str(reference.get("url") or reference.get("arxiv_url") or "").strip()
    ) or f"https://arxiv.org/abs/{paper_id}"

    authors_raw = reference.get("authors") or []
    authors = [normalize_whitespace(str(author)) for author in authors_raw if str(author).strip()]

    return GraphNode(
        id=paper_id,
        label=title,
        content=summary or f"Referenced paper {paper_id}",
        url=url,
        published=published,
        authors=authors,
        summary=summary,
        is_root=False,
    )


async def _generate_graph_internal(
    paper_id: str,
    mode: str,
) -> tuple[GraphResponse, list[GraphNode], list[list[float]]]:
    """Internal helper to generate a graph for a given paper.
    
    Returns (GraphResponse, nodes, embeddings) for use by session creation.
    """
    if mode not in ("grounding", "references"):
        raise HTTPException(status_code=422, detail="mode must be 'grounding' or 'references'")

    try:
        seed_paper = await fetch_arxiv_paper(paper_id)
    except (httpx.HTTPError, ET.ParseError) as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch seed paper: {exc}")

    if not seed_paper:
        raise HTTPException(status_code=404, detail=f"No paper found for ID '{paper_id}'")

    # ── Discover related papers ──────────────────────────────────────────
    root_node = build_root_node(paper_id, seed_paper)
    nodes = [root_node]
    seen_node_ids = {root_node.id}
    discovery_error: str | None = None

    if mode == "grounding":
        # Google Search grounding
        seed_title = seed_paper.get("title", "")
        seed_summary = seed_paper.get("summary", "")

        discovered: list[dict] = []
        try:
            discovered = await find_similar_papers_via_search(seed_title, seed_summary)
        except Exception as exc:
            discovery_error = f"Google Search grounding failed: {exc}"

        # Batch-fetch arXiv metadata for discovered paper IDs
        discovered_ids = [d["arxiv_id"] for d in discovered]
        discovered_meta: dict[str, dict[str, Any]] = {}
        if discovered_ids:
            try:
                discovered_meta = await fetch_arxiv_papers_batch(discovered_ids)
            except (httpx.HTTPError, ET.ParseError):
                discovered_meta = {}

        for disc in discovered:
            aid = disc["arxiv_id"]
            if aid in seen_node_ids or aid == root_node.id:
                continue

            meta = discovered_meta.get(aid)
            if meta:
                title = normalize_whitespace(str(meta.get("title", "")).strip()) or aid
                summary = normalize_whitespace(str(meta.get("summary", "")).strip())
                published = normalize_whitespace(str(meta.get("published", "")).strip()) or None
                url = normalize_whitespace(str(meta.get("url", "")).strip()) or f"https://arxiv.org/abs/{aid}"
                authors_raw = meta.get("authors") or []
                authors = [normalize_whitespace(str(a)) for a in authors_raw if str(a).strip()]
            else:
                title = disc.get("title", aid)
                summary = ""
                published = None
                url = f"https://arxiv.org/abs/{aid}"
                authors = []

            nodes.append(GraphNode(
                id=aid,
                label=title,
                content=summary or f"Related paper {aid}",
                url=url,
                published=published,
                authors=authors,
                summary=summary,
                is_root=False,
            ))
            seen_node_ids.add(aid)

    else:
        # Semantic Scholar references
        references: list[dict[str, Any]] = []
        try:
            references = await fetch_references(paper_id)
        except (httpx.HTTPError, ET.ParseError) as exc:
            discovery_error = summarize_references_error(exc)

        for reference in references:
            node = build_reference_node(reference)
            if node is None or node.id == root_node.id:
                continue
            if node.id not in seen_node_ids:
                nodes.append(node)
                seen_node_ids.add(node.id)

    # ── Generate embeddings for all nodes in one batch ───────────────────
    summaries = [n.summary or n.content for n in nodes]
    try:
        embeddings = await generate_embeddings_batch(summaries)
    except Exception:
        embeddings = []

    # Map node id -> embedding for similarity computation
    node_embeddings: dict[str, list[float]] = {}
    for node, emb in zip(nodes, embeddings):
        node_embeddings[node.id] = emb

    # ── Persist papers to global graph_papers ─────────────────────────────
    db = get_db()
    now = datetime.now(timezone.utc)

    for node, emb in (zip(nodes, embeddings) if embeddings else []):
        await db.graph_papers.update_one(
            {"arxiv_id": node.id},
            {
                "$set": {
                    "title": node.label,
                    "summary": node.summary,
                    "url": node.url,
                    "authors": node.authors,
                    "published": node.published or "",
                    "embedding": emb,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )

    # ── Build links: k-nearest-neighbor similarity ────────────────────────
    K_NEIGHBORS = 3
    links: list[GraphLink] = []
    seen_link_keys: set[tuple[str, str]] = set()

    if node_embeddings:
        for i, node_a in enumerate(nodes):
            if node_a.id not in node_embeddings:
                continue
            similarities: list[tuple[int, float]] = []
            for j, node_b in enumerate(nodes):
                if i == j or node_b.id not in node_embeddings:
                    continue
                sim = cosine_similarity(node_embeddings[node_a.id], node_embeddings[node_b.id])
                similarities.append((j, sim))
            similarities.sort(key=lambda x: x[1], reverse=True)
            for j, sim in similarities[:K_NEIGHBORS]:
                key = tuple(sorted((node_a.id, nodes[j].id)))
                if key not in seen_link_keys:
                    links.append(GraphLink(source=node_a.id, target=nodes[j].id, similarity=round(sim, 4)))
                    seen_link_keys.add(key)

    graph_response = GraphResponse(
        seed_id=root_node.id,
        nodes=nodes,
        links=links,
        partial_data=discovery_error is not None,
        references_error=discovery_error,
    )
    
    return graph_response, nodes, embeddings


@app.get("/graph", response_model=GraphResponse)
async def get_graph(
    link: str = Query(..., description="Seed arXiv paper link or ID"),
    mode: str = Query("grounding", description="Discovery mode: 'grounding' (Google Search) or 'references' (Semantic Scholar)"),
    current_user: dict = Depends(get_current_user),
):
    """Return a similarity graph for a seed paper.

    Supports two discovery modes:
    - **grounding**: Uses Google Search grounding via Gemini to find similar papers.
    - **references**: Uses Semantic Scholar to fetch cited references.
    
    DEPRECATED: Use POST /sessions to create a session-based graph instead.
    """
    paper_id = canonicalize_paper_id(link)
    if not paper_id:
        raise HTTPException(status_code=422, detail="A valid arXiv link or ID is required")

    graph_response, _, _ = await _generate_graph_internal(paper_id, mode)
    return graph_response


class GraphSearchResult(BaseModel):
    arxiv_id: str
    title: str
    summary: str
    url: str
    authors: list[str] = Field(default_factory=list)
    published: str = ""
    similarity_score: float | None = None


# ─────────────────────────────────────────────────────────────────────────────
# Session CRUD Endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.post("/sessions", response_model=SessionResponse, status_code=201)
async def create_session(
    session_create: SessionCreate,
    current_user: dict = Depends(get_current_user),
):
    """Create a new graph exploration session."""
    paper_id = canonicalize_paper_id(session_create.seed_paper_link)
    if not paper_id:
        raise HTTPException(status_code=422, detail="A valid arXiv link or ID is required")

    # Generate graph using internal helper
    graph_response, nodes, _ = await _generate_graph_internal(paper_id, session_create.mode)

    # Create session document
    db = get_db()
    user_id = current_user["_id"]
    now = datetime.now(timezone.utc)

    session_doc = {
        "user_id": user_id,
        "title": session_create.title,
        "seed_paper_id": paper_id,
        "mode": session_create.mode,
        "created_at": now,
        "last_accessed": now,
    }
    result = await db.sessions.insert_one(session_doc)
    session_id = result.inserted_id

    # Link all papers to this session via session_papers
    for node in nodes:
        await db.session_papers.insert_one({
            "session_id": session_id,
            "arxiv_id": node.id,
            "is_seed": node.id == paper_id,
            "added_at": now,
        })

    return SessionResponse(
        id=str(session_id),
        user_id=str(user_id),
        title=session_create.title,
        seed_paper_id=paper_id,
        mode=session_create.mode,
        created_at=now.isoformat(),
        last_accessed=now.isoformat(),
    )


@app.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(
    current_user: dict = Depends(get_current_user),
):
    """List all sessions for the current user."""
    db = get_db()
    user_id = current_user["_id"]

    cursor = db.sessions.find({"user_id": user_id}).sort("last_accessed", -1)
    sessions = await cursor.to_list(length=None)

    return [
        SessionResponse(
            id=str(s["_id"]),
            user_id=str(s["user_id"]),
            title=s.get("title"),
            seed_paper_id=s["seed_paper_id"],
            mode=s["mode"],
            created_at=s["created_at"].isoformat(),
            last_accessed=s["last_accessed"].isoformat(),
        )
        for s in sessions
    ]


@app.get("/sessions/{session_id}", response_model=GraphResponse)
async def get_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Get a specific session's graph."""
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        oid = ObjectId(session_id)
    except InvalidId:
        raise HTTPException(status_code=422, detail="Invalid session ID format")

    db = get_db()
    user_id = current_user["_id"]

    # Fetch session
    session = await db.sessions.find_one({"_id": oid, "user_id": user_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Update last_accessed
    await db.sessions.update_one(
        {"_id": oid},
        {"$set": {"last_accessed": datetime.now(timezone.utc)}},
    )

    # Fetch all papers in this session
    session_paper_docs = await db.session_papers.find({"session_id": oid}).to_list(length=None)
    arxiv_ids = [sp["arxiv_id"] for sp in session_paper_docs]

    if not arxiv_ids:
        raise HTTPException(status_code=404, detail="No papers found for this session")

    # Fetch paper metadata and embeddings from graph_papers
    paper_docs = await db.graph_papers.find({"arxiv_id": {"$in": arxiv_ids}}).to_list(length=None)
    
    # Build nodes
    seed_id = session["seed_paper_id"]
    nodes: list[GraphNode] = []
    node_embeddings: dict[str, list[float]] = {}

    for paper in paper_docs:
        node = GraphNode(
            id=paper["arxiv_id"],
            label=paper["title"],
            content=paper.get("summary", ""),
            url=paper.get("url"),
            published=paper.get("published"),
            authors=paper.get("authors", []),
            summary=paper.get("summary", ""),
            is_root=(paper["arxiv_id"] == seed_id),
        )
        nodes.append(node)
        if "embedding" in paper:
            node_embeddings[paper["arxiv_id"]] = paper["embedding"]

    # Build k-NN links
    K_NEIGHBORS = 3
    links: list[GraphLink] = []
    seen_link_keys: set[tuple[str, str]] = set()

    if node_embeddings:
        for i, node_a in enumerate(nodes):
            if node_a.id not in node_embeddings:
                continue
            similarities: list[tuple[int, float]] = []
            for j, node_b in enumerate(nodes):
                if i == j or node_b.id not in node_embeddings:
                    continue
                sim = cosine_similarity(node_embeddings[node_a.id], node_embeddings[node_b.id])
                similarities.append((j, sim))
            similarities.sort(key=lambda x: x[1], reverse=True)
            for j, sim in similarities[:K_NEIGHBORS]:
                key = tuple(sorted((node_a.id, nodes[j].id)))
                if key not in seen_link_keys:
                    links.append(GraphLink(source=node_a.id, target=nodes[j].id, similarity=round(sim, 4)))
                    seen_link_keys.add(key)

    return GraphResponse(
        seed_id=seed_id,
        nodes=nodes,
        links=links,
        partial_data=False,
        references_error=None,
    )


@app.patch("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(
    session_id: str,
    session_update: SessionUpdate,
    current_user: dict = Depends(get_current_user),
):
    """Update session metadata (e.g., title)."""
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        oid = ObjectId(session_id)
    except InvalidId:
        raise HTTPException(status_code=422, detail="Invalid session ID format")

    db = get_db()
    user_id = current_user["_id"]

    # Fetch session
    session = await db.sessions.find_one({"_id": oid, "user_id": user_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Update title if provided
    update_fields = {}
    if session_update.title is not None:
        update_fields["title"] = session_update.title

    if update_fields:
        await db.sessions.update_one({"_id": oid}, {"$set": update_fields})
        session.update(update_fields)

    return SessionResponse(
        id=str(session["_id"]),
        user_id=str(session["user_id"]),
        title=session.get("title"),
        seed_paper_id=session["seed_paper_id"],
        mode=session["mode"],
        created_at=session["created_at"].isoformat(),
        last_accessed=session["last_accessed"].isoformat(),
    )


@app.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Delete a session (removes session and session_papers links, but keeps global papers)."""
    from bson import ObjectId
    from bson.errors import InvalidId

    try:
        oid = ObjectId(session_id)
    except InvalidId:
        raise HTTPException(status_code=422, detail="Invalid session ID format")

    db = get_db()
    user_id = current_user["_id"]

    # Verify ownership
    session = await db.sessions.find_one({"_id": oid, "user_id": user_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Delete session_papers links
    await db.session_papers.delete_many({"session_id": oid})

    # Delete session
    await db.sessions.delete_one({"_id": oid})

    return None


@app.get("/graph/search", response_model=list[GraphSearchResult])
async def graph_search(
    q: str = Query(..., description="Search query"),
    limit: int = Query(10, ge=1, le=50),
    current_user: dict = Depends(get_current_user),
):
    """Semantic search over all graph papers using Atlas Vector Search."""
    query_embedding = await generate_embedding(q)
    db = get_db()

    pipeline = [
        {
            "$vectorSearch": {
                "index": "graph_vector_index",
                "path": "embedding",
                "queryVector": query_embedding,
                "numCandidates": limit * 10,
                "limit": limit,
            }
        },
        {"$addFields": {"score": {"$meta": "vectorSearchScore"}}},
    ]

    results = []
    async for doc in db.graph_papers.aggregate(pipeline):
        results.append(
            GraphSearchResult(
                arxiv_id=doc["arxiv_id"],
                title=doc["title"],
                summary=doc.get("summary", ""),
                url=doc.get("url", ""),
                authors=doc.get("authors", []),
                published=doc.get("published", ""),
                similarity_score=doc.get("score"),
            )
        )
    return results


class PaperSearchResult(BaseModel):
    arxiv_id: str
    title: str
    url: str
    summary: str
    authors: list[str] = Field(default_factory=list)
    published: str = ""


@app.get("/paper", response_model=list[PaperSearchResult])
async def search_papers(
    q: str = Query(..., description="Natural language search query"),
    max_results: int = Query(10, ge=1, le=50, description="Maximum number of results")
):
    """Search arXiv papers using natural language queries."""
    # arXiv search API uses search_query parameter
    params = {
        "search_query": f"all:{q}",  # search across all fields
        "max_results": max_results,
        "sortBy": "relevance",
        "sortOrder": "descending"
    }
    
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(ARXIV_API_URL, params=params)
    
    response.raise_for_status()
    root = ET.fromstring(response.text)
    
    results = []
    for entry in root.findall("atom:entry", ATOM_NS):
        entry_id = normalize_whitespace(entry.findtext("atom:id", default="", namespaces=ATOM_NS))
        # Extract arXiv ID from URL
        arxiv_id = entry_id.split("/abs/")[-1].split("v")[0] if "/abs/" in entry_id else entry_id
        
        title = normalize_whitespace(entry.findtext("atom:title", default="", namespaces=ATOM_NS))
        if not title or title.startswith("Error"):
            continue
            
        results.append(PaperSearchResult(
            arxiv_id=arxiv_id,
            title=title,
            url=entry_id,
            summary=normalize_whitespace(entry.findtext("atom:summary", default="", namespaces=ATOM_NS)),
            authors=[
                normalize_whitespace(a.findtext("atom:name", default="", namespaces=ATOM_NS))
                for a in entry.findall("atom:author", ATOM_NS)
            ],
            published=normalize_whitespace(entry.findtext("atom:published", default="", namespaces=ATOM_NS))
        ))
    
    return results


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
