from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.papers import router as papers_router
from app.core.config import get_settings
from app.core.logging import setup_logging
from app.db.mongo import MongoManager
from app.services.gemini import GeminiClient


def _parse_frontend_origins(frontend_origin: str | None) -> list[str]:
    raw_value = frontend_origin if frontend_origin is not None else "http://localhost:3000"
    origins = [origin.strip() for origin in raw_value.split(",") if origin.strip()]
    return origins or ["http://localhost:3000"]


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_level)
    logger = logging.getLogger(__name__)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        mongo = MongoManager(settings)
        gemini = GeminiClient(settings.gemini_api_key)
        app.state.settings = settings
        app.state.mongo = mongo
        app.state.gemini = gemini

        await mongo.init()
        await mongo.ensure_indexes()
        logger.info("Application startup complete")
        try:
            yield
        finally:
            await mongo.close()
            logger.info("Application shutdown complete")

    app = FastAPI(title="arXiv Paper API", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=_parse_frontend_origins(settings.frontend_origin),
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )

    app.include_router(health_router)
    app.include_router(papers_router)

    return app


app = create_app()
