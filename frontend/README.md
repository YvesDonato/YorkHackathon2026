# Frontend (Next.js)

This frontend renders an arXiv reference graph and shows clicked node details in the sidebar.

## Environment

Set the FastAPI base URL in `.env.local`:

```bash
NEXT_PUBLIC_FASTAPI_BASE_URL=http://localhost:8000
```

## Run

1. Start backend (from `backend/`):

```bash
uvicorn arxiv_scraper:app --reload --host 0.0.0.0 --port 8000
```

2. Start frontend (from `frontend/`):

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Coolify (Dockerfile)

This repo includes a root `Dockerfile` for single-container deployment on Coolify.

- Exposed port: `8080`
- `nginx` reverse proxy:
  - `/` -> Next.js (`127.0.0.1:3000`)
  - `/api/*` -> FastAPI (`127.0.0.1:8000`)

Set `NEXT_PUBLIC_FASTAPI_BASE_URL=/api` in Coolify build/runtime environment.
