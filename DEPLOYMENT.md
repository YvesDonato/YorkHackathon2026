# Deployment (Coolify + Docker Compose)

This repository deploys as two services:

- `frontend` (Next.js) on port `80`
- `backend` (FastAPI) on port `8000`

## 1. Required Environment Variables

Set these in Coolify:

- `FRONTEND_ORIGIN=https://app.<your-domain>`
- `MONGODB_URI=<your-mongodb-atlas-uri>`
- `MONGODB_DB_NAME=<your-db-name>`
- `JWT_SECRET_KEY=<long-random-secret>`
- `NEXT_PUBLIC_FASTAPI_BASE_URL=/api`
- `BACKEND_INTERNAL_URL=http://backend:8000`

Notes:

- Backend startup is fail-fast: missing/invalid MongoDB or JWT settings make the
  backend container unhealthy by design.
- Compose now enforces required backend env vars during interpolation. If one is
  missing or empty, deployment fails immediately with a clear message.
- Backend retries Mongo connectivity a limited number of times (`MONGODB_CONNECT_*`)
  before failing startup.
- `FRONTEND_ORIGIN` controls backend CORS allow-list.
- `NEXT_PUBLIC_FASTAPI_BASE_URL` is public and embedded into the frontend build.
- `BACKEND_INTERNAL_URL` is used by Next.js rewrite/proxy to reach backend over the
  internal Docker network.

Optional backend environment variables:

- `ACCESS_TOKEN_EXPIRE_MINUTES=1440`
- `GEMINI_API_KEY=<optional>`
- `MONGODB_ENSURE_INDEXES=true` (default strict mode)
- `MONGODB_CONNECT_RETRIES=3`
- `MONGODB_CONNECT_RETRY_DELAY_SECONDS=3`

## 2. Preflight Checklist (Before Deploy)

1. Confirm required env vars are present and non-empty in Coolify:
   - `MONGODB_URI`
   - `MONGODB_DB_NAME`
   - `JWT_SECRET_KEY`
2. Confirm Atlas network access allows your Coolify host outbound IP.
3. Confirm Mongo user permissions include index creation on target DB.
4. Confirm Mongo URI points to the intended cluster and auth database.
5. If diagnosing deploy failures, you can temporarily set:
   - `MONGODB_ENSURE_INDEXES=false`
   This isolates index-permission issues from connectivity/auth issues.

## 3. Coolify Setup

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
- If backend is unhealthy after deploy, open backend logs first; startup now emits
  explicit config/connection errors.

## 4. Local Validation

Use these commands from repo root:

```bash
cp .env.example .env
# Replace placeholder values in .env with real credentials before continuing.
docker compose --env-file .env config
docker compose --env-file .env build
docker compose --env-file .env up -d
```

Smoke tests:

```bash
docker compose --env-file .env exec -T backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/openapi.json').status)"
docker compose --env-file .env exec -T backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/healthz').status)"
docker compose --env-file .env exec -T backend python -c "import urllib.request, json; data=json.load(urllib.request.urlopen('http://127.0.0.1:8000/graph?link=1706.03762')); print(data.get('seed_id'), len(data.get('nodes', [])), len(data.get('links', [])))"
docker compose --env-file .env exec -T frontend node -e "fetch('http://127.0.0.1:80').then(async (r) => { console.log(r.status, (await r.text()).length); })"
docker compose --env-file .env exec -T frontend node -e "fetch('http://127.0.0.1:80/api/openapi.json').then(async (r) => { console.log(r.status, (await r.text()).length); })"
```

Stop services:

```bash
docker compose --env-file .env down
```

## 5. Backend Unhealthy Triage

If Coolify reports backend as unhealthy:

1. Verify required env vars are set and non-empty:
   - `MONGODB_URI`
   - `MONGODB_DB_NAME`
   - `JWT_SECRET_KEY`
2. Verify Atlas network access rules allow your Coolify host.
3. Verify MongoDB user permissions allow index creation on `users` and `papers`.
4. Re-check backend logs for startup errors:
   - missing env var
   - MongoDB connection/auth errors
5. If logs show index failures, temporarily set `MONGODB_ENSURE_INDEXES=false`,
   redeploy to confirm connectivity/auth are healthy, then re-enable `true` after
   fixing MongoDB permissions.

Common log patterns:

| Log excerpt | Likely cause | Action |
| --- | --- | --- |
| `DB_CONFIG_ERROR: ...` | Missing/invalid backend DB/auth config | Fix required env values and redeploy |
| `DB_CONNECT_ERROR: ...` | Atlas not reachable/network issue | Verify URI hostname and Atlas IP/network rules |
| `DB_AUTH_ERROR: ...` | Mongo auth/credentials issue | Verify username/password/auth source in URI |
| `DB_INDEX_ERROR: ...` | Mongo user lacks index permissions | Grant index/createIndex permissions and redeploy |
