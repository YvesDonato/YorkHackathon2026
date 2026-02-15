from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.audio_service import AudioGenerationError, generate_audio_bytes
from services.translation_service import TranslationError, translate_summary

router = APIRouter(prefix="/api/audio", tags=["audio"])


class AudioGenerateRequest(BaseModel):
    summary: str
    lang: str = "en"


@router.post("/generate")
async def generate_audio(request: AudioGenerateRequest):
    try:
        narration_text = translate_summary(request.summary, request.lang)
    except TranslationError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    try:
        audio_bytes = await generate_audio_bytes(narration_text)
    except AudioGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return StreamingResponse(iter([audio_bytes]), media_type="audio/mpeg")
