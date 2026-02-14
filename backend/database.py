import os
import logging
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

client: AsyncIOMotorClient = None  # type: ignore
db = None

logger = logging.getLogger(__name__)


def _require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


async def connect_db():
    global client, db
    mongodb_uri = _require_env("MONGODB_URI")
    db_name = _require_env("MONGODB_DB_NAME")
    logger.info("Connecting to MongoDB")

    client = AsyncIOMotorClient(mongodb_uri, serverSelectionTimeoutMS=10000)
    db = client[db_name]

    try:
        await client.admin.command("ping")

        # Ensure indexes
        await db.users.create_index("email", unique=True)

        # Vector search index must be created via Atlas UI / CLI, but we ensure
        # a regular index on user_id for fast lookups.
        await db.papers.create_index("user_id")
        await db.papers.create_index("arxiv_id")
        await db.papers.create_index([("user_id", 1), ("arxiv_id", 1)], unique=True)
    except Exception:
        logger.exception("MongoDB initialization failed")
        if client:
            client.close()
        client = None
        db = None
        raise

    logger.info("MongoDB connection established and indexes ensured")


async def close_db():
    global client, db
    if client:
        client.close()
    client = None
    db = None


def get_db():
    return db
