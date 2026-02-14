import xml.etree.ElementTree as ET
from typing import Any

import httpx

ARXIV_API_URL = "https://export.arxiv.org/api/query"
ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}


def normalize_whitespace(value: str) -> str:
    return " ".join(value.split())


def extract_paper_id(link: str) -> str:
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
    summary = normalize_whitespace(entry.findtext("atom:summary", default="", namespaces=ATOM_NS))
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
    if not paper_ids:
        return {}

    params = {"id_list": ",".join(paper_ids), "max_results": len(paper_ids)}
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(ARXIV_API_URL, params=params)
    response.raise_for_status()

    root = ET.fromstring(response.text)
    results: dict[str, dict[str, Any]] = {}
    for entry in root.findall("atom:entry", ATOM_NS):
        entry_id = normalize_whitespace(entry.findtext("atom:id", default="", namespaces=ATOM_NS))
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
