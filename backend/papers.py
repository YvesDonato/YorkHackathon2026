import os
import re
import logging
from typing import Any

import httpx
from google import genai
from google.genai import types
from fastapi import HTTPException

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSIONS = 768
GROUNDING_MODEL = "gemini-2.5-flash-lite"
PMC_API_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
PMC_ID_PATTERN = re.compile(r'PMC\d+', re.IGNORECASE)

GEMINI_QUOTA_EXHAUSTED_CODE = "GEMINI_QUOTA_EXHAUSTED"
GEMINI_API_KEY_INVALID_CODE = "GEMINI_API_KEY_INVALID"
GEMINI_API_KEY_MISSING_CODE = "GEMINI_API_KEY_MISSING"
GEMINI_REQUEST_FAILED_CODE = "GEMINI_REQUEST_FAILED"
_GEMINI_CLIENT_CACHE: dict[str, genai.Client] = {}


def _gemini_error_detail(code: str, message: str, retryable: bool) -> dict[str, Any]:
    return {"code": code, "message": message, "retryable": retryable}


def _extract_error_status(exc: Exception) -> int | None:
    for attr_name in ("status_code", "code"):
        raw_value = getattr(exc, attr_name, None)
        if isinstance(raw_value, int):
            return raw_value
        if isinstance(raw_value, str) and raw_value.isdigit():
            return int(raw_value)

    response = getattr(exc, "response", None)
    status_code = getattr(response, "status_code", None)
    if isinstance(status_code, int):
        return status_code

    return None


def _is_quota_exhausted_error(status_code: int | None, message: str) -> bool:
    message_lc = message.lower()
    if status_code == 429:
        return True
    return any(
        marker in message_lc
        for marker in (
            "resource_exhausted",
            "resource exhausted",
            "quota",
            "rate limit",
            "too many requests",
        )
    )


def _is_invalid_api_key_error(status_code: int | None, message: str) -> bool:
    message_lc = message.lower()
    if status_code in {401, 403}:
        return True
    if status_code == 400 and "api key" in message_lc:
        return True
    return any(
        marker in message_lc
        for marker in (
            "api key not valid",
            "invalid api key",
            "invalid key",
            "permission denied",
            "unauthenticated",
        )
    )


def _raise_gemini_request_error(exc: Exception, operation: str) -> None:
    status_code = _extract_error_status(exc)
    raw_message = str(exc).strip() or "Gemini request failed."

    if _is_quota_exhausted_error(status_code, raw_message):
        raise HTTPException(
            status_code=429,
            detail=_gemini_error_detail(
                GEMINI_QUOTA_EXHAUSTED_CODE,
                "Google Gemini API quota is exhausted for the current key.",
                True,
            ),
        )

    if _is_invalid_api_key_error(status_code, raw_message):
        raise HTTPException(
            status_code=401,
            detail=_gemini_error_detail(
                GEMINI_API_KEY_INVALID_CODE,
                "The provided Google Gemini API key is invalid.",
                False,
            ),
        )

    raise HTTPException(
        status_code=502,
        detail=_gemini_error_detail(
            GEMINI_REQUEST_FAILED_CODE,
            f"Gemini {operation} request failed.",
            True,
        ),
    )


def get_genai_client(api_key_override: str | None = None) -> genai.Client:
    api_key = (api_key_override or GEMINI_API_KEY or "").strip()
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail=_gemini_error_detail(
                GEMINI_API_KEY_MISSING_CODE,
                "GEMINI_API_KEY is not set on the server and no override key was provided.",
                False,
            ),
        )

    cached_client = _GEMINI_CLIENT_CACHE.get(api_key)
    if cached_client is not None:
        return cached_client

    client = genai.Client(api_key=api_key)
    _GEMINI_CLIENT_CACHE[api_key] = client
    return client


# ---------------------------------------------------------------------------
# Embedding helpers
# ---------------------------------------------------------------------------

async def generate_embedding(text: str, api_key_override: str | None = None) -> list[float]:
    """Generate an embedding vector for the given text using Google Gemini."""
    genai_client = get_genai_client(api_key_override)

    try:
        result = genai_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=[text],
            config=types.EmbedContentConfig(
                output_dimensionality=EMBEDDING_DIMENSIONS,
            ),
        )
        return result.embeddings[0].values
    except Exception as e:
        _raise_gemini_request_error(e, "embedding")


async def generate_embeddings_batch(
    texts: list[str],
    api_key_override: str | None = None,
) -> list[list[float]]:
    """Generate embedding vectors for multiple texts in a single Gemini API call."""
    if not texts:
        return []
    genai_client = get_genai_client(api_key_override)

    try:
        result = genai_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=texts
        )
        return [e.values for e in result.embeddings]
    except Exception as e:
        _raise_gemini_request_error(e, "batch embedding")


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


# ---------------------------------------------------------------------------
# Google Search grounding – discover similar papers
# ---------------------------------------------------------------------------

_ARXIV_ID_RE = re.compile(r"\b(\d{4}\.\d{4,5})\b")


async def find_similar_papers_via_search(
    title: str,
    summary: str,
    max_results: int = 8,
    api_key_override: str | None = None,
) -> list[dict]:
    """Use Gemini with Google Search grounding to find related arXiv papers.

    Returns a list of dicts with keys: ``arxiv_id``, ``title``.
    """
    genai_client = get_genai_client(api_key_override)

    # Truncate summary to keep the prompt focused
    summary_excerpt = summary[:500] if summary else ""

    prompt = (
        f"Given this research paper:\n"
        f"Title: \"{title}\"\n"
        f"Summary: \"{summary_excerpt}\"\n\n"
        f"Find {max_results} similar or closely related research papers "
        f"that are available on arXiv. For each paper, provide the arXiv "
        f"paper ID (the numeric identifier like 2301.12345) and the paper title.\n\n"
        f"Format each result on its own line exactly as:\n"
        f"ARXIV_ID: <id> | TITLE: <title>"
    )

    grounding_tool = types.Tool(google_search=types.GoogleSearch())
    config = types.GenerateContentConfig(tools=[grounding_tool])

    try:
        response = genai_client.models.generate_content(
            model=GROUNDING_MODEL,
            contents=prompt,
            config=config,
        )
    except Exception as exc:
        if _is_quota_exhausted_error(_extract_error_status(exc), str(exc)) or _is_invalid_api_key_error(
            _extract_error_status(exc),
            str(exc),
        ):
            _raise_gemini_request_error(exc, "grounded search")
        logger.warning("Google Search grounding request failed: %s", exc)
        return []

    text = response.text or ""
    results: list[dict] = []
    seen_ids: set[str] = set()

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue

        # Try structured format first: ARXIV_ID: ... | TITLE: ...
        if "ARXIV_ID:" in line and "TITLE:" in line:
            parts = line.split("|", maxsplit=1)
            arxiv_part = parts[0].split("ARXIV_ID:")[-1].strip()
            title_part = parts[1].split("TITLE:")[-1].strip() if len(parts) > 1 else ""

            # Extract the numeric arXiv ID from the part
            id_match = _ARXIV_ID_RE.search(arxiv_part)
            if id_match and id_match.group(1) not in seen_ids:
                aid = id_match.group(1)
                seen_ids.add(aid)
                results.append({"arxiv_id": aid, "title": title_part or aid})
                continue

        # Fallback: extract any arXiv ID from the line
        for m in _ARXIV_ID_RE.finditer(line):
            aid = m.group(1)
            if aid not in seen_ids:
                seen_ids.add(aid)
                results.append({"arxiv_id": aid, "title": line})

    logger.info("Google Search grounding found %d related papers", len(results))
    return results


# ---------------------------------------------------------------------------
# PMC paper search
# ---------------------------------------------------------------------------

async def find_similar_pmc_papers(
    pmc_id: str,
    max_results: int = 8,
) -> list[dict]:
    """Search for similar PMC papers using NCBI E-utilities elink (related articles).
    
    Returns a list of dicts with keys: ``pmc_id``, ``title``.
    """
    # Extract numeric ID from PMC12345 format
    numeric_id = pmc_id.replace("PMC", "").replace("pmc", "")
    
    # Use elink to find related papers in PMC
    elink_url = f"{PMC_API_BASE}/elink.fcgi"
    elink_params = {
        "dbfrom": "pmc",
        "db": "pmc",
        "id": numeric_id,
        "retmode": "json",
        "cmd": "neighbor_score"  # Get related articles with scores
    }
    
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(elink_url, params=elink_params)
        response.raise_for_status()
        
        data = response.json()
        logger.info(f"PMC elink response for {pmc_id}: {data}")
        linksets = data.get("linksets", [])
        
        if not linksets:
            logger.info("No linksets found for PMC paper")
            return []
        
        # Extract related paper IDs
        related_ids = []
        for linkset in linksets:
            link_set_dbs = linkset.get("linksetdbs", [])
            for link_db in link_set_dbs:
                links = link_db.get("links", [])
                # Each link is a dict with 'id' and 'score' keys
                for link in links[:max_results + 5]:
                    if isinstance(link, dict):
                        related_ids.append(link.get("id"))
                    else:
                        related_ids.append(link)

        logger.info(f"Found {len(related_ids)} related PMC IDs before filtering")
        
        if not related_ids:
            logger.info("No similar PMC papers found via elink")
            return []

        # Remove the original paper ID from results
        related_ids = [rid for rid in related_ids if str(rid) != numeric_id][:max_results]

        if not related_ids:
            logger.info("No similar PMC papers after filtering")
            return []

        # Fetch details for these papers using esummary
        summary_url = f"{PMC_API_BASE}/esummary.fcgi"
        summary_params = {
            "db": "pmc",
            "id": ",".join(str(rid) for rid in related_ids),
            "retmode": "json"
        }
        
        async with httpx.AsyncClient(timeout=15) as client:
            summary_response = await client.get(summary_url, params=summary_params)
        summary_response.raise_for_status()
        
        summary_data = summary_response.json()
        result_dict = summary_data.get("result", {})
        
        results = []
        for pmc_numeric_id in related_ids:
            paper_data = result_dict.get(str(pmc_numeric_id))
            if paper_data and isinstance(paper_data, dict):
                paper_title = paper_data.get("title", "")
                result_pmc_id = f"PMC{pmc_numeric_id}"
                results.append({
                    "pmc_id": result_pmc_id,
                    "title": paper_title
                })
        
        logger.info("Found %d similar PMC papers", len(results))
        return results
        
    except Exception as exc:
        logger.warning("PMC search request failed: %s", exc)
        return []
