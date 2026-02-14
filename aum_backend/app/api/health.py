from fastapi import APIRouter, HTTPException, Request

from app.db.mongo import MongoManager
from app.services.gemini import ExternalServiceError, GeminiClient

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/db")
async def health_db(request: Request) -> dict[str, object]:
    mongo: MongoManager = request.app.state.mongo
    try:
        await mongo.ping()
        return {
            "ok": True,
            "db": mongo.database.name,
            "collection": mongo.collection.name,
        }
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Database unreachable") from exc


@router.get("/gemini")
async def health_gemini(request: Request) -> dict[str, object]:
    gemini: GeminiClient = request.app.state.gemini
    try:
        vector = await gemini.embed_text("hello")
        return {
            "ok": True,
            "dims": len(vector),
        }
    except ExternalServiceError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini embedding check failed: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Gemini embedding check failed: unknown error",
        ) from exc
