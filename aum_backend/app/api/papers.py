import hashlib
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, UploadFile
from fastapi.params import File, Form
from pydantic import BaseModel, Field
from pymongo import DESCENDING

from app.models.paper import IngestLinkRequest, PaperResponse, PaperStatusResponse
from app.services.arxiv import (
    canonicalize_paper_id,
    extract_paper_id,
    fetch_arxiv_paper,
    fetch_arxiv_papers_batch,
    normalize_whitespace,
)
from app.services.gemini import ExternalServiceError
from app.services.ingest import cosine_similarity, process_arxiv_paper, process_pdf_paper
from app.services.pdf_extract import extract_pdf_text
from app.services.references import fetch_references, summarize_references_error

router = APIRouter(tags=["papers"])
logger = logging.getLogger(__name__)


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


class GraphResponse(BaseModel):
    seed_id: str
    nodes: list[GraphNode]
    links: list[GraphLink]
    partial_data: bool = False
    references_error: str | None = None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_doc(doc: dict[str, Any]) -> dict[str, Any]:
    clean = dict(doc)
    clean.pop("_id", None)
    return clean


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


@router.post("/papers/ingest", status_code=202)
async def ingest_paper_by_link(
    payload: IngestLinkRequest,
    request: Request,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    paper_id = canonicalize_paper_id(payload.link)
    if not paper_id:
        raise HTTPException(status_code=422, detail="A valid arXiv link or ID is required")

    now = _utc_now()
    await request.app.state.mongo.collection.update_one(
        {"paper_id": paper_id},
        {
            "$set": {
                "paper_id": paper_id,
                "source": "arxiv",
                "input_link": payload.link,
                "title": paper_id,
                "url": None,
                "published": None,
                "authors": [],
                "summary": "",
                "references": [],
                "references_error": None,
                "embedding": None,
                "embedding_dims": None,
                "embedding_status": "skipped",
                "processed": False,
                "warnings": [],
                "errors": [],
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    logger.info("Queued arXiv ingest for %s", paper_id)
    background_tasks.add_task(process_arxiv_paper, request.app, paper_id, payload.link)
    return {"ok": True, "paper_id": paper_id, "processed": False}


@router.post("/papers/upload", status_code=202)
async def upload_paper_pdf(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    link: str | None = Form(None),
) -> dict[str, Any]:
    payload_bytes = await file.read()
    if not payload_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    if link:
        paper_id = canonicalize_paper_id(link)
        if not paper_id:
            raise HTTPException(status_code=422, detail="Provided link is not a valid arXiv link or ID")
    else:
        digest = hashlib.sha256(payload_bytes[:1024 * 1024]).hexdigest()
        paper_id = f"pdf_{digest}"

    pdf_text, extraction_warnings = extract_pdf_text(payload_bytes)

    now = _utc_now()
    await request.app.state.mongo.collection.update_one(
        {"paper_id": paper_id},
        {
            "$set": {
                "paper_id": paper_id,
                "source": "pdf",
                "input_link": link,
                "title": "Uploaded PDF",
                "url": None,
                "published": None,
                "authors": [],
                "summary": normalize_whitespace(pdf_text)[:800],
                "references": [],
                "references_error": None,
                "embedding": None,
                "embedding_dims": None,
                "embedding_status": "skipped",
                "processed": False,
                "warnings": extraction_warnings,
                "errors": [],
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    logger.info("Queued PDF ingest for %s", paper_id)
    background_tasks.add_task(process_pdf_paper, request.app, paper_id, pdf_text, link)
    return {"ok": True, "paper_id": paper_id, "processed": False}


@router.get("/papers/search")
async def search_papers(
    request: Request,
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
) -> dict[str, Any]:
    collection = request.app.state.mongo.collection

    try:
        query_embedding = await request.app.state.gemini.embed_text(q)
        cursor = (
            collection.find(
                {"embedding_status": "ok", "embedding": {"$type": "array"}},
                {"paper_id": 1, "title": 1, "url": 1, "embedding": 1, "updated_at": 1},
            )
            .sort("updated_at", DESCENDING)
            .limit(200)
        )
        docs = await cursor.to_list(length=200)
        scored: list[dict[str, Any]] = []
        for doc in docs:
            embedding = doc.get("embedding")
            if not isinstance(embedding, list):
                continue
            try:
                vector = [float(v) for v in embedding]
            except (TypeError, ValueError):
                continue
            score = cosine_similarity(query_embedding, vector)
            scored.append(
                {
                    "paper_id": doc.get("paper_id"),
                    "title": doc.get("title"),
                    "url": doc.get("url"),
                    "score": score,
                }
            )
        scored.sort(key=lambda item: item["score"], reverse=True)
        return {"ok": True, "mode": "embedding", "results": scored[:limit]}
    except ExternalServiceError:
        regex = {"$regex": q, "$options": "i"}
        docs = (
            await collection.find(
                {"$or": [{"title": regex}, {"summary": regex}]},
                {"paper_id": 1, "title": 1, "url": 1},
            )
            .sort("updated_at", DESCENDING)
            .limit(limit)
            .to_list(length=limit)
        )
        return {
            "ok": True,
            "mode": "text",
            "results": [
                {"paper_id": d.get("paper_id"), "title": d.get("title"), "url": d.get("url")}
                for d in docs
            ],
        }


@router.get("/papers/{paper_id}", response_model=PaperResponse)
async def get_stored_paper(request: Request, paper_id: str) -> PaperResponse:
    doc = await request.app.state.mongo.collection.find_one({"paper_id": paper_id})
    if not doc:
        raise HTTPException(status_code=404, detail=f"Paper '{paper_id}' not found")
    serialized = _serialize_doc(doc)
    serialized.pop("embedding", None)
    return PaperResponse.model_validate(serialized)


@router.get("/papers/{paper_id}/status", response_model=PaperStatusResponse)
async def get_stored_paper_status(request: Request, paper_id: str) -> PaperStatusResponse:
    doc = await request.app.state.mongo.collection.find_one(
        {"paper_id": paper_id},
        {"paper_id": 1, "processed": 1, "embedding_status": 1, "warnings": 1, "errors": 1, "updated_at": 1},
    )
    if not doc:
        raise HTTPException(status_code=404, detail=f"Paper '{paper_id}' not found")
    return PaperStatusResponse.model_validate(_serialize_doc(doc))


@router.get("/graph", response_model=GraphResponse)
async def get_graph(link: str = Query(..., description="Seed arXiv paper link or ID")):
    paper_id = canonicalize_paper_id(link)
    if not paper_id:
        raise HTTPException(status_code=422, detail="A valid arXiv link or ID is required")

    try:
        seed_paper = await fetch_arxiv_paper(paper_id)
    except (httpx.HTTPError, ET.ParseError) as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch seed paper: {exc}")

    if not seed_paper:
        raise HTTPException(status_code=404, detail=f"No paper found for ID '{paper_id}'")

    references: list[dict[str, Any]] = []
    references_error: str | None = None
    try:
        references = await fetch_references(paper_id)
    except (httpx.HTTPError, ET.ParseError) as exc:
        references_error = summarize_references_error(exc)

    root_node = build_root_node(paper_id, seed_paper)
    nodes = [root_node]
    links: list[GraphLink] = []
    seen_node_ids = {root_node.id}
    seen_link_keys: set[tuple[str, str]] = set()

    for reference in references:
        node = build_reference_node(reference)
        if node is None or node.id == root_node.id:
            continue

        if node.id not in seen_node_ids:
            nodes.append(node)
            seen_node_ids.add(node.id)

        link_key = (root_node.id, node.id)
        if link_key not in seen_link_keys:
            links.append(GraphLink(source=root_node.id, target=node.id))
            seen_link_keys.add(link_key)

    return GraphResponse(
        seed_id=root_node.id,
        nodes=nodes,
        links=links,
        partial_data=references_error is not None,
        references_error=references_error,
    )


@router.get("/paper")
async def get_paper(link: str = Query(..., description="arXiv paper link or ID")):
    paper_id = canonicalize_paper_id(link)

    try:
        result = await fetch_arxiv_paper(paper_id)
    except (httpx.HTTPError, ET.ParseError) as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch paper: {exc}")

    if not result:
        raise HTTPException(status_code=404, detail=f"No paper found for ID '{paper_id}'")

    try:
        result["references"] = await fetch_references(paper_id)
    except httpx.HTTPError as exc:
        result["references"] = []
        result["references_error"] = f"Failed to fetch references: {exc}"

    return result
