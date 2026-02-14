import os
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI")
DB_NAME = os.getenv("MONGODB_DB_NAME")

client: AsyncIOMotorClient = None  # type: ignore
db = None


async def connect_db():
    global client, db
    client = AsyncIOMotorClient(MONGODB_URI)
    db = client[DB_NAME]

    # Ensure indexes
    await db.users.create_index("email", unique=True)

    # Vector search index must be created via Atlas UI / CLI, but we ensure
    # a regular index on user_id for fast lookups.
    await db.papers.create_index("user_id")
    await db.papers.create_index("arxiv_id")
    await db.papers.create_index([("user_id", 1), ("arxiv_id", 1)], unique=True)

    # Graph papers (shared/global) – keyed by arxiv_id
    await db.graph_papers.create_index("arxiv_id", unique=True)

    # Junction: which users have explored which graph papers
    await db.user_graph_papers.create_index([("user_id", 1), ("arxiv_id", 1)], unique=True)
    await db.user_graph_papers.create_index("user_id")


async def close_db():
    global client
    if client:
        client.close()


def get_db():
    return db
