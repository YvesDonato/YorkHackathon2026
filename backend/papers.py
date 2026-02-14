import os
from datetime import datetime, timezone

from google import genai
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_current_user
from database import get_db

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
EMBEDDING_MODEL = "gemini-embedding-001"  # 3072 dimensions
EMBEDDING_DIMENSIONS = 3072

# Initialize Gemini client
genai_client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class SavePaperRequest(BaseModel):
    arxiv_id: str
    title: str
    url: str
    summary: str
    authors: list[str] = []
    published: str = ""


class PaperOut(BaseModel):
    id: str
    arxiv_id: str
    title: str
    url: str
    summary: str
    authors: list[str]
    published: str
    similarity_score: float | None = None


# ---------------------------------------------------------------------------
# Embedding helper
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
        # Return the first (and only) embedding's values
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
# Router
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/papers", tags=["papers"])


@router.post("/save", response_model=PaperOut)
async def save_paper(body: SavePaperRequest, current_user: dict = Depends(get_current_user)):
    """Save a paper to the user's collection with a vector embedding of its summary."""
    db = get_db()
    user_id = str(current_user["_id"])

    # Check if already saved
    existing = await db.papers.find_one({"user_id": user_id, "arxiv_id": body.arxiv_id})
    if existing:
        return PaperOut(
            id=str(existing["_id"]),
            arxiv_id=existing["arxiv_id"],
            title=existing["title"],
            url=existing["url"],
            summary=existing["summary"],
            authors=existing.get("authors", []),
            published=existing.get("published", ""),
        )

    # Generate embedding from the summary
    embedding = await generate_embedding(body.summary)

    paper_doc = {
        "user_id": user_id,
        "arxiv_id": body.arxiv_id,
        "title": body.title,
        "url": body.url,
        "summary": body.summary,
        "authors": body.authors,
        "published": body.published,
        "embedding": embedding,
        "saved_at": datetime.now(timezone.utc),
    }
    result = await db.papers.insert_one(paper_doc)

    return PaperOut(
        id=str(result.inserted_id),
        arxiv_id=body.arxiv_id,
        title=body.title,
        url=body.url,
        summary=body.summary,
        authors=body.authors,
        published=body.published,
    )


@router.get("/my", response_model=list[PaperOut])
async def get_my_papers(current_user: dict = Depends(get_current_user)):
    """Return all papers saved by the current user."""
    db = get_db()
    user_id = str(current_user["_id"])
    cursor = db.papers.find({"user_id": user_id}).sort("saved_at", -1)
    papers = []
    async for doc in cursor:
        papers.append(
            PaperOut(
                id=str(doc["_id"]),
                arxiv_id=doc["arxiv_id"],
                title=doc["title"],
                url=doc["url"],
                summary=doc["summary"],
                authors=doc.get("authors", []),
                published=doc.get("published", ""),
            )
        )
    return papers


@router.get("/similar/{paper_id}", response_model=list[PaperOut])
async def find_similar_papers(paper_id: str, limit: int = 10, current_user: dict = Depends(get_current_user)):
    """
    Find papers with similar summaries using MongoDB Atlas Vector Search.
    """
    db = get_db()
    user_id = str(current_user["_id"])

    # Get the source paper
    source = await db.papers.find_one({"_id": ObjectId(paper_id), "user_id": user_id})
    if not source:
        raise HTTPException(status_code=404, detail="Paper not found")

    query_embedding = source.get("embedding")
    if not query_embedding:
        raise HTTPException(status_code=400, detail="Paper has no embedding")

    # Atlas Vector Search aggregation pipeline
    pipeline = [
        {
            "$vectorSearch": {
                "index": "vector_index",
                "path": "embedding",
                "queryVector": query_embedding,
                "numCandidates": limit * 10,
                "limit": limit + 1,  # +1 to account for the source paper
                "filter": {"user_id": user_id},
            }
        },
        {
            "$addFields": {
                "score": {"$meta": "vectorSearchScore"},
            }
        },
        {
            "$match": {
                "_id": {"$ne": ObjectId(paper_id)},  # Exclude the source paper
            }
        },
        {"$limit": limit},
    ]

    results = []
    async for doc in db.papers.aggregate(pipeline):
        results.append(
            PaperOut(
                id=str(doc["_id"]),
                arxiv_id=doc["arxiv_id"],
                title=doc["title"],
                url=doc["url"],
                summary=doc["summary"],
                authors=doc.get("authors", []),
                published=doc.get("published", ""),
                similarity_score=doc.get("score"),
            )
        )
    return results


@router.delete("/{paper_id}")
async def delete_paper(paper_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a saved paper."""
    db = get_db()
    user_id = str(current_user["_id"])
    result = await db.papers.delete_one({"_id": ObjectId(paper_id), "user_id": user_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Paper not found")
    return {"detail": "Paper deleted"}
