from __future__ import annotations

import json

import httpx


class ExternalServiceError(Exception):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class GeminiClient:
    _EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent"

    def __init__(self, api_key: str, timeout_seconds: float = 20.0) -> None:
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds

    async def embed_text(self, text: str) -> list[float]:
        payload = {
            "model": "models/gemini-embedding-001",
            "content": {"parts": [{"text": text}]},
            "outputDimensionality": 768,
        }
        headers = {
            "x-goog-api-key": self._api_key,
            "Content-Type": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
                response = await client.post(self._EMBED_URL, headers=headers, json=payload)
        except httpx.HTTPError as exc:
            raise ExternalServiceError(f"Gemini request failed: {exc}") from exc

        if response.status_code != 200:
            truncated = response.text[:500]
            raise ExternalServiceError(
                f"Gemini returned HTTP {response.status_code}: {truncated}",
                status_code=response.status_code,
            )

        try:
            data = response.json()
        except json.JSONDecodeError as exc:
            raise ExternalServiceError("Gemini response was not valid JSON") from exc

        raw_embedding = self._extract_embedding_values(data)
        try:
            vector = [float(value) for value in raw_embedding]
        except (TypeError, ValueError) as exc:
            raise ExternalServiceError("Gemini embedding contained non-numeric values") from exc

        if len(vector) != 768:
            raise ExternalServiceError(f"Gemini embedding size mismatch: expected 768, got {len(vector)}")

        return vector

    def _extract_embedding_values(self, data: object) -> list[object]:
        if not isinstance(data, dict):
            raise ExternalServiceError("Gemini response must be a JSON object")

        embedding = data.get("embedding")
        if isinstance(embedding, dict):
            values = embedding.get("values")
            if isinstance(values, list):
                return values
        if isinstance(embedding, list):
            return embedding

        embeddings = data.get("embeddings")
        if isinstance(embeddings, list) and embeddings:
            first = embeddings[0]
            if isinstance(first, dict) and isinstance(first.get("values"), list):
                return first["values"]

        keys = ", ".join(sorted(data.keys()))
        raise ExternalServiceError(f"Unexpected Gemini embedding response format. Top-level keys: {keys}")
