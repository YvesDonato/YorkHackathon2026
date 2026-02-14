from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    mongodb_uri: str
    mongodb_db: str = "ctrlhackdel_db"
    mongodb_collection: str = "papers"
    vector_index_name: str = "vector_index"
    gemini_api_key: str
    frontend_origin: str | None = None
    log_level: str = "INFO"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="before")
    @classmethod
    def validate_required_fields(cls, data: object) -> object:
        if not isinstance(data, dict):
            return data

        required_fields = ("mongodb_uri", "gemini_api_key")
        missing = [field for field in required_fields if not str(data.get(field, "")).strip()]
        if missing:
            joined = ", ".join(missing)
            raise ValueError(f"Missing required environment variables: {joined}")

        return data


@lru_cache
def get_settings() -> Settings:
    return Settings()
