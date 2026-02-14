import os

from google import genai
from fastapi import HTTPException

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
EMBEDDING_MODEL = "gemini-embedding-001"  # 3072 dimensions
EMBEDDING_DIMENSIONS = 3072

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
            contents=[text]
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
