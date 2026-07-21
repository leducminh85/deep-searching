#!/bin/sh
set -eu

token="${ADMIN_CRON_TOKEN:-}"
url="${UPDATE_URL:-http://nextjs:3000/api/admin/daily-update/cron}"

if [ -z "$token" ]; then
  echo "ADMIN_CRON_TOKEN is required for daily update cron"
  exit 1
fi

echo "[$(date -Iseconds)] Triggering daily update: $url"
curl -fsS \
  -X POST \
  -H "Authorization: Bearer $token" \
  "$url"
echo
