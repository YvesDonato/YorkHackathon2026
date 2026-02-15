FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
# Always include dev dependencies in build stages.
# Some deployment environments set NODE_ENV=production globally,
# which can otherwise omit TypeScript/Next build-time packages.
RUN npm ci --include=dev

FROM node:20-alpine AS builder

WORKDIR /app

ARG NEXT_PUBLIC_FASTAPI_BASE_URL=/api
ENV NEXT_PUBLIC_FASTAPI_BASE_URL=$NEXT_PUBLIC_FASTAPI_BASE_URL
ARG BACKEND_INTERNAL_URL=http://localhost:8000
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Surface full Next.js output in Docker logs when build fails.
RUN npm run build > /tmp/next-build.log 2>&1 || (cat /tmp/next-build.log && exit 1)

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=80

ARG NEXT_PUBLIC_FASTAPI_BASE_URL=/api
ENV NEXT_PUBLIC_FASTAPI_BASE_URL=$NEXT_PUBLIC_FASTAPI_BASE_URL
ARG BACKEND_INTERNAL_URL=http://localhost:8000
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL

COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 80

CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "80"]
