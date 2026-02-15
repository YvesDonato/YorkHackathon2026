import os
import re
import logging

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

# Initialize Gemini client
genai_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


# ---------------------------------------------------------------------------
# Embedding helpers
# ---------------------------------------------------------------------------

async def generate_embedding(text: str) -> list[float]:
    """Generate an embedding vector for the given text using Google Gemini."""
    if not genai_client:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not set")

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
        raise HTTPException(
            status_code=502,
            detail=f"Gemini embedding request failed: {str(e)}",
        )


async def generate_embeddings_batch(texts: list[str]) -> list[list[float]]:
    """Generate embedding vectors for multiple texts in a single Gemini API call."""
    if not genai_client:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not set")
    if not texts:
        return []

    try:
        result = genai_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=texts
        )
        return [e.values for e in result.embeddings]
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini batch embedding request failed: {str(e)}",
        )


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
) -> list[dict]:
    """Use Gemini with Google Search grounding to find related arXiv papers.

    Returns a list of dicts with keys: ``arxiv_id``, ``title``.
    """
    if not genai_client:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not set")

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
