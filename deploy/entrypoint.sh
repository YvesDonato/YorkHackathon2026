#!/usr/bin/env bash
set -euo pipefail

PORT_VALUE="${PORT:-8080}"

if ! [[ "$PORT_VALUE" =~ ^[0-9]+$ ]]; then
  echo "Invalid PORT value: '$PORT_VALUE'"
  exit 1
fi

export PORT="$PORT_VALUE"

envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

exec supervisord -c /etc/supervisor/conf.d/supervisord.conf
