from __future__ import annotations

import logging
from datetime import datetime, timezone
from math import sqrt
from typing import Any

import httpx
from fastapi import FastAPI

from app.services.arxiv import fetch_arxiv_paper, normalize_whitespace
from app.services.gemini import ExternalServiceError
from app.services.references import fetch_references, summarize_references_error

logger = logging.getLogger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _trim_text(value: str, limit: int) -> str:
    normalized = normalize_whitespace(value)
    return normalized[:limit]


async def _upsert_paper(app: FastAPI, paper_id: str, updates: dict[str, Any]) -> None:
    now = _utc_now()
    updates["updated_at"] = now
    await app.state.mongo.collection.update_one(
        {"paper_id": paper_id},
        {"$set": updates, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )


async def process_arxiv_paper(app: FastAPI, paper_id: str, link: str) -> None:
    logger.info("Starting arXiv processing for %s", paper_id)
    warnings: list[str] = []
    errors: list[str] = []
    references: list[dict[str, Any]] = []
    references_error: str | None = None
    title = ""
    summary = ""
    url: str | None = None
    published: str | None = None
    authors: list[str] = []
    embedding: list[float] | None = None
    embedding_status: str = "skipped"

    try:
        paper = await fetch_arxiv_paper(paper_id)
    except (httpx.HTTPError, Exception) as exc:
        errors.append(f"Failed to fetch arXiv metadata: {exc}")
        await _upsert_paper(
            app,
            paper_id,
            {
                "paper_id": paper_id,
                "source": "arxiv",
                "input_link": link,
                "title": paper_id,
                "url": None,
                "published": None,
                "authors": [],
                "summary": "",
                "references": [],
                "references_error": None,
                "embedding": None,
                "embedding_dims": None,
                "embedding_status": "failed",
                "processed": True,
                "warnings": warnings,
                "errors": errors,
            },
        )
        logger.error("arXiv processing failed for %s", paper_id)
        return

    if not paper:
        errors.append(f"No paper found for ID '{paper_id}'")
        await _upsert_paper(
            app,
            paper_id,
            {
                "paper_id": paper_id,
                "source": "arxiv",
                "input_link": link,
                "title": paper_id,
                "url": None,
                "published": None,
                "authors": [],
                "summary": "",
                "references": [],
                "references_error": None,
                "embedding": None,
                "embedding_dims": None,
                "embedding_status": "failed",
                "processed": True,
                "warnings": warnings,
                "errors": errors,
            },
        )
        return

    title = str(paper.get("title", "")).strip() or paper_id
    summary = str(paper.get("summary", "")).strip()
    url = paper.get("url")
    published = paper.get("published")
    authors = [str(a).strip() for a in (paper.get("authors") or []) if str(a).strip()]
    logger.info("Fetched arXiv metadata for %s", paper_id)

    try:
        references = await fetch_references(paper_id)
        logger.info("Fetched %d references for %s", len(references), paper_id)
    except Exception as exc:
        references = []
        references_error = summarize_references_error(exc)
        warnings.append(references_error)
        logger.warning("Reference fetch degraded for %s: %s", paper_id, references_error)

    embed_text = _trim_text(f"{title}\n\n{summary}", 6000)
    try:
        embedding = await app.state.gemini.embed_text(embed_text)
        embedding_status = "ok"
        logger.info("Embedding generated for %s", paper_id)
    except ExternalServiceError as exc:
        embedding = None
        embedding_status = "failed"
        warnings.append(f"Embedding failed: {exc}")
        errors.append(f"Embedding failed: {exc}")
        logger.warning("Embedding failed for %s: %s", paper_id, exc)

    await _upsert_paper(
        app,
        paper_id,
        {
            "paper_id": paper_id,
            "source": "arxiv",
            "input_link": link,
            "title": title,
            "url": url,
            "published": published,
            "authors": authors,
            "summary": summary,
            "references": references,
            "references_error": references_error,
            "embedding": embedding,
            "embedding_dims": len(embedding) if embedding else None,
            "embedding_status": embedding_status,
            "processed": True,
            "warnings": warnings,
            "errors": errors,
        },
    )
    logger.info("Completed arXiv processing for %s", paper_id)


async def process_pdf_paper(app: FastAPI, paper_id: str, pdf_text: str, link: str | None) -> None:
    logger.info("Starting PDF processing for %s", paper_id)
    warnings: list[str] = []
    errors: list[str] = []
    references: list[dict[str, Any]] = []
    references_error: str | None = None
    title = "Uploaded PDF"
    summary = _trim_text(pdf_text, 800)
    url: str | None = None
    published: str | None = None
    authors: list[str] = []
    embedding: list[float] | None = None
    embedding_status = "skipped"

    if link:
        try:
            paper = await fetch_arxiv_paper(paper_id)
            if paper:
                title = str(paper.get("title", "")).strip() or title
                summary = str(paper.get("summary", "")).strip() or summary
                url = paper.get("url")
                published = paper.get("published")
                authors = [str(a).strip() for a in (paper.get("authors") or []) if str(a).strip()]
                try:
                    references = await fetch_references(paper_id)
                except Exception as exc:
                    references_error = summarize_references_error(exc)
                    warnings.append(references_error)
            else:
                warnings.append("Linked arXiv metadata not found; using PDF-derived metadata")
        except Exception as exc:
            warnings.append(f"Linked metadata fetch failed: {exc}")
    else:
        warnings.append("Metadata inferred from PDF text only")

    embed_source = _trim_text(pdf_text, 6000) or _trim_text(f"{title}\n\n{summary}", 6000)
    try:
        embedding = await app.state.gemini.embed_text(embed_source)
        embedding_status = "ok"
    except ExternalServiceError as exc:
        embedding_status = "failed"
        errors.append(f"Embedding failed: {exc}")
        warnings.append(f"Embedding failed: {exc}")

    await _upsert_paper(
        app,
        paper_id,
        {
            "paper_id": paper_id,
            "source": "pdf",
            "input_link": link,
            "title": title,
            "url": url,
            "published": published,
            "authors": authors,
            "summary": summary,
            "references": references,
            "references_error": references_error,
            "embedding": embedding,
            "embedding_dims": len(embedding) if embedding else None,
            "embedding_status": embedding_status,
            "processed": True,
            "warnings": warnings,
            "errors": errors,
        },
    )
    logger.info("Completed PDF processing for %s", paper_id)


def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = sqrt(sum(a * a for a in vec_a))
    norm_b = sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)
