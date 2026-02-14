import os
import xml.etree.ElementTree as ET
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="arXiv Paper API")

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
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


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


@app.get("/graph", response_model=GraphResponse)
async def get_graph(link: str = Query(..., description="Seed arXiv paper link or ID")):
    """Return a citation graph for a seed paper.

    If reference enrichment fails (for example due to API rate limits), this endpoint
    still returns HTTP 200 with a root-only graph and warning metadata.
    """
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


@app.get("/paper")
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
