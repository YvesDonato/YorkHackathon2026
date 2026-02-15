import os

import httpx


class AudioGenerationError(Exception):
    """Raised when ElevenLabs audio generation fails."""


def _get_required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise AudioGenerationError(f"Missing required environment variable: {name}")
    return value


async def generate_audio_bytes(text: str) -> bytes:
    normalized_text = text.strip()
    if not normalized_text:
        raise AudioGenerationError("Narration text is required")

    api_key = _get_required_env("ELEVENLABS_API_KEY")
    voice_id = _get_required_env("ELEVENLABS_VOICE_ID")
    model_id = _get_required_env("ELEVENLABS_MODEL_ID")

    endpoint = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    payload = {
        "text": normalized_text,
        "model_id": model_id,
    }
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": api_key,
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(endpoint, json=payload, headers=headers)
            response.raise_for_status()
            return response.content
    except httpx.HTTPStatusError as exc:
        status_code = exc.response.status_code
        response_text = exc.response.text.strip()
        if response_text:
            compact_response = " ".join(response_text.split())
            raise AudioGenerationError(
                f"ElevenLabs request failed with HTTP {status_code}: {compact_response[:300]}"
            ) from exc
        raise AudioGenerationError(
            f"ElevenLabs request failed with HTTP {status_code}"
        ) from exc
    except Exception as exc:
        raise AudioGenerationError("ElevenLabs audio generation failed") from exc
