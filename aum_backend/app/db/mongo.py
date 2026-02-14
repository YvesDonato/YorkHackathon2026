import logging

import certifi
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase
from pymongo.errors import PyMongoError, ServerSelectionTimeoutError

from app.core.config import Settings

logger = logging.getLogger(__name__)


class MongoManager:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: AsyncIOMotorClient | None = None

    @property
    def client(self) -> AsyncIOMotorClient:
        if self._client is None:
            raise RuntimeError("MongoDB client is not initialized")
        return self._client

    @property
    def database(self) -> AsyncIOMotorDatabase:
        return self.client[self._settings.mongodb_db]

    @property
    def collection(self) -> AsyncIOMotorCollection:
        return self.database[self._settings.mongodb_collection]

    def _build_client(self) -> AsyncIOMotorClient:
        common_options: dict[str, object] = {
            "serverSelectionTimeoutMS": 8000,
            "connectTimeoutMS": 20000,
            "socketTimeoutMS": 20000,
        }

        if self._settings.mongodb_uri.startswith("mongodb+srv://"):
            common_options["tls"] = True
            common_options["tlsCAFile"] = certifi.where()

        return AsyncIOMotorClient(self._settings.mongodb_uri, **common_options)

    async def init(self) -> None:
        if self._client is not None:
            return

        try:
            self._client = self._build_client()
            await self.ping()
            logger.info("MongoDB client initialized")
        except ServerSelectionTimeoutError as exc:
            if self._client is not None:
                self._client.close()
                self._client = None
            raise RuntimeError(
                "Failed to connect to MongoDB. Check Atlas network allowlist, firewall/TLS interception, and URI credentials."
            ) from exc
        except PyMongoError as exc:
            if self._client is not None:
                self._client.close()
                self._client = None
            raise RuntimeError("Failed to connect to MongoDB") from exc

    async def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
            logger.info("MongoDB client closed")

    async def ensure_indexes(self) -> None:
        try:
            await self.collection.create_index("paper_id", unique=True, name="uniq_paper_id")
            await self.collection.create_index("updated_at", name="idx_updated_at")
            logger.info("Ensured unique index 'uniq_paper_id' on paper_id")
        except PyMongoError as exc:
            raise RuntimeError("Failed to ensure MongoDB indexes") from exc

    async def ping(self) -> None:
        try:
            await self.database.command({"ping": 1})
        except PyMongoError as exc:
            raise RuntimeError("MongoDB ping failed") from exc
