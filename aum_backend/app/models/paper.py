from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class StoredPaper(BaseModel):
    paper_id: str
    source: Literal["arxiv", "pdf"]
    input_link: str | None = None
    title: str
    url: str | None = None
    published: str | None = None
    authors: list[str] = Field(default_factory=list)
    summary: str = ""
    references: list[dict[str, Any]] = Field(default_factory=list)
    references_error: str | None = None
    embedding: list[float] | None = None
    embedding_dims: int | None = None
    embedding_status: Literal["ok", "failed", "skipped"] = "skipped"
    processed: bool = False
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class PaperStatusResponse(BaseModel):
    paper_id: str
    processed: bool
    embedding_status: Literal["ok", "failed", "skipped"]
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    updated_at: datetime


class PaperResponse(BaseModel):
    paper_id: str
    source: Literal["arxiv", "pdf"]
    input_link: str | None = None
    title: str
    url: str | None = None
    published: str | None = None
    authors: list[str] = Field(default_factory=list)
    summary: str = ""
    references: list[dict[str, Any]] = Field(default_factory=list)
    references_error: str | None = None
    embedding_dims: int | None = None
    embedding_status: Literal["ok", "failed", "skipped"]
    processed: bool
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class IngestLinkRequest(BaseModel):
    link: str
