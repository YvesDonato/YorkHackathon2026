import os
import logging
import asyncio
from dotenv import load_dotenv
import certifi

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import OperationFailure, PyMongoError, ServerSelectionTimeoutError

load_dotenv()

client: AsyncIOMotorClient = None  # type: ignore

logger = logging.getLogger(__name__)


def _require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"DB_CONFIG_ERROR: Missing required environment variable: {name}")
    return value


def _describe_mongo_target(uri: str) -> str:
    # Return only host information (without credentials/query params) for logs.
    remainder = uri.split("://", maxsplit=1)[-1]
    if "@" in remainder:
        remainder = remainder.split("@", maxsplit=1)[1]
    host_segment = remainder.split("/", maxsplit=1)[0].strip()
    return host_segment or "<unknown>"


def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"DB_CONFIG_ERROR: {name} must be an integer") from exc
    if value < 1:
        raise RuntimeError(f"DB_CONFIG_ERROR: {name} must be >= 1")
    return value


def _env_float(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise RuntimeError(f"DB_CONFIG_ERROR: {name} must be a number") from exc
    if value < 0:
        raise RuntimeError(f"DB_CONFIG_ERROR: {name} must be >= 0")
    return value


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"DB_CONFIG_ERROR: {name} must be a boolean")


def _is_connectivity_error(exc: Exception) -> bool:
    return isinstance(exc, ServerSelectionTimeoutError)


async def connect_db():
    global client, db
    logger.info("MongoDB preflight: validating required environment variables")
    mongodb_uri = _require_env("MONGODB_URI")
    db_name = _require_env("MONGODB_DB_NAME")
    retries = _env_int("MONGODB_CONNECT_RETRIES", 3)
    retry_delay_seconds = _env_float("MONGODB_CONNECT_RETRY_DELAY_SECONDS", 3.0)
    ensure_indexes = _env_bool("MONGODB_ENSURE_INDEXES", True)
    mongo_target = _describe_mongo_target(mongodb_uri)
    logger.info(
        "MongoDB preflight: host=%s db=%s retries=%s ensure_indexes=%s",
        mongo_target,
        db_name,
        retries,
        ensure_indexes,
    )

    last_connect_error: Exception | None = None

    for attempt in range(1, retries + 1):
        logger.info("MongoDB preflight: connect attempt %s/%s", attempt, retries)
        client = AsyncIOMotorClient(
            mongodb_uri,
            serverSelectionTimeoutMS=10000,
            tlsCAFile=certifi.where(),
            tlsAllowInvalidCertificates=True
        )
        db = client[db_name]

        try:
            logger.info("MongoDB preflight: pinging server")
            await client.admin.command("ping")
            last_connect_error = None
            break
        except Exception as exc:
            logger.exception(
                "MongoDB preflight connect attempt failed (%s): %s",
                type(exc).__name__,
                exc,
            )
            client.close()
            client = None
            db = None

            if isinstance(exc, OperationFailure):
                raise RuntimeError(f"DB_AUTH_ERROR: {exc}") from exc

            if _is_connectivity_error(exc):
                last_connect_error = exc
                if attempt < retries:
                    await asyncio.sleep(retry_delay_seconds)
                    continue
                raise RuntimeError(f"DB_CONNECT_ERROR: {exc}") from exc

            if isinstance(exc, PyMongoError):
                raise RuntimeError(f"DB_CONNECT_ERROR: {exc}") from exc

            raise

    if last_connect_error is not None:
        raise RuntimeError(f"DB_CONNECT_ERROR: {last_connect_error}") from last_connect_error

    try:
        if ensure_indexes:
            logger.info("MongoDB preflight: ensuring users indexes")
            await db.users.create_index("email", unique=True)

            # Vector search index must be created via Atlas UI / CLI, but we ensure
            # regular indexes for fast lookups.
            logger.info("MongoDB preflight: ensuring graph_papers indexes")
            await db.graph_papers.create_index("arxiv_id", unique=True)

            # Sessions: track graph explorations
            logger.info("MongoDB preflight: ensuring sessions indexes")
            await db.sessions.create_index("user_id")
            await db.sessions.create_index("created_at")

            # Session papers: junction table linking sessions to papers
            logger.info("MongoDB preflight: ensuring session_papers indexes")
            await db.session_papers.create_index([("session_id", 1), ("arxiv_id", 1)], unique=True)
            await db.session_papers.create_index("session_id")
        else:
            logger.warning("MongoDB preflight: skipping index creation (MONGODB_ENSURE_INDEXES=false)")
    except Exception as exc:
        logger.exception("MongoDB index setup failed (%s): %s", type(exc).__name__, exc)
        if client:
            client.close()
        client = None
        db = None

        if isinstance(exc, OperationFailure):
            raise RuntimeError(f"DB_INDEX_ERROR: {exc}") from exc
        if isinstance(exc, PyMongoError):
            raise RuntimeError(f"DB_INDEX_ERROR: {exc}") from exc
        raise

    logger.info("MongoDB preflight complete: connection established")


async def close_db():
    global client, db
    if client:
        client.close()
    client = None
    db = None


def get_db():
    return db
