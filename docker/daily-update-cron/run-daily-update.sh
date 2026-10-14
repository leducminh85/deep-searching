#!/bin/sh
set -eu

token="${ADMIN_CRON_TOKEN:-}"
url="${UPDATE_URL:-http://nextjs:3000/api/admin/daily-update/cron}"
action="${1:-start}"
case "$action" in
  start|stop) ;;
  *) echo "Unsupported daily update action: $action"; exit 1 ;;
esac

if [ -z "$token" ]; then
  echo "ADMIN_CRON_TOKEN is required for daily update cron"
  exit 1
fi

echo "[$(date -Iseconds)] Daily update action=$action: $url"
curl -fsS \
  -X POST \
  -H "Authorization: Bearer $token" \
  -H "Content-Type: application/json" \
  --data "{\"action\":\"$action\"}" \
  "$url"
echo
