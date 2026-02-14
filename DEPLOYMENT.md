# Deployment (Coolify + Docker Compose)

This repository deploys as two services:

- `frontend` (Next.js) on port `3000`
- `backend` (FastAPI) on port `8000`

## 1. Required Environment Variables

Set these in Coolify:

- `FRONTEND_ORIGIN=https://app.<your-domain>`
- `NEXT_PUBLIC_FASTAPI_BASE_URL=https://api.<your-domain>`

Notes:

- `FRONTEND_ORIGIN` controls backend CORS allow-list.
- `NEXT_PUBLIC_FASTAPI_BASE_URL` is public and embedded into the frontend build.

## 2. Coolify Setup

1. Create a new application from this repository.
2. Select **Docker Compose** as the deployment type.
3. Set compose file path to `docker-compose.yml` at repo root.
4. Add the environment variables above.
5. Configure domains:
   - Route `app.<your-domain>` to service `frontend` on port `3000`.
   - Route `api.<your-domain>` to service `backend` on port `8000`.
6. Deploy.

## 3. Local Validation

Use these commands from repo root:

```bash
docker compose config
docker compose build
docker compose up -d
```

Smoke tests:

```bash
docker compose exec -T backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/openapi.json').status)"
docker compose exec -T backend python -c "import urllib.request, json; data=json.load(urllib.request.urlopen('http://127.0.0.1:8000/graph?link=1706.03762')); print(data.get('seed_id'), len(data.get('nodes', [])), len(data.get('links', [])))"
docker compose exec -T frontend node -e "fetch('http://127.0.0.1:3000').then(async (r) => { console.log(r.status, (await r.text()).length); })"
```

Stop services:

```bash
docker compose down
```
