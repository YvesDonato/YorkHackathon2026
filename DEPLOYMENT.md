# Deployment (Coolify + Docker Compose)

This repository deploys as two services:

- `frontend` (Next.js) on port `80`
- `backend` (FastAPI) on port `8000`

## 1. Required Environment Variables

Set these in Coolify:

- `FRONTEND_ORIGIN=https://app.<your-domain>`
- `NEXT_PUBLIC_FASTAPI_BASE_URL=/api`
- `BACKEND_INTERNAL_URL=http://backend:8000`

Notes:

- `FRONTEND_ORIGIN` controls backend CORS allow-list.
- `NEXT_PUBLIC_FASTAPI_BASE_URL` is public and embedded into the frontend build.
- `BACKEND_INTERNAL_URL` is used by Next.js rewrite/proxy to reach backend over the
  internal Docker network.

## 2. Coolify Setup

1. Create a new application from this repository.
2. Select **Docker Compose** as the deployment type.
3. Set compose file path to `docker-compose.yaml` (or `docker-compose.yml`) at repo root.
   Do not prefix it with `/`.
4. Add the environment variables above.
5. Configure domains:
   - Route `app.<your-domain>` to service `frontend` on port `80`.
   - Backend domain is optional. If you expose it, route `api.<your-domain>` to
     service `backend` on port `8000`.
6. Deploy.

Important:
- Coolify defaults domain routing to port `80`. The frontend is configured for this.
- The frontend proxies `/api/*` to `http://backend:8000/*` internally, so browser
  calls avoid CORS and mixed-content issues.

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
docker compose exec -T frontend node -e "fetch('http://127.0.0.1:80').then(async (r) => { console.log(r.status, (await r.text()).length); })"
docker compose exec -T frontend node -e "fetch('http://127.0.0.1:80/api/openapi.json').then(async (r) => { console.log(r.status, (await r.text()).length); })"
```

Stop services:

```bash
docker compose down
```
