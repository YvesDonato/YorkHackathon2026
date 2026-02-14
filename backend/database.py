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


def _describe_mongo_target(uri: str) -> str:
    # Return only host information (without credentials/query params) for logs.
    remainder = uri.split("://", maxsplit=1)[-1]
    if "@" in remainder:
        remainder = remainder.split("@", maxsplit=1)[1]
    host_segment = remainder.split("/", maxsplit=1)[0].strip()
    return host_segment or "<unknown>"


async def connect_db():
    global client, db
    logger.info("MongoDB preflight: validating required environment variables")
    mongodb_uri = _require_env("MONGODB_URI")
    db_name = _require_env("MONGODB_DB_NAME")
    mongo_target = _describe_mongo_target(mongodb_uri)
    logger.info("MongoDB preflight: connecting to host=%s db=%s", mongo_target, db_name)

    client = AsyncIOMotorClient(mongodb_uri, serverSelectionTimeoutMS=10000)
    db = client[db_name]

    try:
        logger.info("MongoDB preflight: pinging server")
        await client.admin.command("ping")

        logger.info("MongoDB preflight: ensuring users indexes")
        await db.users.create_index("email", unique=True)

        # Vector search index must be created via Atlas UI / CLI, but we ensure
        # a regular index on user_id for fast lookups.
        logger.info("MongoDB preflight: ensuring papers indexes")
        await db.papers.create_index("user_id")
        await db.papers.create_index("arxiv_id")
        await db.papers.create_index([("user_id", 1), ("arxiv_id", 1)], unique=True)
    except Exception as exc:
        logger.exception("MongoDB initialization failed (%s): %s", type(exc).__name__, exc)
        if client:
            client.close()
        client = None
        db = None
        raise

    logger.info("MongoDB preflight complete: connection established and indexes ensured")


async def close_db():
    global client, db
    if client:
        client.close()
    client = None
    db = None


def get_db():
    return db
