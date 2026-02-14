#!/usr/bin/env bash
set -euo pipefail

wait_for_port() {
  local host="$1"
  local port="$2"
  local label="$3"

  for _ in $(seq 1 90); do
    if (echo >"/dev/tcp/${host}/${port}") >/dev/null 2>&1; then
      echo "${label} is reachable on ${host}:${port}"
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for ${label} on ${host}:${port}" >&2
  return 1
}

wait_for_port 127.0.0.1 8000 "FastAPI"
wait_for_port 127.0.0.1 3000 "Next.js"

exec nginx -g "daemon off;"
