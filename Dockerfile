# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

ARG NEXT_PUBLIC_FASTAPI_BASE_URL=/api
ENV NEXT_PUBLIC_FASTAPI_BASE_URL=${NEXT_PUBLIC_FASTAPI_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build


FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_FASTAPI_BASE_URL=/api
ENV PORT=8080
ENV NODE_OPTIONS=--max-http-header-size=131072

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        gettext-base \
        nginx \
        python3 \
        python3-pip \
        python3-venv \
        supervisor \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

COPY backend /app/backend
COPY --from=frontend-builder /app/frontend /app/frontend

COPY nginx/default.conf /etc/nginx/templates/default.conf.template
COPY deploy/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY deploy/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY deploy/start-nginx.sh /usr/local/bin/start-nginx.sh

RUN rm -f /etc/nginx/sites-enabled/default
RUN chmod +x /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/start-nginx.sh

EXPOSE 8080 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "const port=process.env.PORT||8080;require('http').get(`http://127.0.0.1:${port}/healthz`,res=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1));"

CMD ["/usr/local/bin/entrypoint.sh"]
