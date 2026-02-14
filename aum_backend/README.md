# YorkHackathon2026 Backend

## Run

```bash
uvicorn app.main:app --reload
```

## API Examples

```bash
curl -X POST "http://127.0.0.1:8000/papers/ingest" \
  -H "Content-Type: application/json" \
  -d "{\"link\":\"https://arxiv.org/abs/1706.03762\"}"
```

```bash
curl -X POST "http://127.0.0.1:8000/papers/upload" \
  -F "file=@./paper.pdf" \
  -F "link=https://arxiv.org/abs/1706.03762"
```

```bash
curl "http://127.0.0.1:8000/papers/1706.03762/status"
```

```bash
curl "http://127.0.0.1:8000/papers/1706.03762"
```

```bash
curl "http://127.0.0.1:8000/papers/search?q=transformer&limit=10"
```
