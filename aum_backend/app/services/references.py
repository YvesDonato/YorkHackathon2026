import xml.etree.ElementTree as ET
from typing import Any

import httpx

from app.services.arxiv import fetch_arxiv_papers_batch

SEMANTIC_SCHOLAR_API_URL = "https://api.semanticscholar.org/graph/v1/paper"


async def fetch_references(paper_id: str) -> list[dict[str, Any]]:
    url = f"{SEMANTIC_SCHOLAR_API_URL}/ArXiv:{paper_id}"
    params = {"fields": "references.title,references.externalIds,references.url"}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(url, params=params)
    response.raise_for_status()
    data = response.json()

    refs: list[dict[str, Any]] = []
    arxiv_ids: list[str] = []
    for ref in data.get("references", []):
        ext_ids = ref.get("externalIds") or {}
        entry: dict[str, Any] = {"title": ref.get("title", "")}
        if ext_ids.get("ArXiv"):
            entry["arxiv_id"] = ext_ids["ArXiv"]
            entry["arxiv_url"] = f"https://arxiv.org/abs/{ext_ids['ArXiv']}"
            arxiv_ids.append(ext_ids["ArXiv"])
        if ext_ids.get("DOI"):
            entry["doi_url"] = f"https://doi.org/{ext_ids['DOI']}"
        if ref.get("url"):
            entry["semantic_scholar_url"] = ref["url"]
        refs.append(entry)

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
