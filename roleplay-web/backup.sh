#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p backups
ts=$(date +%Y%m%d-%H%M%S)
target="backups/roleplay-data-$ts.tar.gz"

restore_app() {
  docker compose start app >/dev/null 2>&1 || true
}
trap restore_app EXIT

echo "stopping app for a consistent snapshot..."
docker compose stop app >/dev/null

docker run --rm \
  -v roleplay-data:/data:ro \
  -v "$PWD/backups":/backup \
  alpine tar czf "/backup/roleplay-data-$ts.tar.gz" -C /data .

echo "backup written: $target"
ls -lh "$target"

echo "recent backups:"
ls -1t backups | head -5
